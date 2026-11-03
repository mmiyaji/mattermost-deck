import { handleBodyCachePrivacyRequest } from "./cachePrivacyStorage";
import { validateBodyCachePrivacyRequest, type BodyCacheScope, type BodyCachePrivacyRequest } from "./cachePrivacyProtocol";

const KEY = "mattermostDeck.bodyCacheSession.v1:";
const sessionQueues = new Map<number, Promise<void>>();
function matchesServer(url: string | undefined, server: string): boolean {
  try {
    const actual = new URL(url ?? ""), expected = new URL(server);
    const base = expected.pathname.replace(/\/$/, "");
    return actual.origin === expected.origin && (actual.pathname === base || actual.pathname.startsWith(`${base}/`));
  } catch { return false; }
}
function isOwnOptions(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL("options.html");
}
function requireContentSender(sender: chrome.runtime.MessageSender, scope: BodyCacheScope): number {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined ||
      !matchesServer(sender.url, scope.serverScope) || !matchesServer(sender.tab.url, scope.serverScope)) throw new Error("Invalid body cache sender");
  return sender.tab.id;
}
export function authorizeBodyCacheRequest(message: BodyCachePrivacyRequest, sender: chrome.runtime.MessageSender): void {
  validateBodyCachePrivacyRequest(message);
  if (message.operation !== "clear") throw new Error("Cache maintenance is background-only");
  if (isOwnOptions(sender)) return;
  if (!message.scope || !["auth", "logout", "permission"].includes(message.reason ?? "")) throw new Error("A content request requires an account scope and lifecycle reason");
  requireContentSender(sender, message.scope);
}
interface SessionRequest {
  operation?: string; scope?: BodyCacheScope; serverScope?: string; reason?: "auth" | "logout";
}
export function handleBodyCacheSessionRequest(message: SessionRequest, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id ?? -1;
  const task = (sessionQueues.get(tabId) ?? Promise.resolve()).catch(() => undefined)
    .then(() => processSessionRequest(message, sender));
  sessionQueues.set(tabId, task);
  const cleanup = () => { if (sessionQueues.get(tabId) === task) sessionQueues.delete(tabId); };
  void task.then(cleanup, cleanup);
  return task;
}
async function processSessionRequest(message: SessionRequest, sender: chrome.runtime.MessageSender): Promise<void> {
  if (message.operation === "bind" && message.scope) {
    validateBodyCachePrivacyRequest({ operation: "clear", scope: message.scope });
    const tabId = requireContentSender(sender, message.scope);
    await chrome.storage.session.set({ [`${KEY}${tabId}`]: message.scope });
    return;
  }
  if (message.operation !== "expire" || !message.serverScope || !["auth", "logout"].includes(message.reason ?? "")) throw new Error("Invalid body cache session operation");
  const tabId = requireContentSender(sender, { serverScope: message.serverScope, userId: "session" });
  const key = `${KEY}${tabId}`;
  const bound = (await chrome.storage.session.get(key))[key] as BodyCacheScope | undefined;
  let stored = bound;
  if (message.scope?.serverScope === message.serverScope) {
    validateBodyCachePrivacyRequest({ operation: "clear", scope: message.scope });
    stored = message.scope;
  }
  if (!stored || stored.serverScope !== message.serverScope) return;
  await handleBodyCachePrivacyRequest({ operation: "clear", scope: stored, reason: message.reason });
  if (bound?.serverScope === stored.serverScope && bound.userId === stored.userId) await chrome.storage.session.remove(key);
}
