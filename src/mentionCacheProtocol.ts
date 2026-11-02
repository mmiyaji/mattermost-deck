/** Shared limits for the extension-owned display cache, separate from review decisions. */
export const MENTION_CACHE_STORAGE_MESSAGE = "mattermost-deck:mention-cache-storage";
export const MENTION_CACHE_MAX_ENTRIES = 64;
export const MENTION_CACHE_MAX_BYTES = 16 * 1024 * 1024;
export const MENTION_CACHE_MAX_SNAPSHOT_BYTES = 512 * 1024;
export const MENTION_CACHE_HARD_TTL_MS = 24 * 60 * 60_000;
