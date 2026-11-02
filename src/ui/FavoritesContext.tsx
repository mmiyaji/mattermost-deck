import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getPostsByIds, type MattermostPost } from "../mattermost/api";
import { getLocalizedApiErrorMessage } from "./apiErrorMessage";
import i18n from "./i18n";
import { cacheFavoritePost, favoriteMembership, favoriteStorageKey, FAVORITES_LIMIT, FAVORITES_REFRESH_MS, readFavorites, reconcileFavorites, type Favorite } from "./favorites";
import { FAVORITE_CACHE_CHANGED_KEY } from "../favoriteCacheProtocol";
import { favoriteBodies, favoriteCacheRequest, favoriteCacheScope, hydrateFavorites, membershipWithUnmigratedLegacy } from "./favoriteCache";

interface FavoritesValue {
  entries: Favorite[];
  ready: boolean;
  refreshing: boolean;
  error: string | null;
  toggle: (post: MattermostPost) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  invalidateDeleted: (ids: string[]) => Promise<void>;
}
const FavoritesContext = createContext<FavoritesValue | null>(null);
export const useFavorites = () => useContext(FavoritesContext);
const EMPTY_DELETED_POST_IDS: string[] = [];

export function FavoritesProvider({ server, userId, children, deletedPostIds = EMPTY_DELETED_POST_IDS }: {
  server: string; userId: string | null; children: React.ReactNode; deletedPostIds?: string[];
}): React.JSX.Element {
  const key = favoriteStorageKey(server, userId ?? "");
  const scope = favoriteCacheScope(server, userId ?? "");
  const [entries, setEntries] = useState<Favorite[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const busy = useRef(false);
  const entriesRef = useRef(entries);
  const deleted = useRef(new Set<string>());
  const loadRevision = useRef(0);
  const publish = useCallback((next: Favorite[]) => {
    if (!active.current) return;
    const safe = next.map(entry => deleted.current.has(entry.id) ? { ...entry, post: null, deleted: true } : entry);
    for (const entry of safe) if (entry.deleted) deleted.current.add(entry.id);
    entriesRef.current = safe;
    setEntries(safe);
  }, []);

  const reload = useCallback(async () => {
    if (!userId) return;
    const revision = ++loadRevision.current;
    const members = await navigator.locks.request(key, async () => {
      const stored = await chrome.storage.local.get(key);
      const normalized = readFavorites(stored[key]);
      const legacy = Array.isArray(stored[key]) && stored[key].some(value => value && Object.hasOwn(value, "post"));
      if (legacy) {
        try {
          const bodies = favoriteBodies(normalized);
          if (bodies.length) await favoriteCacheRequest({ operation: "put", scope, entries: bodies });
          // The body transaction committed before the old inline copy is removed.
          await chrome.storage.local.set({ [key]: favoriteMembership(normalized) });
        } catch { /* Keep the old inline bodies for a later migration retry. */ }
      }
      return normalized;
    });
    let bodies = [] as Awaited<ReturnType<typeof favoriteCacheRequest>>;
    try { bodies = await favoriteCacheRequest({ operation: "get", scope, members: favoriteMembership(members) }); }
    catch { /* Durable membership remains usable when the body cache is unavailable. */ }
    if (active.current && revision === loadRevision.current) {
      publish(hydrateFavorites(members, bodies, entriesRef.current));
      setReady(true);
    }
  }, [key, scope, userId, publish]);

  useEffect(() => {
    active.current = true;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if ((area === "local" && changes[key]) ||
          (area === "session" && (changes[FAVORITE_CACHE_CHANGED_KEY]?.newValue as { scope?: string } | undefined)?.scope === scope)) void reload().catch(() => undefined);
    };
    chrome.storage.onChanged.addListener(listener);
    if (userId) void reload().catch(() => { if (active.current) setError(i18n.t("deck.favoritesError")); });
    return () => { active.current = false; loadRevision.current++; chrome.storage.onChanged.removeListener(listener); };
  }, [key, scope, userId, reload]);

  const mutate = useCallback(async (update: (current: Favorite[]) => Favorite[]) => {
    if (!userId || !active.current) return;
    // Same-origin tabs share this lock. Do not fall back to page localStorage:
    // post bodies must stay in the extension's storage.
    return await navigator.locks.request(key, async () => {
      if (!active.current) return;
      const stored = await chrome.storage.local.get(key);
      const next = update(hydrateFavorites(readFavorites(stored[key]), [], entriesRef.current));
      await chrome.storage.local.set({ [key]: membershipWithUnmigratedLegacy(next, stored[key]) });
      if (active.current) { publish(next); setError(null); }
      return next;
    });
  }, [key, userId, publish]);

  const remove = useCallback(async (id: string) => {
    const old = entriesRef.current.find(entry => entry.id === id);
    try {
      await mutate(current => current.filter(f => f.id !== id));
      if (old) await favoriteCacheRequest({ operation: "remove", scope, ids: [id], members: favoriteMembership([old]) }).catch(() => undefined);
    }
    catch { if (active.current) setError(i18n.t("deck.favoritesError")); }
  }, [mutate, scope]);
  const toggle = useCallback(async (post: MattermostPost) => {
    try {
      const wasSelected = entriesRef.current.find(entry => entry.id === post.id);
      const next = await mutate(current => {
        if (current.some(f => f.id === post.id)) return current.filter(f => f.id !== post.id);
        if (current.length >= FAVORITES_LIMIT) throw new Error("favorites-limit");
        const cached = cacheFavoritePost(post);
        if (!cached) throw new Error("invalid-post");
        return [{ id: post.id, revision: crypto.randomUUID(), addedAt: Date.now(), checkedAt: Date.now(), post: cached }, ...current];
      });
      const added = next?.find(entry => entry.id === post.id);
      if (added) await favoriteCacheRequest({ operation: "put", scope, entries: favoriteBodies([added]) }).catch(() => undefined);
      else if (wasSelected) await favoriteCacheRequest({ operation: "remove", scope, ids: [post.id], members: favoriteMembership([wasSelected]) }).catch(() => undefined);
    } catch (e) { if (active.current) setError(i18n.t(e instanceof Error && e.message === "favorites-limit" ? "deck.favoritesLimit" : "deck.favoritesError")); }
  }, [mutate, scope]);
  const invalidateDeleted = useCallback(async (ids: string[]) => {
    const known = ids.filter(id => entriesRef.current.some(entry => entry.id === id) && !deleted.current.has(id));
    if (!known.length) return;
    for (const id of known) deleted.current.add(id);
    publish(entriesRef.current);
    await favoriteCacheRequest({ operation: "invalidate", scope, ids: known }).catch(() => undefined);
  }, [scope, publish]);
  useEffect(() => { void invalidateDeleted(deletedPostIds); }, [deletedPostIds, entries, invalidateDeleted]);
  const refresh = useCallback(async (force = false) => {
    if (!ready || busy.current || !active.current || document.visibilityState === "hidden") return;
    const requested = entriesRef.current.filter(f => !deleted.current.has(f.id) && (force || Date.now() - f.checkedAt >= FAVORITES_REFRESH_MS));
    if (!requested.length) return;
    busy.current = true;
    setRefreshing(true);
    const requestStartedAt = Date.now();
    try {
      const posts = await getPostsByIds(requested.map(f => f.id), { maxAgeMs: force ? 0 : FAVORITES_REFRESH_MS });
      if (!active.current) return;
      const stored = await navigator.locks.request(key, () => chrome.storage.local.get(key));
      const current = hydrateFavorites(readFavorites(stored[key]), [], entriesRef.current);
      const now = Date.now();
      publish(reconcileFavorites(current, requested, posts, now, requestStartedAt));
      const byId = new Map(posts.map(post => [post.id, post]));
      await favoriteCacheRequest({ operation: "put", scope, entries: requested.filter(entry => !deleted.current.has(entry.id)).map(entry => ({
        id: entry.id, revision: entry.revision, checkedAt: now, requestStartedAt, post: cacheFavoritePost(byId.get(entry.id)),
      })) }).catch(() => undefined);
      await reload();
    } catch (e) {
      if (active.current) setError(getLocalizedApiErrorMessage(e, i18n.t("deck.favoritesError")));
    } finally {
      busy.current = false;
      if (active.current) setRefreshing(false);
    }
  }, [ready, key, scope, publish, reload]);

  const value = useMemo(() => ({ entries, ready, refreshing, error, toggle, remove, refresh, invalidateDeleted }),
    [entries, ready, refreshing, error, toggle, remove, refresh, invalidateDeleted]);
  return <FavoritesContext.Provider value={value}>
    {children}
    {error ? <div className="deck-favorites-error" role="alert">{error}<button type="button" className="deck-button" onClick={() => setError(null)}>{i18n.t("deck.close")}</button></div> : null}
  </FavoritesContext.Provider>;
}

export function FavoriteButton({ post }: { post: MattermostPost }): React.JSX.Element | null {
  const favorites = useFavorites();
  if (!favorites) return null;
  const selected = favorites.entries.some(f => f.id === post.id);
  const label = i18n.t(selected ? "deck.favoriteRemove" : "deck.favoriteAdd");
  return <button type="button" className="deck-icon-button deck-icon-button--ghost deck-favorite-button"
    aria-label={label} title={label} aria-pressed={selected} disabled={!favorites.ready}
    onClick={e => { e.stopPropagation(); void favorites.toggle(post); }}>
    <span aria-hidden="true">{selected ? "★" : "☆"}</span>
  </button>;
}
