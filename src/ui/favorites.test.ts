import { describe, expect, it } from "vitest";
import { cacheFavoritePost, favoriteMembership, favoriteStorageKey, FAVORITES_CACHE_TTL_MS, readFavorites, reconcileFavorites, type Favorite } from "./favorites";
import { hydrateFavorites, membershipWithUnmigratedLegacy } from "./favoriteCache";
import { normaliseColumns } from "./storage";

const post = { id: "p", user_id: "u", channel_id: "c", message: "hello", create_at: 1 };
const entry: Favorite = { id: "p", revision: "first", addedAt: 10, checkedAt: 10, post };

describe("favorite persistence and cache", () => {
  it("separates accounts and server subpaths", () => {
    expect(new Set([
      favoriteStorageKey("https://example.test/a/", "one"),
      favoriteStorageKey("https://example.test/b/", "one"),
      favoriteStorageKey("https://example.test/a/", "two"),
    ]).size).toBe(3);
  });
  it("retains favorite membership when the cached body expires", () => {
    expect(readFavorites([entry], 11)[0].post).toEqual(expect.objectContaining(post));
    expect(readFavorites([entry], 11 + FAVORITES_CACHE_TTL_MS)[0]).toMatchObject({ id: "p", post: null, checkedAt: 0 });
  });
  it("stores durable membership without any cached body or check timestamp", () => {
    expect(favoriteMembership([entry])).toEqual([{ id: "p", revision: "first", addedAt: 10 }]);
    expect(readFavorites(favoriteMembership([entry]), 11)).toEqual([{ id: "p", revision: "first", addedAt: 10, checkedAt: 0, post: null }]);
    expect(membershipWithUnmigratedLegacy([entry], [entry])).toEqual([entry]);
    expect(membershipWithUnmigratedLegacy([entry], favoriteMembership([entry]))).toEqual(favoriteMembership([entry]));
  });
  it("bounds persisted content and excludes arbitrary metadata", () => {
    const cached = cacheFavoritePost({ ...post, message: "x".repeat(100_000), props: { secret: "not needed" }, file_ids: Array(20).fill("file") });
    expect(cached?.message.length).toBe(16_000);
    expect(cached?.file_ids?.length).toBe(10);
    expect(cached).not.toHaveProperty("props");
  });
  it("rejects corrupt, mismatched and duplicate cache entries", () => {
    expect(readFavorites([null, {}, entry, entry], 11)).toHaveLength(1);
    expect(readFavorites([{ ...entry, post: { ...post, id: "other" } }], 11)[0].post).toBeNull();
    expect(cacheFavoritePost({ ...post, delete_at: 12 })).toBeNull();
    expect(readFavorites(Array.from({ length: 120 }, (_, i) => ({ ...entry, id: `p${i}` })), 11)).toHaveLength(100);
  });
  it("updates edited posts and hides bodies of removed or inaccessible posts", () => {
    expect(reconcileFavorites([entry], [entry], [{ ...post, message: "edited" }], 20)[0].post?.message).toBe("edited");
    expect(reconcileFavorites([entry], [entry], [], 20)[0]).toMatchObject({ id: "p", post: null, checkedAt: 20 });
  });
  it("never resurrects a removed favorite or overwrites a re-added favorite", () => {
    expect(reconcileFavorites([], [entry], [post], 20)).toEqual([]);
    const readded = { ...entry, revision: "second", post: { ...post, message: "newer" } };
    expect(reconcileFavorites([readded], [entry], [post], 20)).toEqual([readded]);
  });
  it("does not replace a newer post version with a late older refresh", () => {
    const newer = { ...entry, checkedAt: 200, post: { ...post, message: "new", update_at: 200 } };
    expect(reconcileFavorites([newer], [entry], [{ ...post, update_at: 100 }], 300, 100)).toEqual([newer]);
    expect(hydrateFavorites([entry], [{ id: "p", revision: "first", checkedAt: 300, requestStartedAt: 300,
      post: { ...post, update_at: 100 } }], [newer], 300)).toEqual([newer]);
  });
  it("does not retain an expired in-memory body when the disk cache has evicted it", () => {
    const metadata = readFavorites(favoriteMembership([entry]), 10 + FAVORITES_CACHE_TTL_MS);
    expect(hydrateFavorites(metadata, [], [entry], 10 + FAVORITES_CACHE_TTL_MS)).toEqual(metadata);
  });
  it("does not let a delayed response overwrite a newer check or a deletion", () => {
    const newer = { ...entry, checkedAt: 200, requestStartedAt: 150, post: { ...post, update_at: 200 } };
    expect(reconcileFavorites([newer], [entry], [], 300, 100)).toEqual([newer]);
    const imported = { ...entry, checkedAt: 200 };
    expect(reconcileFavorites([imported], [entry], [], 300, 100)).toEqual([imported]);
    const deleted = { ...newer, post: null, deleted: true };
    expect(reconcileFavorites([deleted], [entry], [post], 400, 400)).toEqual([deleted]);
  });
  it("preserves favorites panes when loading or importing layouts", () => {
    expect(normaliseColumns([{ id: "favorites", type: "favorites" }])).toEqual([{ id: "favorites", type: "favorites" }]);
  });
});
