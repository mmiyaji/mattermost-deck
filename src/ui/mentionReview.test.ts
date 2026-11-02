import { afterEach, describe, expect, it, vi } from "vitest";
import type { MattermostPost } from "../mattermost/api";
import { ingestReview, retryReview, reviewSnapshot, reviewPrefix, reviewScopeIndex, reviewScope, selectReview, writeReview } from "./mentionReview";

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
  it("uses the background database and receives decisions from another tab even when local storage is full", async () => {
    const prefix = reviewPrefix("https://chat.example", "database-client");
    const values: Record<string, unknown> = {};
    let listener: (message: unknown) => void = () => {};
    const localSet = vi.fn(async () => { throw new Error("QUOTA_BYTES quota exceeded"); });
    vi.stubGlobal("chrome", { storage: { local: { get: vi.fn(), set: localSet, remove: vi.fn() } }, runtime: {
      onMessage: { addListener: (fn: typeof listener) => { listener = fn; }, removeListener: vi.fn() },
      sendMessage: async (request: { operation: string; sets?: Record<string, unknown>; removes?: string[] }) => {
        if (request.operation === "get") return { success: true, values: { ...values } };
        Object.assign(values, request.sets);
        for (const key of request.removes ?? []) delete values[key];
        listener({ type: "mattermost-deck:review-changed", prefix, changes: { ...request.sets, ...Object.fromEntries((request.removes ?? []).map(key => [key, null])) } });
        return { success: true };
      },
    } });
    await ingestReview(prefix, "*", [post("pending"), post("confirmed")]);
    await writeReview(prefix, { [`${prefix}confirmed:confirmed`]: 50 });
    values[`${prefix}confirmed:pending`] = 75;
    listener({ type: "mattermost-deck:review-changed", prefix, changes: { [`${prefix}confirmed:pending`]: 75 } });
    let seen: Record<string, unknown> = {};
    await writeReview(prefix, current => { seen = current; return {}; });
    expect(selectReview(seen, prefix, "*").map(entry => entry.confirmedAt).sort()).toEqual([50, 75]);
    expect(localSet).not.toHaveBeenCalled();
    await writeReview(prefix, { [`${prefix}confirmed:pending`]: undefined });
    expect(selectReview(values, prefix, "*").find(entry => entry.post.id === "pending")?.confirmedAt).toBeNull();
  });
  it("does not replace a newer body when migrating older overlapping scope records", async () => {
    const prefix = reviewPrefix("server", "migration-newest");
    const { values } = mockStorage({
      [`${prefix}post:*:id`]: post("id", 2),
      [`${prefix}post:team:id`]: post("id", 3),
      [`${prefix}body:id`]: post("id", 5),
    });
    await ingestReview(prefix, "*", [post("id", 1)]);
    expect(selectReview(values, prefix, "*")[0].post.message).toBe("mention 5");
    expect(selectReview(values, prefix, "team")[0].post.message).toBe("mention 5");
  });
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
  it("stores one canonical body when the same post belongs to multiple review scopes", async () => {
    const prefix = reviewPrefix("server", "shared-body");
    const { values } = mockStorage();
    const shared = post("shared");
    await ingestReview(prefix, "team-a", [shared]);
    await ingestReview(prefix, "*", [shared]);
    expect(values[`${prefix}post:team-a:shared`]).toBe(true);
    expect(values[`${prefix}post:*:shared`]).toBe(true);
    expect(values[`${prefix}body:shared`]).toEqual(shared);
    expect(selectReview(values, prefix, "team-a")).toEqual([{ post: shared, confirmedAt: null }]);
    await writeReview(prefix, { [`${prefix}confirmed:shared`]: 456 });
    expect(selectReview(values, prefix, "*")[0].confirmedAt).toBe(456);
  });
  it("compacts legacy cross-scope copies before a confirmation would exceed the storage quota", async () => {
    const prefix = reviewPrefix("server", "legacy-compaction");
    const shared = { ...post("legacy"), message: "long pending post ".repeat(150) };
    const initial = {
      [`${prefix}post:team-a:legacy`]: shared,
      [`${prefix}post:*:legacy`]: shared,
    };
    const values = { ...initial };
    const limit = JSON.stringify(initial).length - 500;
    const set = vi.fn(async (next: Record<string, unknown>) => {
      if (JSON.stringify({ ...values, ...next }).length > limit) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(values, next);
    });
    const remove = vi.fn(async (keys: string[]) => { for (const key of keys) delete values[key]; });
    vi.stubGlobal("chrome", { storage: { local: { get: vi.fn(async () => ({ ...values })), set, remove } } });

    await writeReview(prefix, { [`${prefix}confirmed:legacy`]: 123 });

    expect(values[`${prefix}post:team-a:legacy`]).toBe(true);
    expect(values[`${prefix}post:*:legacy`]).toBe(true);
    expect(values[`${prefix}body:legacy`]).toEqual(shared);
    expect(values[`${prefix}confirmed:legacy`]).toBe(123);
    expect(selectReview(values, prefix, "team-a")[0].post).toEqual(shared);
  });
  it("keeps a 13-team-scale pending feed below the local storage quota when scopes overlap", async () => {
    const prefix = reviewPrefix("server", "large-shared-feed");
    const values: Record<string, unknown> = {};
    const quotaBytes = 10 * 1024 * 1024;
    const set = vi.fn(async (next: Record<string, unknown>) => {
      const bytes = new TextEncoder().encode(JSON.stringify({ ...values, ...next })).length;
      if (bytes > quotaBytes) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(values, next);
    });
    const remove = vi.fn(async (keys: string[]) => { for (const key of keys) delete values[key]; });
    vi.stubGlobal("chrome", { storage: { local: { get: vi.fn(async () => ({ ...values })), set, remove } } });
    const posts = Array.from({ length: 8400 }, (_, index) => ({
      ...post(`load-${index}`, index + 1),
      create_at: index + 1,
      message: index % 7 === 0
        ? `@mm95user [DECK-LOAD] 長文テスト\n${"取得・描画・確認状態を確認するためのダミーデータです。".repeat(14)}\n- status: pending\n\`\`\`json\n{"loadtest":true,"sample":${index}}\n\`\`\``
        : `@all [DECK-LOAD] 通常の負荷テスト投稿です。${"件数バッジと履歴を確認します。".repeat(index % 5 + 1)}`,
    }));

    await ingestReview(prefix, "*", posts);
    await ingestReview(prefix, "team-a", posts);
    const persistedBytes = new TextEncoder().encode(JSON.stringify(values)).length;

    expect(persistedBytes).toBeLessThan(quotaBytes);
    expect(selectReview(values, prefix, "*")).toHaveLength(posts.length);
    expect(selectReview(values, prefix, "team-a")).toHaveLength(posts.length);
    expect(Object.keys(values).filter(key => key.startsWith(`${prefix}body:`))).toHaveLength(posts.length);
    expect(set).toHaveBeenCalledTimes(2);
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
  it("keeps the scope index in step with writes, removals and remote changes", async () => {
    const prefix = reviewPrefix("server", "index");
    let listener!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    const stored: Record<string, unknown> = {};
    const set = vi.fn(async (next: Record<string, unknown>) => { Object.assign(stored, next); });
    const remove = vi.fn(async (keys: string[]) => { for (const key of keys) delete stored[key]; });
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: vi.fn(async () => ({ ...stored })), set, remove },
        onChanged: { addListener: (fn: typeof listener) => { listener = fn; }, removeListener: vi.fn() },
      },
    });
    // The indexed read must always agree with the full scan the pure form does.
    const agrees = (scope: string) => {
      const indexed = selectReview(stored, prefix, scope, reviewScopeIndex(prefix, scope));
      const scanned = selectReview(stored, prefix, scope);
      expect(indexed.map(entry => entry.post.id)).toEqual(scanned.map(entry => entry.post.id));
      return indexed.map(entry => entry.post.id);
    };
    await ingestReview(prefix, "team", [post("a"), post("b")]);
    await ingestReview(prefix, "*", [post("c")]);
    expect(agrees("team")).toEqual(["a", "b"]);
    expect(agrees("*")).toEqual(["c"]);
    expect([...reviewScopeIndex(prefix, "team")]).toHaveLength(2);
    // Confirming then dropping the body must take its key out of the index.
    await writeReview(prefix, { [`${prefix}confirmed:a`]: 1 });
    await writeReview(prefix, { [`${prefix}deleted:a`]: 2 });
    expect(agrees("team")).toEqual(["b"]);
    expect([...reviewScopeIndex(prefix, "team")].some(key => key.endsWith(":a"))).toBe(false);
    // A post arriving from another tab must become visible without a reload.
    stored[`${prefix}post:team:remote`] = post("remote");
    listener({ [`${prefix}post:team:remote`]: { newValue: post("remote") } }, "local");
    expect(agrees("team")).toContain("remote");
    // And its removal elsewhere must not leave a phantom row behind.
    delete stored[`${prefix}post:team:remote`];
    listener({ [`${prefix}post:team:remote`]: { newValue: undefined } }, "local");
    expect(agrees("team")).toEqual(["b"]);
  });
  it("refuses system messages a mention search matched by name, and hides ones already stored", async () => {
    const prefix = reviewPrefix("server", "system");
    const join = { ...post("join"), type: "system_join_channel", message: "mm95user has joined the channel." };
    const added = { ...post("added"), type: "system_add_to_channel", props: { addedUserId: "me" } };
    const { values } = mockStorage();
    await ingestReview(prefix, "*", [join, added, post("real")]);
    expect(values).not.toHaveProperty([`${prefix}post:*:join`]);
    expect(selectReview(values, prefix, "*").map(entry => entry.post.id).sort()).toEqual(["added", "real"]);
    // A record written before the guard existed must stop being displayed.
    values[`${prefix}post:*:legacyJoin`] = { ...post("legacyJoin"), type: "system_leave_channel" };
    expect(selectReview(values, prefix, "*").map(entry => entry.post.id).sort()).toEqual(["added", "real"]);
  });
  it("prunes only confirmed bodies beyond the cap and keeps every confirmation and pending post", async () => {
    const prefix = reviewPrefix("server", "prune-confirmed");
    const { values } = mockStorage();
    const posts = Array.from({ length: 210 }, (_, index) => post(`p${index}`));
    await ingestReview(prefix, "*", posts);
    await writeReview(prefix, Object.fromEntries(posts.slice(0, 205).map((entry, index) => [`${prefix}confirmed:${entry.id}`, 1000 + index])));
    const confirmed = Object.keys(values).filter(key => key.startsWith(`${prefix}confirmed:`));
    expect(confirmed).toHaveLength(205);
    for (const id of ["p0", "p1", "p2", "p3", "p4"]) {
      expect(values[`${prefix}post:*:${id}`]).toBe(true);
      expect(values).not.toHaveProperty([`${prefix}body:${id}`]);
      expect(typeof values[`${prefix}confirmed:${id}`]).toBe("number");
      expect(values).not.toHaveProperty([`${prefix}deleted:${id}`]);
    }
    expect(values[`${prefix}post:*:p5`]).toBe(true);
    expect(values).toHaveProperty([`${prefix}body:p5`]);
    expect(selectReview(values, prefix, "*").filter(entry => entry.confirmedAt === null).map(entry => entry.post.id)).toEqual(posts.slice(205).map(entry => entry.id));
    await ingestReview(prefix, "*", posts.slice(0, 5));
    expect(values[`${prefix}post:*:p0`]).toBe(true);
    expect(selectReview(values, prefix, "*")).toHaveLength(205);
  });
  it("retains deletion decisions beyond the former tombstone cap", async () => {
    const prefix = reviewPrefix("server", "prune-tombstones");
    const { values } = mockStorage({ [`${prefix}deleted:legacy`]: true });
    await writeReview(prefix, Object.fromEntries(Array.from({ length: 2005 }, (_, index) => [`${prefix}deleted:t${index}`, 1000 + index])));
    const tombstones = Object.keys(values).filter(key => key.startsWith(`${prefix}deleted:`));
    expect(tombstones).toHaveLength(2006);
    expect(values).toHaveProperty([`${prefix}deleted:legacy`]);
    expect(values).toHaveProperty([`${prefix}deleted:t0`]);
    expect(values).toHaveProperty([`${prefix}deleted:t4`]);
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

  it("never reopens an old confirmation after more than 2000 deletion decisions and re-ingestion", async () => {
    const prefix = reviewPrefix("server", "old-confirmation");
    const { values } = mockStorage();
    await ingestReview(prefix, "*", [post("old"), post("pending")]);
    await writeReview(prefix, { [`${prefix}confirmed:old`]: 1 });
    await writeReview(prefix, Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`${prefix}confirmed:new${i}`, i + 2])));
    await writeReview(prefix, Object.fromEntries(Array.from({ length: 2005 }, (_, i) => [`${prefix}deleted:other${i}`, Date.now() + i])));
    // Recreate the in-memory registry as after restarting the extension.
    vi.resetModules();
    const restarted = await import("./mentionReview");
    await restarted.ingestReview(prefix, "*", [post("old")]);
    expect(values[`${prefix}confirmed:old`]).toBe(1);
    expect(selectReview(values, prefix, "*").filter(entry => entry.confirmedAt === null).map(entry => entry.post.id)).toEqual(["pending"]);
  });

  it.each([200, undefined])("keeps a newer remote decision (%s) when an older local write finishes", async (remote) => {
    const prefix = reviewPrefix("server", `write-race-${remote}`);
    let listener!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    let finish!: () => void;
    const values: Record<string, unknown> = { [`${prefix}post:*:id`]: post("id") };
    const set = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.stubGlobal("chrome", { storage: { local: { get: async () => ({ ...values }), set, remove: vi.fn() }, onChanged: { addListener: (fn: typeof listener) => { listener = fn; }, removeListener: vi.fn() } } });
    const pending = writeReview(prefix, { [`${prefix}confirmed:id`]: 100 });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    listener({ [`${prefix}confirmed:id`]: { newValue: remote } }, "local");
    finish();
    await pending;
    let seen: Record<string, unknown> = {};
    await writeReview(prefix, current => { seen = current; return {}; });
    expect(seen[`${prefix}confirmed:id`]).toBe(remote);
    expect(selectReview(seen, prefix, "*")[0].confirmedAt).toBe(remote ?? null);
  });

  it("frees confirmed bodies on quota failure before retrying, preserving pending posts and all decisions", async () => {
    const prefix = reviewPrefix("server", "quota-recovery");
    const initial: Record<string, unknown> = { [`${prefix}post:*:pending`]: post("pending") };
    for (let i = 0; i < 200; i++) {
      initial[`${prefix}post:*:c${i}`] = { ...post(`c${i}`), message: "x".repeat(1000) };
      initial[`${prefix}confirmed:c${i}`] = i + 1;
    }
    const { values, set, remove } = mockStorage(initial);
    const limit = JSON.stringify(initial).length + 100;
    set.mockImplementation(async next => {
      if (JSON.stringify({ ...values, ...next }).length > limit) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(values, next);
    });
    await ingestReview(prefix, "*", [{ ...post("new"), message: "y".repeat(2000) }]);
    expect(set).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalled();
    expect(remove.mock.calls.flat(2).every(key => (key.startsWith(`${prefix}post:`) || key.startsWith(`${prefix}body:`)) && !key.endsWith(":pending"))).toBe(true);
    expect(Object.keys(values).filter(key => key.startsWith(`${prefix}confirmed:`))).toHaveLength(200);
    expect(selectReview(values, prefix, "*").filter(entry => entry.confirmedAt === null).map(entry => entry.post.id).sort()).toEqual(["new", "pending"]);
  });

  it("reports quota failure without deleting pending posts when no confirmed bodies can be freed", async () => {
    const prefix = reviewPrefix("server", "quota-pending-only");
    const { values, set, remove } = mockStorage({ [`${prefix}post:*:pending`]: post("pending") });
    set.mockRejectedValue(new Error("quota exceeded"));
    await expect(ingestReview(prefix, "*", [post("new")])).rejects.toThrow("quota");
    expect(remove).not.toHaveBeenCalled();
    expect(selectReview(values, prefix, "*").map(entry => entry.post.id)).toEqual(["pending"]);
  });

  it("keeps a pending body when its confirmation still fails after freeing history", async () => {
    const prefix = reviewPrefix("server", "quota-confirmation-failure");
    const { values, set } = mockStorage({
      [`${prefix}post:*:pending`]: post("pending"),
      [`${prefix}post:*:confirmed`]: post("confirmed"),
      [`${prefix}confirmed:confirmed`]: 10,
    });
    set.mockRejectedValue(new Error("quota exceeded"));
    await expect(writeReview(prefix, { [`${prefix}confirmed:pending`]: 20 })).rejects.toThrow("quota");
    expect(values[`${prefix}confirmed:confirmed`]).toBe(10);
    expect(values).not.toHaveProperty([`${prefix}confirmed:pending`]);
    expect(selectReview(values, prefix, "*").map(entry => entry.post.id)).toEqual(["pending"]);
    let seen: Record<string, unknown> = {};
    await writeReview(prefix, current => { seen = current; return {}; });
    expect(selectReview(seen, prefix, "*").map(entry => entry.post.id)).toEqual(["pending"]);
  });

  it("does not replace a remote re-confirmation when an older local reopen completes", async () => {
    const prefix = reviewPrefix("server", "remove-race");
    let listener!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    let finish!: () => void;
    const remove = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.stubGlobal("chrome", { storage: { local: { get: async () => ({ [`${prefix}post:*:id`]: post("id"), [`${prefix}confirmed:id`]: 100 }), set: vi.fn(), remove }, onChanged: { addListener: (fn: typeof listener) => { listener = fn; }, removeListener: vi.fn() } } });
    const pending = writeReview(prefix, { [`${prefix}confirmed:id`]: undefined });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    listener({ [`${prefix}confirmed:id`]: { newValue: 200 } }, "local");
    finish();
    await pending;
    let seen: Record<string, unknown> = {};
    await writeReview(prefix, current => { seen = current; return {}; });
    expect(selectReview(seen, prefix, "*")[0].confirmedAt).toBe(200);
  });

  it("preserves the body being reopened even if it was eligible for history cleanup", async () => {
    const prefix = reviewPrefix("server", "reopen-before-cleanup");
    const initial: Record<string, unknown> = { [`${prefix}post:*:old`]: post("old"), [`${prefix}confirmed:old`]: 1 };
    for (let i = 0; i < 200; i++) initial[`${prefix}confirmed:new${i}`] = i + 2;
    const { values } = mockStorage(initial);
    await writeReview(prefix, { [`${prefix}confirmed:old`]: undefined });
    expect(selectReview(values, prefix, "*")).toEqual([{ post: post("old"), confirmedAt: null }]);
  });
  it("continues confirmation after failed legacy compaction and retries compaction later", async () => {
    const prefix = reviewPrefix("server", "best-effort-compaction");
    const { values, set } = mockStorage({ [`${prefix}post:*:id`]: post("id"), [`${prefix}post:team:id`]: post("id") });
    set.mockRejectedValueOnce(new Error("compaction unavailable"));
    await expect(writeReview(prefix, { [`${prefix}confirmed:id`]: 123 })).resolves.toBeUndefined();
    expect(values[`${prefix}confirmed:id`]).toBe(123);
    expect(values[`${prefix}post:*:id`]).toEqual(post("id"));
    await writeReview(prefix, { [`${prefix}confirmed:id`]: undefined });
    expect(values[`${prefix}post:*:id`]).toBe(true);
    expect(values[`${prefix}body:id`]).toEqual(post("id"));
    expect(reviewSnapshot(prefix).error).toBeNull();
  });

  it.each(["before", "after"])("does not fail a committed confirmation when %s cleanup fails", async phase => {
    const prefix = reviewPrefix("server", `best-effort-cleanup-${phase}`);
    const initial: Record<string, unknown> = { [`${prefix}post:*:pending`]: post("pending") };
    for (let i = 0; i < (phase === "before" ? 201 : 200); i++) {
      initial[`${prefix}confirmed:old${i}`] = i + 1;
      initial[`${prefix}body:old${i}`] = post(`old${i}`);
    }
    const { values, remove } = mockStorage(initial);
    remove.mockRejectedValue(new Error("cleanup unavailable"));
    await expect(writeReview(prefix, { [`${prefix}confirmed:pending`]: 1000 })).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalled();
    expect(values[`${prefix}confirmed:pending`]).toBe(1000);
    expect(reviewSnapshot(prefix).error).toBeNull();
  });

  it("reports the actual quota failure when emergency history cleanup also fails", async () => {
    const prefix = reviewPrefix("server", "quota-cleanup-failure");
    const { values, set, remove } = mockStorage({ [`${prefix}post:*:pending`]: post("pending"),
      [`${prefix}body:confirmed`]: post("confirmed"), [`${prefix}confirmed:confirmed`]: 1 });
    set.mockRejectedValue(new Error("QUOTA_BYTES exceeded"));
    remove.mockRejectedValue(new Error("cleanup failed"));
    await expect(writeReview(prefix, { [`${prefix}confirmed:pending`]: 2 })).rejects.toThrow("QUOTA_BYTES");
    expect(values[`${prefix}post:*:pending`]).toEqual(post("pending"));
    expect(values).not.toHaveProperty([`${prefix}confirmed:pending`]);
    expect(reviewSnapshot(prefix).error).toContain("QUOTA_BYTES");
  });

  it("blocks writes after a failed authoritative read and recovers decisions on retry", async () => {
    const prefix = reviewPrefix("server", "hydrate-retry-runtime");
    const values: Record<string, unknown> = { [`${prefix}post:*:id`]: post("id"), [`${prefix}confirmed:id`]: 123 };
    let fail = true;
    const local = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    const sendMessage = vi.fn(async (request: { operation: string; sets?: Record<string, unknown> }) => {
      if (fail) throw new Error("Receiving end does not exist");
      if (request.operation === "get") return { success: true, values: { ...values } };
      Object.assign(values, request.sets);
      return { success: true };
    });
    vi.stubGlobal("chrome", { storage: { local }, runtime: { sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await expect(ingestReview(prefix, "*", [post("id", 2)])).rejects.toThrow("Receiving end");
    expect(reviewSnapshot(prefix)).toMatchObject({ ready: false, error: "Receiving end does not exist" });
    await expect(writeReview(prefix, { [`${prefix}confirmed:id`]: undefined })).rejects.toThrow("Receiving end");
    expect(sendMessage.mock.calls.every(([request]) => request.operation === "get")).toBe(true);
    expect(values[`${prefix}confirmed:id`]).toBe(123);
    fail = false;
    await retryReview(prefix);
    expect(reviewSnapshot(prefix)).toMatchObject({ ready: true, error: null });
    expect(selectReview(reviewSnapshot(prefix).values, prefix, "*")[0].confirmedAt).toBe(123);
    expect(local.get).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();
    fail = true;
    await retryReview(prefix);
    expect(reviewSnapshot(prefix)).toMatchObject({ ready: true, error: "Receiving end does not exist" });
    expect(reviewSnapshot(prefix).values[`${prefix}confirmed:id`]).toBe(123);
  });

  it("merges live remote decisions into a retried hydration snapshot", async () => {
    const prefix = reviewPrefix("server", "hydrate-retry-race");
    let listener!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    let release!: (values: Record<string, unknown>) => void;
    const get = vi.fn<() => Promise<Record<string, unknown>>>().mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockImplementation(() => new Promise(resolve => { release = resolve; }));
    vi.stubGlobal("chrome", { storage: { local: { get, set: vi.fn(), remove: vi.fn() }, onChanged: {
      addListener: (fn: typeof listener) => { listener = fn; }, removeListener: vi.fn() } } });
    await expect(ingestReview(prefix, "*", [post("id")])).rejects.toThrow("temporarily");
    const retry = retryReview(prefix);
    listener({ [`${prefix}confirmed:id`]: { newValue: 456 } }, "local");
    release({ [`${prefix}post:*:id`]: post("id"), [`${prefix}confirmed:id`]: 123 });
    await retry;
    expect(selectReview(reviewSnapshot(prefix).values, prefix, "*")[0].confirmedAt).toBe(456);
  });

});
