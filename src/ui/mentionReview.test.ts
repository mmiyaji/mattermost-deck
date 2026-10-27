import { afterEach, describe, expect, it, vi } from "vitest";
import type { MattermostPost } from "../mattermost/api";
import { ingestReview, reviewPrefix, reviewScope, selectReview, writeReview } from "./mentionReview";

const post = (id: string, update_at = 1): MattermostPost => ({ id, channel_id: "channel", user_id: "author", message: `mention ${update_at}`, create_at: 1, update_at });
function mockStorage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  const set = vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); });
  const remove = vi.fn(async (keys: string[]) => { for (const key of keys) delete values[key]; });
  vi.stubGlobal("chrome", { storage: { local: { get: vi.fn(async () => ({ ...values })), set, remove } } });
  return { values, set, remove };
}
afterEach(() => vi.unstubAllGlobals());
describe("durable mention review", () => {
  it("retains over 500 pending posts without TTL and shares confirmations across scopes", async () => {
    const prefix = reviewPrefix("server", "retention");
    const { values } = mockStorage();
    const posts = Array.from({ length: 650 }, (_, index) => post(String(index)));
    await ingestReview(prefix, reviewScope("team"), posts);
    await ingestReview(prefix, reviewScope(), [posts[0]]);
    expect(selectReview(values, prefix, reviewScope("team"))).toHaveLength(650);
    await writeReview(prefix, { [`${prefix}confirmed:0`]: 123 });
    expect(selectReview(values, prefix, reviewScope("team")).find(entry => entry.post.id === "0")?.confirmedAt).toBe(123);
    expect(selectReview(values, prefix, reviewScope())[0].confirmedAt).toBe(123);
    await writeReview(prefix, { [`${prefix}confirmed:0`]: undefined });
    expect(values).not.toHaveProperty([`${prefix}confirmed:0`]);
    expect(selectReview(values, prefix, reviewScope())[0].confirmedAt).toBeNull();
  });
  it("serializes concurrent ingestion without reverting a newer edit or resurrecting deletion", async () => {
    const prefix = reviewPrefix("server", "edits");
    const { values } = mockStorage();
    await Promise.all([ingestReview(prefix, "*", [post("id", 3)]), ingestReview(prefix, "*", [post("id", 2)])]);
    expect(selectReview(values, prefix, "*")[0].post.message).toBe("mention 3");
    await writeReview(prefix, { [`${prefix}deleted:id`]: true });
    await ingestReview(prefix, "*", [post("id", 4)]);
    expect(selectReview(values, prefix, "*")).toEqual([]);
  });
  it("does not publish a failed confirmation to persisted state", async () => {
    const prefix = reviewPrefix("server", "failure");
    const { values, set } = mockStorage();
    await ingestReview(prefix, "*", [post("id")]);
    set.mockRejectedValueOnce(new Error("quota"));
    await expect(writeReview(prefix, { [`${prefix}confirmed:id`]: 123 })).rejects.toThrow("quota");
    expect(selectReview(values, prefix, "*")[0].confirmedAt).toBeNull();
    await writeReview(prefix, { [`${prefix}confirmed:id`]: 124 });
    expect(selectReview(values, prefix, "*")[0].confirmedAt).toBe(124);
  });
  it("hydrates historic pending records and isolates servers and users", async () => {
    const prefix = reviewPrefix("server", "hydrate");
    const key = `${prefix}post:*:old`;
    const { values } = mockStorage({ [key]: post("old"), [`${reviewPrefix("other", "hydrate")}post:*:foreign`]: post("foreign") });
    await ingestReview(prefix, "*", [post("new")]);
    expect(selectReview(values, prefix, "*").map(entry => entry.post.id)).toEqual(["old", "new"]);
  });
  it("prunes confirmed history beyond the cap into tombstones and never prunes pending posts", async () => {
    const prefix = reviewPrefix("server", "prune-confirmed");
    const { values } = mockStorage();
    const posts = Array.from({ length: 210 }, (_, index) => post(`p${index}`));
    await ingestReview(prefix, "*", posts);
    await writeReview(prefix, Object.fromEntries(posts.slice(0, 205).map((entry, index) => [`${prefix}confirmed:${entry.id}`, 1000 + index])));
    const confirmed = Object.keys(values).filter(key => key.startsWith(`${prefix}confirmed:`));
    expect(confirmed).toHaveLength(200);
    for (const id of ["p0", "p1", "p2", "p3", "p4"]) {
      expect(values).not.toHaveProperty([`${prefix}post:*:${id}`]);
      expect(values).not.toHaveProperty([`${prefix}confirmed:${id}`]);
      expect(typeof values[`${prefix}deleted:${id}`]).toBe("number");
    }
    expect(values).toHaveProperty([`${prefix}post:*:p5`]);
    expect(selectReview(values, prefix, "*").filter(entry => entry.confirmedAt === null).map(entry => entry.post.id)).toEqual(posts.slice(205).map(entry => entry.id));
    await ingestReview(prefix, "*", posts.slice(0, 5));
    expect(values).not.toHaveProperty([`${prefix}post:*:p0`]);
    expect(selectReview(values, prefix, "*")).toHaveLength(205);
  });
  it("caps tombstones, dropping legacy and oldest first", async () => {
    const prefix = reviewPrefix("server", "prune-tombstones");
    const { values } = mockStorage({ [`${prefix}deleted:legacy`]: true });
    await writeReview(prefix, Object.fromEntries(Array.from({ length: 2005 }, (_, index) => [`${prefix}deleted:t${index}`, 1000 + index])));
    const tombstones = Object.keys(values).filter(key => key.startsWith(`${prefix}deleted:`));
    expect(tombstones).toHaveLength(2000);
    expect(values).not.toHaveProperty([`${prefix}deleted:legacy`]);
    expect(values).not.toHaveProperty([`${prefix}deleted:t0`]);
    expect(values).not.toHaveProperty([`${prefix}deleted:t4`]);
    expect(values).toHaveProperty([`${prefix}deleted:t5`]);
    expect(values).toHaveProperty([`${prefix}deleted:t2004`]);
  });
  it("rewrites a post whose message changed without a newer update_at and drops malformed records", async () => {
    const prefix = reviewPrefix("server", "ingest-fields");
    const { values, set } = mockStorage();
    await ingestReview(prefix, "*", [post("id")]);
    await ingestReview(prefix, "*", [post("id")]);
    expect(set).toHaveBeenCalledTimes(1);
    await ingestReview(prefix, "*", [{ ...post("id"), message: "edited" }]);
    expect(selectReview(values, prefix, "*")[0].post.message).toBe("edited");
    values[`${prefix}post:*:bad`] = { ...post("bad"), create_at: "x" };
    expect(selectReview(values, prefix, "*").map(entry => entry.post.id)).toEqual(["id"]);
  });
  it("keeps a change that arrives during hydration instead of overwriting it with the older snapshot", async () => {
    const prefix = reviewPrefix("server", "hydration-race");
    let listener!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    let release!: (value: Record<string, unknown>) => void;
    const get = vi.fn(() => new Promise<Record<string, unknown>>(resolve => { release = resolve; }));
    vi.stubGlobal("chrome", { storage: { local: { get, set: vi.fn(), remove: vi.fn() }, onChanged: { addListener: (fn: typeof listener) => { listener = fn; }, removeListener: vi.fn() } } });
    let seen: Record<string, unknown> = {};
    const write = writeReview(prefix, current => { seen = current; return {}; });
    listener({ [`${prefix}post:*:live`]: { newValue: post("live") }, [`${prefix}deleted:gone`]: { newValue: 5 } }, "local");
    release({ [`${prefix}post:*:old`]: post("old"), [`${prefix}post:*:gone`]: post("gone") });
    await write;
    expect(Object.keys(seen).sort()).toEqual([`${prefix}deleted:gone`, `${prefix}post:*:gone`, `${prefix}post:*:live`, `${prefix}post:*:old`]);
    expect(selectReview(seen, prefix, "*").map(entry => entry.post.id).sort()).toEqual(["live", "old"]);
  });
});
