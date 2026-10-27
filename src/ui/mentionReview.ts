import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { MattermostPost } from "../mattermost/api";

export interface ReviewEntry { post: MattermostPost; confirmedAt: number | null }
interface Snapshot { values: Record<string, unknown>; ready: boolean; error: string | null }
interface Store { snapshot: Snapshot; listeners: Set<() => void>; loaded: Promise<void>; queue: Promise<void>; cleanup?: ReturnType<typeof setTimeout> }
const stores = new Map<string, Store>();
export const reviewPrefix = (server: string, user: string) => `mattermostDeck.mentionReview.v1:${encodeURIComponent(server)}:${encodeURIComponent(user)}:`;
export const reviewScope = (team?: string) => encodeURIComponent(team ?? "*");
const storage = () => typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function publish(store: Store, snapshot: Snapshot) { store.snapshot = snapshot; store.listeners.forEach(listener => listener()); }
function getStore(prefix: string): Store {
  const existing = stores.get(prefix);
  if (existing) return existing;
  const store: Store = { snapshot: { values: {}, ready: false, error: null }, listeners: new Set(), loaded: Promise.resolve(), queue: Promise.resolve() };
  stores.set(prefix, store);
  store.loaded = (async () => {
    try {
      const area = storage();
      const all = area ? await area.get(null) : Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith(prefix)).flatMap(key => {
        try { return [[key, JSON.parse(localStorage.getItem(key)!)]]; } catch { return []; }
      }));
      publish(store, { values: Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(prefix))), ready: true, error: null });
    } catch (error) { publish(store, { ...store.snapshot, ready: true, error: message(error) }); }
  })();
  return store;
}

// Each membership, confirmation and deletion has its own key. Tabs ingesting
// different scopes cannot overwrite each other's confirmation decisions.
export async function writeReview(prefix: string, update: Record<string, unknown> | ((values: Record<string, unknown>) => Record<string, unknown>)): Promise<void> {
  const store = getStore(prefix);
  const operation = store.queue.catch(() => undefined).then(async () => {
    await store.loaded;
    try {
      const values = typeof update === "function" ? update(store.snapshot.values) : update;
      if (!Object.keys(values).length) return;
      const area = storage();
      if (area) await area.set(values);
      else for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
      publish(store, { ...store.snapshot, values: { ...store.snapshot.values, ...values }, error: null });
    } catch (error) {
      publish(store, { ...store.snapshot, error: message(error) });
      throw error;
    }
  });
  store.queue = operation;
  return operation;
}
export async function ingestReview(prefix: string, scope: string, posts: MattermostPost[]): Promise<void> {
  await writeReview(prefix, current => {
    const values: Record<string, unknown> = {};
    for (const post of posts) {
      if (!post.id || post.delete_at || current[`${prefix}deleted:${post.id}`]) continue;
      const key = `${prefix}post:${scope}:${post.id}`;
      const previous = current[key] as MattermostPost | undefined;
      if (!previous || (post.update_at ?? post.create_at) >= (previous.update_at ?? previous.create_at)) {
        if (JSON.stringify(previous) !== JSON.stringify(post)) values[key] = post;
      }
    }
    return values;
  });
}
export function selectReview(values: Record<string, unknown>, prefix: string, scope: string): ReviewEntry[] {
  const start = `${prefix}post:${scope}:`;
  return Object.entries(values).flatMap(([key, value]) => {
    if (!key.startsWith(start)) return [];
    const post = value as MattermostPost;
    if (!post || typeof post.id !== "string" || typeof post.message !== "string" || post.delete_at || values[`${prefix}deleted:${post.id}`]) return [];
    const confirmedAt = values[`${prefix}confirmed:${post.id}`];
    return [{ post, confirmedAt: typeof confirmedAt === "number" ? confirmedAt : null }];
  }).sort((a, b) => b.post.create_at - a.post.create_at);
}
export function useMentionReview(server: string, user: string, team?: string) {
  const prefix = reviewPrefix(server, user);
  const scope = reviewScope(team);
  const store = useMemo(() => getStore(prefix), [prefix]);
  const snapshot = useSyncExternalStore(listener => {
    clearTimeout(store.cleanup);
    store.listeners.add(listener);
    return () => {
      store.listeners.delete(listener);
      store.cleanup = setTimeout(() => {
        void store.queue.catch(() => undefined).then(() => {
          if (!store.listeners.size && stores.get(prefix) === store) stores.delete(prefix);
        });
      }, 1000);
    };
  }, () => store.snapshot);
  useEffect(() => {
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      const values = { ...store.snapshot.values };
      let relevant = false;
      for (const [key, change] of Object.entries(changes)) if (key.startsWith(prefix)) { relevant = true; values[key] = change.newValue; }
      if (relevant) publish(store, { ...store.snapshot, values });
    };
    if (typeof chrome !== "undefined") chrome.storage?.onChanged?.addListener(changed);
    return () => { if (typeof chrome !== "undefined") chrome.storage?.onChanged?.removeListener(changed); };
  }, [prefix, store]);
  return {
    ...snapshot,
    entries: useMemo(() => selectReview(snapshot.values, prefix, scope), [snapshot.values, prefix, scope]),
    ingest: (posts: MattermostPost[]) => ingestReview(prefix, scope, posts),
    confirm: (id: string, confirmed: boolean) => writeReview(prefix, { [`${prefix}confirmed:${id}`]: confirmed ? Date.now() : null }),
    remove: (ids: string[]) => writeReview(prefix, Object.fromEntries(ids.map(id => [`${prefix}deleted:${id}`, true]))),
  };
}
