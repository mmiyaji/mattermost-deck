import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BODY_CACHE_PRIVACY_CHANGED_KEY, BODY_CACHE_PRIVACY_MESSAGE } from "./cachePrivacyProtocol";

describe("body cache privacy client", () => {
  const scope = { serverScope: "https://chat.example/", userId: "user-a" };
  let send: ReturnType<typeof vi.fn>;
  let changed: Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>;
  beforeEach(() => {
    vi.resetModules(); changed = new Set(); send = vi.fn(async () => ({ success: true }));
    vi.stubGlobal("chrome", { runtime: { sendMessage: send }, storage: { onChanged: {
      addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => changed.add(listener),
      removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => changed.delete(listener),
    } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("invalidates captured request epochs and notifies matching scopes on explicit clear", async () => {
    const client = await import("./bodyCachePrivacyClient");
    const listener = vi.fn(); const unsubscribe = client.subscribeBodyCacheClears(listener);
    const captured = client.bodyCachePrivacyEpoch();
    await client.clearBodyCaches("manual", scope);
    expect(client.bodyCachePrivacyEpoch()).toBeGreaterThan(captured);
    expect(listener).toHaveBeenCalledWith({ scope, reason: "manual" });
    expect(send).toHaveBeenCalledWith({ type: BODY_CACHE_PRIVACY_MESSAGE, operation: "clear", scope, reason: "manual" });
    unsubscribe(); expect(changed.size).toBe(0);
  });

  it("does not let a failing subscriber prevent actual deletion", async () => {
    const client = await import("./bodyCachePrivacyClient");
    client.subscribeBodyCacheClears(() => { throw new Error("unmounted consumer"); });
    await expect(client.clearBodyCaches("auth", scope)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
  });

  it("retries a failed identity binding and rejects the old account request epoch", async () => {
    const client = await import("./bodyCachePrivacyClient");
    send.mockRejectedValueOnce(new Error("worker waking"));
    client.bindBodyCacheIdentity(scope);
    await new Promise(resolve => setTimeout(resolve, 0));
    client.bindBodyCacheIdentity(scope);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledTimes(2);
    const captured = client.bodyCachePrivacyEpoch();
    client.bindBodyCacheIdentity({ ...scope, userId: "user-b" });
    expect(client.bodyCachePrivacyEpoch()).toBeGreaterThan(captured);
    expect(client.bodyCacheIdentity()).toEqual({ ...scope, userId: "user-b" });
  });

  it("coalesces simultaneous session expiry and releases a rejected request for retry", async () => {
    const client = await import("./bodyCachePrivacyClient");
    let reject!: (error: Error) => void;
    send.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const first = client.expireBodyCacheSession(scope.serverScope, "auth");
    const second = client.expireBodyCacheSession(scope.serverScope, "auth");
    const outcomes = Promise.allSettled([first, second]);
    expect(send).toHaveBeenCalledOnce();
    reject(new Error("offline"));
    expect((await outcomes).every(result => result.status === "rejected")).toBe(true);
    await client.expireBodyCacheSession(scope.serverScope, "auth");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends the captured account for a late auth failure and keeps the current identity", async () => {
    const client = await import("./bodyCachePrivacyClient");
    client.bindBodyCacheIdentity({ ...scope, userId: "user-b" });
    await new Promise(resolve => setTimeout(resolve, 0));
    send.mockClear();
    await client.expireBodyCacheSession(scope.serverScope, "auth", scope);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: client.BODY_CACHE_SESSION_MESSAGE, operation: "expire",
      serverScope: scope.serverScope, reason: "auth", scope });
    expect(client.bodyCacheIdentity()).toEqual({ ...scope, userId: "user-b" });
  });

  it("accepts cross-tab clear notifications and distinguishes account scopes", async () => {
    const client = await import("./bodyCachePrivacyClient");
    const listener = vi.fn(); client.subscribeBodyCacheClears(listener);
    const notice = { scope, reason: "permission" as const };
    const captured = client.bodyCachePrivacyEpoch();
    for (const listener of changed) listener({ [BODY_CACHE_PRIVACY_CHANGED_KEY]: { newValue: notice } }, "local");
    expect(client.bodyCachePrivacyEpoch()).toBe(captured);
    for (const listener of changed) listener({ [BODY_CACHE_PRIVACY_CHANGED_KEY]: { newValue: notice } }, "session");
    expect(client.bodyCachePrivacyEpoch()).toBeGreaterThan(captured);
    expect(listener).toHaveBeenCalledWith(notice);
    expect(client.bodyCacheScopeMatches(notice, scope)).toBe(true);
    expect(client.bodyCacheScopeMatches(notice, { ...scope, userId: "other" })).toBe(false);
    expect(client.bodyCacheScopeMatches({ scope: null, reason: "manual" }, scope)).toBe(true);
  });

  it.each([
    [403, "/api/v4/channels/channel/posts?page=0", true],
    [403, "/channels/channel", true], [403, "/posts/post/thread?perPage=200", true],
    [403, "/teams/team/posts/search", true],
    [403, "/users/user/groups", false], [403, "/users/user/teams/team/threads", false],
    [403, "/config/client", false], [403, "/plugins/playbooks/runs", false],
    [401, "/posts/post", false], [500, "/posts/post", false],
  ] as const)("classifies %s %s as denied content=%s", async (status, path, expected) => {
    const { isBodyAccessDenied } = await import("./bodyCachePrivacyClient");
    expect(isBodyAccessDenied(status, path)).toBe(expected);
  });
});
