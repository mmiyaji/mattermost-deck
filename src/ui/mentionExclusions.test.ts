import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMentionExclusionStore, isMentionExcluded, MentionExclusionStore, mentionExclusionPrefix } from "./mentionExclusions";
import type { MattermostPost } from "../mattermost/api";

let records: Record<string, unknown>;
let listeners: Set<(changes: Record<string, { newValue: unknown }>, area: string) => void>;
let get: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;
const stores: MentionExclusionStore[] = [];
const open = (server = "https://a.test", account = "me") => {
  const store = getMentionExclusionStore(server, account);
  stores.push(store);
  return store;
};
const emit = (values: Record<string, unknown>) => listeners.forEach(listener => listener(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])), "local"));
beforeEach(() => {
  records = {}; listeners = new Set();
  get = vi.fn(async () => ({ ...records }));
  set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(records, values); emit(values); });
  vi.stubGlobal("chrome", { storage: { local: { get, set }, onChanged: { addListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.add(fn), removeListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(fn) } } });
});
afterEach(() => { stores.splice(0).forEach(store => store.dispose()); vi.unstubAllGlobals(); });

describe("shared mention exclusions", () => {
  it("isolates servers and accounts and shares one account store", async () => {
    const first = open();
    await first.excludeUser({ id: "u", username: "user" });
    expect(open()).toBe(first);
    for (const other of [open("https://b.test"), open("https://a.test", "other")]) {
      await other.retry(); expect(other.getSnapshot().users).toEqual([]);
    }
    expect(new Set([mentionExclusionPrefix("a:b", "c"), mentionExclusionPrefix("a", "b:c")]).size).toBe(2);
  });
  it("matches author or full thread, including future replies but no unrelated posts", () => {
    const post = { id: "root", user_id: "one" } as MattermostPost;
    expect(isMentionExcluded(post, new Set(["one"]), new Set())).toBe(true);
    expect(isMentionExcluded(post, new Set(), new Set(["root"]))).toBe(true);
    expect(isMentionExcluded({ ...post, id: "future", root_id: "root", user_id: "two" }, new Set(), new Set(["root"]))).toBe(true);
    expect(isMentionExcluded({ ...post, id: "other" }, new Set(), new Set(["root"]))).toBe(false);
  });
  it("hydrates after restart, bounds metadata, and persists restore tombstones", async () => {
    const first = open();
    await first.excludeUser({ id: "u", username: "name", displayName: "Display", secret: "ignored" } as never);
    await first.excludeConversation({ rootId: "r", channelId: "c", label: "x".repeat(400), authorUsername: "name" });
    first.dispose();
    const restarted = open(); await restarted.retry();
    expect(restarted.getSnapshot().users).toEqual([{ id: "u", username: "name", displayName: "Display" }]);
    expect(restarted.getSnapshot().conversations[0].label).toHaveLength(160);
    await restarted.restoreUser("u"); await restarted.restoreConversation("r");
    expect(Object.values(records)).toEqual([null, null]);
    expect(restarted.getSnapshot().users).toEqual([]);
  });
  it("queues different rules without overwriting and synchronizes other windows", async () => {
    const first = open();
    const second = new MentionExclusionStore(first.prefix); stores.push(second);
    await Promise.all([first.excludeUser({ id: "a", username: "A" }), first.excludeUser({ id: "b", username: "B" }), second.excludeConversation({ rootId: "r", channelId: "c", label: "thread" })]);
    expect(first.getSnapshot().users).toHaveLength(2);
    expect(second.getSnapshot().users).toHaveLength(2);
    expect(first.getSnapshot().conversations).toHaveLength(1);
    await second.restoreUser("a");
    expect(first.getSnapshot().users.map(user => user.id)).toEqual(["b"]);
  });
  it("ignores corrupt, mismatched and unrelated records", async () => {
    const prefix = mentionExclusionPrefix("https://a.test", "me");
    records = { [`${prefix}user:u`]: { id: "different", username: "x" }, [`${prefix}user:v`]: { id: "v" }, [`${prefix}conversation:r`]: "bad", [`${prefix}user:w`]: null, other: { id: "valid", username: "valid" } };
    const store = open(); await store.retry();
    expect(store.getSnapshot()).toMatchObject({ ready: true, users: [], conversations: [] });
  });
  it("blocks writes after failed hydration, retries without losing saved rules", async () => {
    const prefix = mentionExclusionPrefix("https://a.test", "me");
    records[`${prefix}user:existing`] = { id: "existing", username: "Saved" };
    get.mockRejectedValueOnce(new Error("load failed"));
    const store = open(); await store.retry();
    expect(store.getSnapshot()).toMatchObject({ ready: false, error: "load failed" });
    await expect(store.excludeUser({ id: "new", username: "New" })).rejects.toThrow("load failed");
    expect(set).not.toHaveBeenCalled();
    await store.retry(); await store.excludeUser({ id: "new", username: "New" });
    expect(store.getSnapshot().users).toHaveLength(2);
  });
  it("does not publish an unsaved rule after a write failure", async () => {
    const store = open(); await store.retry();
    set.mockRejectedValueOnce(new Error("quota"));
    await expect(store.excludeUser({ id: "u", username: "U" })).rejects.toThrow("quota");
    expect(store.getSnapshot()).toMatchObject({ ready: true, error: "quota", users: [] });
  });
  it("retains a later same-rule storage event when an earlier write resolves late", async () => {
    const store = open(); await store.retry();
    let completeWrite!: () => void;
    set.mockImplementationOnce((values: Record<string, unknown>) => {
      Object.assign(records, values); emit(values);
      return new Promise<void>(resolve => { completeWrite = resolve; });
    });
    const earlier = store.excludeUser({ id: "u", username: "Earlier" });
    await vi.waitFor(() => expect(completeWrite).toBeTypeOf("function"));
    const key = `${store.prefix}user:u`;
    records[key] = null;
    emit({ [key]: null });
    completeWrite(); await earlier;
    expect(store.getSnapshot().users).toEqual([]);
    expect(records[key]).toBeNull();
  });
  it("keeps changes delivered while the initial snapshot is loading", async () => {
    let resolve!: (value: Record<string, unknown>) => void;
    get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const store = open(); await Promise.resolve();
    const key = `${store.prefix}user:u`;
    emit({ [key]: { id: "u", username: "New" } });
    resolve({ [key]: { id: "u", username: "Old" } });
    await store.retry();
    expect(store.getSnapshot().users[0].username).toBe("New");
  });
});
