import { afterEach, describe, expect, it, vi } from "vitest";
import type { MattermostPost } from "../mattermost/api";
import { ingestReview, reviewPrefix, reviewScope, selectReview, writeReview } from "./mentionReview";

const post = (id: string, update_at = 1): MattermostPost => ({ id, channel_id: "channel", user_id: "author", message: `mention ${update_at}`, create_at: 1, update_at });
function mockStorage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  const set = vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); });
  vi.stubGlobal("chrome", { storage: { local: { get: vi.fn(async () => ({ ...values })), set } } });
  return { values, set };
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
    await writeReview(prefix, { [`${prefix}confirmed:0`]: null });
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
});
