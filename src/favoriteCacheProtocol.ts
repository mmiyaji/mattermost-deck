import type { MattermostPost } from "./mattermost/api";
import type { FavoriteMembership } from "./ui/favorites";

export const FAVORITE_CACHE_STORAGE_MESSAGE = "mattermost-deck:favorite-cache-storage";
export const FAVORITE_CACHE_CHANGED_KEY = "mattermostDeck.favoriteCacheChanged.v1";
export const FAVORITE_CACHE_MAX_BYTES = 16 * 1024 * 1024;
export const FAVORITE_CACHE_MAX_ENTRIES = 5000;

export interface FavoriteBodyCacheEntry {
  id: string;
  revision: string;
  checkedAt: number;
  requestStartedAt: number;
  post: MattermostPost | null;
  deleted?: boolean;
}

export interface FavoriteCacheStorageRequest {
  operation: "get" | "put" | "invalidate" | "remove";
  scope: string;
  members?: FavoriteMembership[];
  entries?: FavoriteBodyCacheEntry[];
  ids?: string[];
  now?: number;
}
