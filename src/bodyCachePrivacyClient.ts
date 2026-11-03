import { BODY_CACHE_PRIVACY_MESSAGE, BODY_CACHE_PRIVACY_CHANGED_KEY, type BodyCacheScope, type BodyCachePrivacyReason } from "./cachePrivacyProtocol";

export const BODY_CACHE_SESSION_MESSAGE = "mattermost-deck:body-cache-session";
let identity: BodyCacheScope | undefined;
let epoch = 0;
let bindingAcknowledged = false;
let binding: Promise<void> | undefined;
const pending = new Map<string, Promise<void>>();
type ClearNotice = { scope: BodyCacheScope | null; reason: BodyCachePrivacyReason };
const listeners = new Set<(change: ClearNotice) => void>();
function notify(change: ClearNotice): void {
  invalidateBodyCacheMemory();
  for (const listener of listeners) { try { listener(change); } catch { /* UI observers must not prevent cleanup. */ } }
}
export function subscribeBodyCacheClears(listener: (change: ClearNotice) => void): () => void {
  listeners.add(listener);
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged?.addListener) return () => { listeners.delete(listener); };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const change = changes[BODY_CACHE_PRIVACY_CHANGED_KEY]?.newValue as ClearNotice | undefined;
    if (area === "session" && change && ["manual", "auth", "logout", "permission"].includes(change.reason) &&
        (change.scope === null || (change.scope && typeof change.scope.serverScope === "string" && typeof change.scope.userId === "string"))) {
      invalidateBodyCacheMemory();
      try { listener(change); } catch { /* A failed view must not interrupt other cleanup observers. */ }
    }
  };
  chrome.storage.onChanged.addListener(changed);
  return () => { listeners.delete(listener); chrome.storage.onChanged.removeListener(changed); };
}
export function bodyCacheScopeMatches(change: ClearNotice, scope: BodyCacheScope): boolean {
  return change.scope === null || (change.scope.serverScope === scope.serverScope && change.scope.userId === scope.userId);
}
export const bodyCachePrivacyEpoch = () => epoch;
export function invalidateBodyCacheMemory(): void { epoch++; }
export function bodyCacheIdentity(): BodyCacheScope | undefined { return identity && { ...identity }; }
async function send(message: object): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) throw new Error("Body cache service is unavailable");
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) throw new Error(response?.error ?? "Body cache cleanup failed");
}
export function bindBodyCacheIdentity(scope: BodyCacheScope): void {
  const same = identity?.serverScope === scope.serverScope && identity.userId === scope.userId;
  if (same && (bindingAcknowledged || binding)) return;
  if (identity && !same) invalidateBodyCacheMemory();
  identity = { ...scope };
  bindingAcknowledged = false;
  const request = send({ type: BODY_CACHE_SESSION_MESSAGE, operation: "bind", scope });
  binding = request;
  void request.then(() => { if (binding === request) bindingAcknowledged = true; }, () => undefined)
    .finally(() => { if (binding === request) binding = undefined; });
}
export async function clearBodyCaches(reason: BodyCachePrivacyReason = "manual", scope?: BodyCacheScope): Promise<void> {
  notify({ scope: scope ?? null, reason });
  await send({ type: BODY_CACHE_PRIVACY_MESSAGE, operation: "clear", reason, ...(scope ? { scope } : {}) });
}
export async function expireBodyCacheSession(serverScope: string, reason: "logout" | "auth" = "auth", expectedIdentity: BodyCacheScope | null | undefined = identity): Promise<void> {
  const scoped = expectedIdentity?.serverScope === serverScope ? expectedIdentity : undefined;
  const key = `${serverScope}:${scoped?.userId ?? "bound"}:${reason}`;
  if (pending.has(key)) return pending.get(key)!;
  notify({ scope: scoped ?? null, reason });
  const request = send({ type: BODY_CACHE_SESSION_MESSAGE, operation: "expire", serverScope, reason,
    ...(scoped ? { scope: scoped } : {}) })
    .then(() => {
      if (scoped && identity?.serverScope === scoped.serverScope && identity.userId === scoped.userId) bindingAcknowledged = false;
    })
    .finally(() => { pending.delete(key); });
  pending.set(key, request);
  await request;
}
/** Feature-level 403 (groups, thread compatibility, admin APIs) is not loss of post access. */
export function isBodyAccessDenied(status: number, path: string): boolean {
  return status === 403 && /^\/(?:api\/v4\/)?(?:channels\/[^/?]+(?:\/posts)?|posts\/[^/?]+(?:\/thread)?|teams\/[^/?]+\/posts\/search)\/?(?:\?|$)/.test(path);
}
