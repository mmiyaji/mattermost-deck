import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getPostsByIds, type MattermostPost } from "../mattermost/api";
import { getLocalizedApiErrorMessage } from "./apiErrorMessage";
import i18n from "./i18n";
import { cacheFavoritePost, favoriteStorageKey, FAVORITES_LIMIT, FAVORITES_REFRESH_MS, readFavorites, reconcileFavorites, type Favorite } from "./favorites";

interface FavoritesValue {
  entries: Favorite[];
  ready: boolean;
  refreshing: boolean;
  error: string | null;
  toggle: (post: MattermostPost) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
}
const FavoritesContext = createContext<FavoritesValue | null>(null);
export const useFavorites = () => useContext(FavoritesContext);

export function FavoritesProvider({ server, userId, children }: {
  server: string; userId: string | null; children: React.ReactNode;
}): React.JSX.Element {
  const key = favoriteStorageKey(server, userId ?? "");
  const [entries, setEntries] = useState<Favorite[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const busy = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    active.current = true;
    let changed = false;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[key]) {
        changed = true;
        setEntries(readFavorites(changes[key].newValue));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    if (userId) void navigator.locks.request(key, async () => {
      const result = await chrome.storage.local.get(key);
      const normalized = readFavorites(result[key]);
      if (active.current && result[key] !== undefined && JSON.stringify(result[key]) !== JSON.stringify(normalized)) {
        await chrome.storage.local.set({ [key]: normalized });
      }
      return normalized;
    }).then(result => {
      if (active.current) {
        if (!changed) setEntries(result);
        setReady(true);
      }
    }).catch(() => { if (active.current) setError(i18n.t("deck.favoritesError")); });
    return () => { active.current = false; chrome.storage.onChanged.removeListener(listener); };
  }, [key, userId]);

  const mutate = useCallback(async (update: (current: Favorite[]) => Favorite[]) => {
    if (!userId || !active.current) return;
    // Same-origin tabs share this lock. Do not fall back to page localStorage:
    // post bodies must stay in the extension's storage.
    await navigator.locks.request(key, async () => {
      if (!active.current) return;
      const stored = await chrome.storage.local.get(key);
      const next = update(readFavorites(stored[key]));
      await chrome.storage.local.set({ [key]: next });
      if (active.current) { setEntries(next); setError(null); }
    });
  }, [key, userId]);

  const remove = useCallback(async (id: string) => {
    try { await mutate(current => current.filter(f => f.id !== id)); }
    catch { if (active.current) setError(i18n.t("deck.favoritesError")); }
  }, [mutate]);
  const toggle = useCallback(async (post: MattermostPost) => {
    try {
      await mutate(current => {
        if (current.some(f => f.id === post.id)) return current.filter(f => f.id !== post.id);
        if (current.length >= FAVORITES_LIMIT) throw new Error("favorites-limit");
        const cached = cacheFavoritePost(post);
        if (!cached) throw new Error("invalid-post");
        return [{ id: post.id, revision: crypto.randomUUID(), addedAt: Date.now(), checkedAt: Date.now(), post: cached }, ...current];
      });
    } catch (e) { if (active.current) setError(i18n.t(e instanceof Error && e.message === "favorites-limit" ? "deck.favoritesLimit" : "deck.favoritesError")); }
  }, [mutate]);
  const refresh = useCallback(async (force = false) => {
    if (!ready || busy.current || !active.current || document.visibilityState === "hidden") return;
    const requested = entriesRef.current.filter(f => force || Date.now() - f.checkedAt >= FAVORITES_REFRESH_MS);
    if (!requested.length) return;
    busy.current = true;
    setRefreshing(true);
    try {
      const posts = await getPostsByIds(requested.map(f => f.id), { maxAgeMs: force ? 0 : FAVORITES_REFRESH_MS });
      if (active.current) await mutate(current => reconcileFavorites(current, requested, posts, Date.now()));
    } catch (e) {
      if (active.current) setError(getLocalizedApiErrorMessage(e, i18n.t("deck.favoritesError")));
    } finally {
      busy.current = false;
      if (active.current) setRefreshing(false);
    }
  }, [ready, mutate]);

  const value = useMemo(() => ({ entries, ready, refreshing, error, toggle, remove, refresh }),
    [entries, ready, refreshing, error, toggle, remove, refresh]);
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
