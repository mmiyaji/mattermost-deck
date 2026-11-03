import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyCachePrivacyRequest, BodyCacheScope } from "./cachePrivacyProtocol";

const clear = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("./cachePrivacyStorage", () => ({ handleBodyCachePrivacyRequest: clear }));
const scope: BodyCacheScope = { serverScope: "https://chat.example/mm/", userId: "user-a" };
function sender(url = "https://chat.example/mm/team/channels/town-square", tabId = 7): chrome.runtime.MessageSender {
  return { id: "our-extension", frameId: 0, url, tab: { id: tabId, url } } as chrome.runtime.MessageSender;
}
const options = (): chrome.runtime.MessageSender => ({ id: "our-extension", url: "chrome-extension://our-extension/options.html" });

describe("body cache sender authorization and tab session binding", () => {
  let stored: Record<string, unknown>;
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); stored = {};
    vi.stubGlobal("chrome", { runtime: { id: "our-extension", getURL: (path: string) => `chrome-extension://our-extension/${path}` }, storage: { session: {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); }),
      remove: vi.fn(async (key: string) => { delete stored[key]; }),
    } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("allows the exact own options page to clear all accounts manually", async () => {
    const { authorizeBodyCacheRequest } = await import("./cachePrivacySession");
    expect(() => authorizeBodyCacheRequest({ operation: "clear", reason: "manual" }, options())).not.toThrow();
    expect(() => authorizeBodyCacheRequest({ operation: "clear", reason: "manual" }, { ...options(), url: `${options().url}?section=storage` })).not.toThrow();
    expect(() => authorizeBodyCacheRequest({ operation: "clear", reason: "manual" }, { ...options(), id: "other-extension" })).toThrow();
    expect(() => authorizeBodyCacheRequest({ operation: "clear", reason: "manual" }, { ...options(), url: "chrome-extension://our-extension/popup.html" })).toThrow();
  });

  it.each(["auth", "logout", "permission"] as const)("accepts a same-server scoped %s content request", async reason => {
    const { authorizeBodyCacheRequest } = await import("./cachePrivacySession");
    expect(() => authorizeBodyCacheRequest({ operation: "clear", scope, reason }, sender())).not.toThrow();
  });

  it("rejects cross-origin, sibling base path, subframes, other extensions, global and manual content requests", async () => {
    const { authorizeBodyCacheRequest } = await import("./cachePrivacySession");
    const message: BodyCachePrivacyRequest = { operation: "clear", scope, reason: "auth" };
    for (const untrusted of [
      sender("https://evil.example/mm/team"), sender("https://chat.example/mm-other/team"),
      { ...sender(), frameId: 1 }, { ...sender(), id: "other-extension" },
      { ...sender(), tab: { id: 7, url: "https://evil.example/mm/team" } } as chrome.runtime.MessageSender,
      { ...sender(), tab: undefined },
    ]) expect(() => authorizeBodyCacheRequest(message, untrusted)).toThrow();
    expect(() => authorizeBodyCacheRequest({ operation: "clear", reason: "auth" }, sender())).toThrow();
    expect(() => authorizeBodyCacheRequest({ operation: "clear", scope, reason: "manual" }, sender())).toThrow();
    expect(() => authorizeBodyCacheRequest({ operation: "clear", scope }, sender())).toThrow();
  });

  it("rejects incoming maintenance regardless of content or options sender", async () => {
    const { authorizeBodyCacheRequest } = await import("./cachePrivacySession");
    for (const source of [sender(), options()]) {
      expect(() => authorizeBodyCacheRequest({ operation: "prune", scope }, source)).toThrow("background-only");
    }
  });

  it("remembers the account across worker reload and expires only the bound tab account", async () => {
    const first = await import("./cachePrivacySession");
    await first.handleBodyCacheSessionRequest({ operation: "bind", scope }, sender());
    const other = { ...scope, userId: "user-b" };
    await first.handleBodyCacheSessionRequest({ operation: "bind", scope: other }, sender(undefined, 8));
    vi.resetModules();
    const restarted = await import("./cachePrivacySession");
    await restarted.handleBodyCacheSessionRequest({ operation: "expire", serverScope: scope.serverScope, reason: "logout" }, sender("https://chat.example/mm/login"));
    expect(clear).toHaveBeenCalledExactlyOnceWith({ operation: "clear", scope, reason: "logout" });
    expect(stored["mattermostDeck.bodyCacheSession.v1:7"]).toBeUndefined();
    expect(stored["mattermostDeck.bodyCacheSession.v1:8"]).toEqual(other);
  });

  it("does not clear globally when no binding exists or its server differs", async () => {
    const { handleBodyCacheSessionRequest } = await import("./cachePrivacySession");
    await handleBodyCacheSessionRequest({ operation: "expire", serverScope: scope.serverScope, reason: "auth" }, sender());
    await handleBodyCacheSessionRequest({ operation: "bind", scope }, sender());
    await handleBodyCacheSessionRequest({ operation: "expire", serverScope: "https://other.example/", reason: "auth" }, sender("https://other.example/login"));
    expect(clear).not.toHaveBeenCalled();
    expect(stored["mattermostDeck.bodyCacheSession.v1:7"]).toEqual(scope);
  });

  it("retains the session binding when deletion fails so a later attempt can retry", async () => {
    const { handleBodyCacheSessionRequest } = await import("./cachePrivacySession");
    await handleBodyCacheSessionRequest({ operation: "bind", scope }, sender());
    clear.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(handleBodyCacheSessionRequest({ operation: "expire", serverScope: scope.serverScope, reason: "auth" }, sender())).rejects.toThrow("disk unavailable");
    expect(stored["mattermostDeck.bodyCacheSession.v1:7"]).toEqual(scope);
    await handleBodyCacheSessionRequest({ operation: "expire", serverScope: scope.serverScope, reason: "auth" }, sender());
    expect(stored["mattermostDeck.bodyCacheSession.v1:7"]).toBeUndefined();
  });

  it("expires the captured old account without deleting a newer account binding", async () => {
    const { handleBodyCacheSessionRequest } = await import("./cachePrivacySession");
    const newer = { ...scope, userId: "user-b" };
    await handleBodyCacheSessionRequest({ operation: "bind", scope: newer }, sender());
    await handleBodyCacheSessionRequest({ operation: "expire", serverScope: scope.serverScope, reason: "auth", scope }, sender());
    expect(clear).toHaveBeenCalledExactlyOnceWith({ operation: "clear", scope, reason: "auth" });
    expect(stored["mattermostDeck.bodyCacheSession.v1:7"]).toEqual(newer);
  });

  it("does not remove an account rebound while the previous cleanup is in flight", async () => {
    const { handleBodyCacheSessionRequest } = await import("./cachePrivacySession");
    const newer = { ...scope, userId: "user-b" };
    await handleBodyCacheSessionRequest({ operation: "bind", scope }, sender());
    let finish!: () => void;
    clear.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); }));
    const expiry = handleBodyCacheSessionRequest({ operation: "expire", serverScope: scope.serverScope, reason: "auth", scope }, sender());
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
    const binding = handleBodyCacheSessionRequest({ operation: "bind", scope: newer }, sender());
    await new Promise(resolve => setTimeout(resolve, 0));
    finish();
    await Promise.all([expiry, binding]);
    expect(stored["mattermostDeck.bodyCacheSession.v1:7"]).toEqual(newer);
  });
});
