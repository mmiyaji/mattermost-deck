export const BODY_CACHE_PRIVACY_MESSAGE = "mattermost-deck:body-cache-privacy";
export const BODY_CACHE_PRIVACY_CHANGED_KEY = "mattermostDeck.bodyCachePrivacyChanged.v1";

export interface BodyCacheScope {
  serverScope: string;
  userId: string;
}
export type BodyCachePrivacyReason = "manual" | "logout" | "auth" | "permission";
export interface BodyCachePrivacyRequest {
  operation: "clear" | "prune";
  scope?: BodyCacheScope;
  reason?: BodyCachePrivacyReason;
}
export interface BodyCachePrivacyChange {
  scope: BodyCacheScope | null;
  reason: BodyCachePrivacyReason;
  clearedAt: number;
  revision: string;
}

export function validateBodyCachePrivacyRequest(message: BodyCachePrivacyRequest): void {
  if (!message || !["clear", "prune"].includes(message.operation)) throw new Error("Invalid body cache operation");
  if (message.scope !== undefined) {
    const scope = message.scope;
    if (!scope || typeof scope !== "object" || typeof scope.serverScope !== "string" ||
        scope.serverScope.length > 4096 || typeof scope.userId !== "string" || !scope.userId.length || scope.userId.length > 128) {
      throw new Error("Invalid body cache account scope");
    }
    let url: URL;
    try { url = new URL(scope.serverScope); } catch { throw new Error("Invalid body cache server"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid body cache server");
  }
  if (message.reason !== undefined && !["manual", "logout", "auth", "permission"].includes(message.reason)) throw new Error("Invalid body cache reason");
}
