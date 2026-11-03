import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MentionCacheSessionRequest } from "./mentionCacheSession";

const STORAGE_KEY = "mattermostDeck.mentionFeedCache.v1";
const NOW = 1_800_000_000_000;
const TTL_MS = 15 * 60_000;
const key = (team: string, server = "https://example.test/", user = "user") => JSON.stringify([server, user, team]);

function snapshot(entryKey: string, savedAt = NOW, message = "@user mention") {
  const [serverScope, userId, team] = JSON.parse(entryKey) as string[];
  return { version: 1, serverScope, userId, scopeTeamId: team === "all" ? null : team,
    teamIds: ["team"], savedAt, mentionSignature: "mentions", fingerprint: `${message.slice(0, 32)}:${message.length}`,
    posts: [{ id: "post", channel_id: "channel", user_id: "author", create_at: 100, message }],
    readState: { channelLastViewedAt: {}, threadLastViewedAt: {}, activeChannelIds: null } };
}

async function harness(initial: Record<string, unknown> = {}) {
  const stored = structuredClone(initial);
  const session = {
    get: vi.fn(async () => {
      const result = structuredClone(stored);
      await Promise.resolve();
      return result;
    }),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); }),
  };
  const local = { get: vi.fn(), set: vi.fn() };
  vi.stubGlobal("chrome", { storage: { session, local } });
  const { handleMentionCacheSessionRequest: request } = await import("./mentionCacheSession.js");
  const put = (entryKey: string, savedAt = NOW, message?: string) => request({ operation: "put", key: entryKey, snapshot: snapshot(entryKey, savedAt, message) });
  const registry = () => stored[STORAGE_KEY] as { version: 1; entries: Record<string, ReturnType<typeof snapshot>> };
  return { stored, session, local, request, put, registry };
}

