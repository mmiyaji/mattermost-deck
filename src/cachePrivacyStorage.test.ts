import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BODY_CACHE_PRIVACY_CHANGED_KEY, validateBodyCachePrivacyRequest } from "./cachePrivacyProtocol";

const backend = vi.hoisted(() => ({
  persistentClear: vi.fn(async () => undefined), sessionClear: vi.fn(async () => undefined), favoritesClear: vi.fn(async () => undefined),
  persistentPrune: vi.fn(async () => undefined), sessionPrune: vi.fn(async () => undefined), favoritesPrune: vi.fn(async () => undefined),
}));
vi.mock("./mentionCacheDatabase", () => ({ purgeMentionBodyCache: backend.persistentClear, pruneMentionBodyCache: backend.persistentPrune }));
vi.mock("./mentionCacheSession", () => ({ purgeMentionBodyCache: backend.sessionClear, pruneMentionBodyCache: backend.sessionPrune }));
vi.mock("./favoriteCacheDatabase", () => ({ purgeFavoriteBodyCache: backend.favoritesClear, pruneFavoriteBodyCache: backend.favoritesPrune }));

describe("body cache privacy operations", () => {
  const scope = { serverScope: "https://chat.example/", userId: "user" };
  let set: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    set = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", { storage: { session: { set } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("clears all body stores with one cutoff and publishes a body-free notification", async () => {
    const { handleBodyCachePrivacyRequest } = await import("./cachePrivacyStorage");
    const result = await handleBodyCachePrivacyRequest({ operation: "clear", scope, reason: "auth" });
    for (const clear of [backend.persistentClear, backend.sessionClear, backend.favoritesClear]) {
      expect(clear).toHaveBeenCalledExactlyOnceWith(scope, result.change!.clearedAt);
    }
    expect(result.change).toMatchObject({ scope, reason: "auth", revision: expect.any(String), clearedAt: expect.any(Number) });
    expect(set).toHaveBeenCalledExactlyOnceWith({ [BODY_CACHE_PRIVACY_CHANGED_KEY]: result.change });
  });

  it("represents global deletion explicitly and prunes without emitting a clear", async () => {
    const { handleBodyCachePrivacyRequest } = await import("./cachePrivacyStorage");
    expect((await handleBodyCachePrivacyRequest({ operation: "clear" })).change?.scope).toBeNull();
    expect(backend.favoritesClear).toHaveBeenCalledWith(undefined, expect.any(Number));
    set.mockClear();
    expect(await handleBodyCachePrivacyRequest({ operation: "prune" })).toEqual({});
    for (const prune of [backend.persistentPrune, backend.sessionPrune, backend.favoritesPrune]) expect(prune).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
  });

  it("attempts every store, reports a partial failure, and recovers for retry", async () => {
    const { handleBodyCachePrivacyRequest } = await import("./cachePrivacyStorage");
    backend.persistentClear.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(handleBodyCachePrivacyRequest({ operation: "clear", scope })).rejects.toThrow("disk unavailable");
    expect(backend.favoritesClear).toHaveBeenCalledOnce();
    expect(backend.sessionClear).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
    await expect(handleBodyCachePrivacyRequest({ operation: "clear", scope })).resolves.toHaveProperty("change");
  });

  it("rejects malformed scopes before touching any store", async () => {
    const { handleBodyCachePrivacyRequest } = await import("./cachePrivacyStorage");
    await expect(handleBodyCachePrivacyRequest({ operation: "clear", scope: { ...scope, serverScope: "file:///private" } })).rejects.toThrow("server");
    expect(() => validateBodyCachePrivacyRequest({ operation: "clear", scope: { ...scope, userId: "" } })).toThrow("scope");
    expect(() => validateBodyCachePrivacyRequest({ operation: "clear", scope: { ...scope, serverScope: "https://user:pass@chat.example/" } })).toThrow("server");
    expect(backend.persistentClear).not.toHaveBeenCalled();
  });
});
