import { FAVORITE_CACHE_STORAGE_MESSAGE, type FavoriteBodyCacheEntry, type FavoriteCacheStorageRequest } from "../favoriteCacheProtocol";
import { favoriteMembership, favoritePostVersion, FAVORITES_CACHE_TTL_MS, type Favorite } from "./favorites";

export function favoriteCacheScope(server: string, userId: string): string {
  return JSON.stringify([server, userId]);
}

export async function favoriteCacheRequest(message: FavoriteCacheStorageRequest): Promise<FavoriteBodyCacheEntry[]> {
  const result = await chrome.runtime.sendMessage({ type: FAVORITE_CACHE_STORAGE_MESSAGE, ...message });
  if (!result?.success) throw new Error(result?.error ?? "Favorite cache service is unavailable");
  return Array.isArray(result.entries) ? result.entries : [];
}

export function favoriteBodies(entries: Favorite[]): FavoriteBodyCacheEntry[] {
  return entries.filter(entry => entry.checkedAt > 0).map(({ id, revision, checkedAt, post, requestStartedAt }) => ({
    id, revision, checkedAt, post, requestStartedAt: requestStartedAt ?? checkedAt,
  }));
}

export function hydrateFavorites(members: Favorite[], bodies: FavoriteBodyCacheEntry[], previous: Favorite[] = [], now = Date.now()): Favorite[] {
  const cached = new Map(bodies.map(body => [body.id, body]));
  const retained = new Map(previous.map(entry => [entry.id, entry]));
  return members.map(member => {
    let result = member;
    const old = retained.get(member.id);
    if (old?.revision === member.revision && old.checkedAt > 0 && now - old.checkedAt < FAVORITES_CACHE_TTL_MS && old.checkedAt <= now + 60_000) result = { ...member, ...old };
    const body = cached.get(member.id);
    if (body?.revision === member.revision && (body.deleted ||
        ((body.requestStartedAt >= (result.requestStartedAt ?? result.checkedAt)) &&
          (!body.post || favoritePostVersion(body.post) >= favoritePostVersion(result.post))))) {
      result = { ...member, ...body };
    }
    return result;
  });
}

// Legacy inline bodies remain untouched until the extension-origin DB commits.
// New favorites always use only the small membership representation locally.
export function membershipWithUnmigratedLegacy(members: Favorite[], raw: unknown): unknown[] {
  const old = new Map((Array.isArray(raw) ? raw : []).filter(value => value && typeof value === "object")
    .map(value => [value.id, value]));
  return favoriteMembership(members).map(member => {
    const legacy = old.get(member.id);
    return legacy?.revision === member.revision && legacy.post ? { ...member, checkedAt: legacy.checkedAt, post: legacy.post } : member;
  });
}