describe("background mention session cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("leaves session storage empty when reading after a browser restart", async () => {
    const { request, session, stored } = await harness();
    expect(await request({ operation: "get", key: key("all") })).toEqual({});
    expect(session.set).not.toHaveBeenCalled();
    expect(stored).toEqual({});
  });

  it("serializes twenty concurrent scope writes without losing another tab's data", async () => {
    const { put, request, registry, local } = await harness();
    const keys = Array.from({ length: 20 }, (_, index) => key(`team-${index}`));
    await Promise.all(keys.map(entryKey => put(entryKey)));
    expect(Object.keys(registry().entries).sort()).toEqual(keys.sort());
    for (const entryKey of keys) expect(await request({ operation: "get", key: entryKey })).toEqual({ snapshot: snapshot(entryKey) });
    expect(local.get).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();
  });

  it("retains the newest 64 scopes", async () => {
    const { put, registry } = await harness();
    await Promise.all(Array.from({ length: 70 }, (_, index) => put(key(`team-${index}`), NOW + index)));
    expect(Object.keys(registry().entries)).toHaveLength(64);
    expect(registry().entries[key("team-0")]).toBeUndefined();
    expect(registry().entries[key("team-69")]).toBeDefined();
  });

  it("bounds the UTF-8 bytes of full snapshots to 4 MiB", async () => {
    const { put, registry } = await harness();
    const message = "あ".repeat(100_000);
    await Promise.all(Array.from({ length: 20 }, (_, index) => put(key(`team-${index}`), NOW + index, message)));
    const snapshots = Object.values(registry().entries);
    const bytes = snapshots.reduce((sum, value) => sum + new TextEncoder().encode(JSON.stringify(value)).byteLength, 0);
    expect(snapshots.length).toBeGreaterThan(4);
    expect(snapshots.length).toBeLessThan(20);
    expect(bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("reads the legacy session registry and prunes snapshots after fifteen minutes", async () => {
    const entryKey = key("all");
    const { request, registry } = await harness({ [STORAGE_KEY]: { version: 1, entries: { [entryKey]: snapshot(entryKey) } } });
    expect(await request({ operation: "get", key: entryKey })).toEqual({ snapshot: snapshot(entryKey) });
    vi.mocked(Date.now).mockReturnValue(NOW + TTL_MS + 1);
    expect(await request({ operation: "get", key: entryKey })).toEqual({});
    expect(registry().entries).toEqual({});
  });

  it("removes one scope and clears only the requested server and user", async () => {
    const { request, put, stored } = await harness({ unrelatedSessionSetting: { enabled: true } });
    const first = key("team-one"), second = key("team-two"), otherUser = key("team-one", "https://example.test/", "other"), otherServer = key("team-one", "https://other.test/");
    await Promise.all([first, second, otherUser, otherServer].map(entryKey => put(entryKey)));
    await request({ operation: "remove", key: first });
    expect(await request({ operation: "get", key: first })).toEqual({});
    expect(await request({ operation: "get", key: second })).toEqual({ snapshot: snapshot(second) });
    await request({ operation: "clear", key: second });
    expect(await request({ operation: "get", key: second })).toEqual({});
    expect(await request({ operation: "get", key: otherUser })).toEqual({ snapshot: snapshot(otherUser) });
    expect(await request({ operation: "get", key: otherServer })).toEqual({ snapshot: snapshot(otherServer) });
    await request({ operation: "clear" });
    expect(await request({ operation: "get", key: otherUser })).toEqual({});
    expect(stored.unrelatedSessionSetting).toEqual({ enabled: true });
  });

  it("deduplicates unchanged snapshots for sixty seconds and rejects older writes", async () => {
    const { put, session, registry } = await harness();
    const entryKey = key("all");
    await put(entryKey);
    vi.mocked(Date.now).mockReturnValue(NOW + 1);
    await put(entryKey, NOW + 1);
    expect(session.set).toHaveBeenCalledTimes(1);
    await put(entryKey, NOW - 1, "older data");
    expect(registry().entries[entryKey].savedAt).toBe(NOW);
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    await put(entryKey, NOW + 60_000);
    expect(session.set).toHaveBeenCalledTimes(2);
  });

  it("recovers its queue after a storage write failure", async () => {
    const { put, session, request } = await harness();
    session.set.mockRejectedValueOnce(new Error("session quota exceeded"));
    await expect(put(key("failed"))).rejects.toThrow("session quota exceeded");
    await put(key("healthy"));
    expect(await request({ operation: "get", key: key("healthy") })).toEqual({ snapshot: snapshot(key("healthy")) });
  });

  it.each(["remove", "clear", "global"] as const)("persists %s invalidation across background restarts", async operation => {
    const { request, put, stored } = await harness();
    const target = key("one"), sibling = key("two"), other = key("one", "https://other.test/");
    await Promise.all([target, sibling, other].map(entry => put(entry)));
    await request(operation === "global" ? { operation: "clear" } : { operation, key: target });
    vi.resetModules();
    const restarted = await import("./mentionCacheSession.js");
    for (const entry of operation === "remove" ? [target] : operation === "clear" ? [target, sibling] : [target, sibling, other]) {
      await restarted.handleMentionCacheSessionRequest({ operation: "put", key: entry, snapshot: snapshot(entry) });
      expect(await restarted.handleMentionCacheSessionRequest({ operation: "get", key: entry })).toEqual({});
    }
    if (operation !== "global") expect(await request({ operation: "get", key: other })).toEqual({ snapshot: snapshot(other) });
    if (operation === "remove") expect(await request({ operation: "get", key: sibling })).toEqual({ snapshot: snapshot(sibling) });
    await restarted.handleMentionCacheSessionRequest({ operation: "put", key: target, snapshot: snapshot(target, NOW + 1) });
    expect(await request({ operation: "get", key: target })).toEqual({ snapshot: snapshot(target, NOW + 1) });
    vi.mocked(Date.now).mockReturnValue(NOW + TTL_MS + 1);
    await request({ operation: "get", key: target });
    expect((stored[STORAGE_KEY] as { invalidations: object }).invalidations).toEqual({});
  });

  it("bounds active invalidations without allowing stale snapshots back", async () => {
    const { request, put, stored } = await harness();
    for (let index = 0; index < 260; index++) await request({ operation: "remove", key: key(`scope-${index}`) });
    const tokens = (stored[STORAGE_KEY] as { invalidations: object }).invalidations;
    expect(Object.keys(tokens).length).toBeLessThanOrEqual(256);
    expect(new TextEncoder().encode(JSON.stringify(tokens)).byteLength).toBeLessThanOrEqual(256 * 1024);
    await put(key("scope-0"));
    expect(await request({ operation: "get", key: key("scope-0") })).toEqual({});
    await put(key("scope-0"), NOW + 1);
    expect(await request({ operation: "get", key: key("scope-0") })).toHaveProperty("snapshot");
  });

  it("recovers the queue after failed invalidation persistence", async () => {
    const { request, session, put } = await harness();
    session.set.mockRejectedValueOnce(new Error("session unavailable"));
    await expect(request({ operation: "remove", key: key("all") })).rejects.toThrow("session unavailable");
    await request({ operation: "remove", key: key("all") });
    await put(key("all"));
    expect(await request({ operation: "get", key: key("all") })).toEqual({});
  });

  it("rejects noncanonical keys, wrong owners, future data and oversized snapshots", async () => {
    const { request, session } = await harness();
    const entryKey = key("all");
    const invalid: MentionCacheSessionRequest[] = [
      { operation: "get", key: '[ "server", "user", "all" ]' },
      { operation: "put", key: entryKey, snapshot: { ...snapshot(entryKey), userId: "other" } },
      { operation: "put", key: entryKey, snapshot: snapshot(entryKey, NOW + 300_001) },
      { operation: "put", key: entryKey, snapshot: snapshot(entryKey, NOW, "x".repeat(600_000)) },
      { operation: "put", key: entryKey, snapshot: { ...snapshot(entryKey), posts: {} } },
    ];
    for (const message of invalid) await expect(request(message)).rejects.toThrow();
    expect(session.set).not.toHaveBeenCalled();
  });
  it("privacy clear rejects a late HTTP save but permits a new request and keeps other accounts", async () => {
    const { put, request, stored } = await harness();
    const first = key("all"), other = key("all", "https://example.test/", "other");
    await put(first); await put(other);
    await request({ operation: "clear", key: first, now: NOW + 100 });
    await request({ operation: "put", key: first, now: NOW + 200,
      snapshot: { ...snapshot(first, NOW + 200), requestStartedAt: NOW } });
    expect(await request({ operation: "get", key: first })).toEqual({});
    expect((await request({ operation: "get", key: other })).snapshot).toBeTruthy();
    await request({ operation: "put", key: first, now: NOW + 300,
      snapshot: { ...snapshot(first, NOW + 300), requestStartedAt: NOW + 101 } });
    expect((await request({ operation: "get", key: first })).snapshot).toMatchObject({ requestStartedAt: NOW + 101 });
    expect(Object.keys(stored)).toEqual([STORAGE_KEY]);
  });

  it("alarm pruning expires bodies without clearing fresh scopes", async () => {
    const { put, request, registry } = await harness();
    await put(key("old"), NOW - TTL_MS + 10); await put(key("fresh"));
    await request({ operation: "prune", now: NOW + 20 });
    expect(Object.keys(registry().entries)).toEqual([key("fresh")]);
  });

});
