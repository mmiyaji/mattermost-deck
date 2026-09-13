import type { MattermostPost } from "../mattermost/api";

export const FAVORITES_LIMIT = 100;
export const FAVORITES_REFRESH_MS = 5 * 60_000;
export const FAVORITES_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
export interface Favorite {
  id: string;
  revision: string;
  addedAt: number;
  checkedAt: number;
  post: MattermostPost | null;
}

export function favoriteStorageKey(server: string, user: string): string {
  return `mattermostDeck.favorites.v1:${encodeURIComponent(server)}:${encodeURIComponent(user)}`;
}

// Persist only bounded display data, never arbitrary props or attachment bodies.
export function cacheFavoritePost(value: unknown): MattermostPost | null {
  if (!value || typeof value !== "object") return null;
  const p = value as MattermostPost;
  if (![p.id, p.user_id, p.channel_id].every(v => typeof v === "string" && /^[a-z0-9_-]{1,128}$/i.test(v))
    || typeof p.message !== "string" || !Number.isFinite(p.create_at) || p.create_at < 0 || p.delete_at) return null;
  return {
    id: p.id, user_id: p.user_id, channel_id: p.channel_id,
    create_at: p.create_at, message: p.message.slice(0, 16_000),
    root_id: typeof p.root_id === "string" ? p.root_id.slice(0, 128) : undefined,
    update_at: Number.isFinite(p.update_at) ? p.update_at : undefined,
    edit_at: Number.isFinite(p.edit_at) ? p.edit_at : undefined,
    file_ids: Array.isArray(p.file_ids) ? p.file_ids.filter(id => typeof id === "string" && /^[a-z0-9]{1,128}$/i.test(id)).slice(0, 10) : [],
  };
}

export function readFavorites(value: unknown, now = Date.now()): Favorite[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((v): Favorite[] => {
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(v.id)
      || ids.has(v.id) || typeof v.revision !== "string" || v.revision.length > 128
      || !Number.isFinite(v.addedAt) || !Number.isFinite(v.checkedAt)) return [];
    ids.add(v.id);
    const post = cacheFavoritePost(v.post);
    const fresh = now - v.checkedAt < FAVORITES_CACHE_TTL_MS && v.checkedAt <= now + 60_000;
    return [{ id: v.id, revision: v.revision, addedAt: v.addedAt, checkedAt: fresh ? v.checkedAt : 0,
      post: fresh && post?.id === v.id ? post : null }];
  }).slice(0, FAVORITES_LIMIT).sort((a, b) => b.addedAt - a.addedAt);
}

// Reconcile only the captured membership revision: removal/re-addition during
// a request must never be undone by that request's stale response.
export function reconcileFavorites(current: Favorite[], requested: Favorite[], posts: MattermostPost[], now: number): Favorite[] {
  const revisions = new Map(requested.map(f => [f.id, f.revision]));
  const byId = new Map(posts.map(p => [p.id, p]));
  return current.map(f => revisions.get(f.id) === f.revision
    ? { ...f, checkedAt: now, post: cacheFavoritePost(byId.get(f.id)) }
    : f);
}
