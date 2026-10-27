import { useMemo, useSyncExternalStore } from "react";
import type { MattermostPost } from "../mattermost/api";

export interface ReviewEntry { post: MattermostPost; confirmedAt: number | null }
interface Snapshot { values: Record<string, unknown>; ready: boolean; error: string | null }
interface Store { snapshot: Snapshot; listeners: Set<() => void>; loaded: Promise<void>; queue: Promise<void>; pending: Record<string, unknown> | null; unlisten: () => void; cleanup?: ReturnType<typeof setTimeout> }
const stores = new Map<string, Store>();
const CONFIRMED_CAP = 200, TOMBSTONE_CAP = 2000;
export const reviewPrefix = (server: string, user: string) => `mattermostDeck.mentionReview.v1:${encodeURIComponent(server)}:${encodeURIComponent(user)}:`;
export const reviewScope = (team?: string) => encodeURIComponent(team ?? "*");
const storage = () => typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function publish(store: Store, snapshot: Snapshot) { store.snapshot = snapshot; store.listeners.forEach(listener => listener()); }
function getStore(prefix: string): Store {
  const existing = stores.get(prefix);
  if (existing) return existing;
  const store: Store = { snapshot: { values: {}, ready: false, error: null }, listeners: new Set(), loaded: Promise.resolve(), queue: Promise.resolve(), pending: {}, unlisten: () => {} };
  stores.set(prefix, store);
  const accept = (changes: Record<string, unknown>) => {
    const relevant = Object.entries(changes).filter(([key]) => key.startsWith(prefix));
    if (!relevant.length) return;
    const values = { ...store.snapshot.values };
    for (const [key, value] of relevant) { if (store.pending) store.pending[key] = value; if (value == null) delete values[key]; else values[key] = value; }
    publish(store, { ...store.snapshot, values });
  };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local") accept(Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue]))); };
  const localChanged = (event: StorageEvent) => {
    if (event.storageArea !== localStorage || !event.key) return;
    try { accept({ [event.key]: event.newValue === null ? null : JSON.parse(event.newValue) }); } catch { accept({ [event.key]: null }); }
  };
  // Listen before reading so changes arriving during hydration win over its snapshot.
  if (storage()) { chrome.storage.onChanged?.addListener(changed); store.unlisten = () => chrome.storage.onChanged?.removeListener(changed); }
  else if (typeof window !== "undefined") { window.addEventListener("storage", localChanged); store.unlisten = () => window.removeEventListener("storage", localChanged); }
  store.loaded = (async () => {
    try {
      const area = storage();
      const all = area ? await area.get(null) : Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith(prefix)).flatMap(key => {
        try { return [[key, JSON.parse(localStorage.getItem(key)!)]]; } catch { return []; }
      }));
      const values: Record<string, unknown> = { ...Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(prefix))), ...store.pending };
      for (const key of Object.keys(values)) if (values[key] == null) delete values[key];
      publish(store, { values, ready: true, error: null });
    } catch (error) { publish(store, { ...store.snapshot, ready: true, error: message(error) }); }
    finally { store.pending = null; }
  })();
  return store;
}

// Pending entries are never pruned. A confirmed post that falls out of the history cap loses its
// post:/confirmed: keys but gets a deleted: tombstone, otherwise the live feed would re-ingest it.
function pruneReview(prefix: string, values: Record<string, unknown>, writes: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...values };
  for (const [key, value] of Object.entries(writes)) { if (value === undefined) delete merged[key]; else merged[key] = value; }
  const out = { ...writes }, post = `${prefix}post:`, confirmed = `${prefix}confirmed:`, deleted = `${prefix}deleted:`, now = Date.now();
  const postKeys = new Map<string, string[]>();
  for (const key of Object.keys(merged)) if (key.startsWith(post)) { const id = key.slice(key.lastIndexOf(":") + 1); postKeys.set(id, [...postKeys.get(id) ?? [], key]); }
  const drop = (id: string) => { for (const key of postKeys.get(id) ?? []) { out[key] = undefined; delete merged[key]; } };
  // A confirmation is a timestamp. Anything else is a stale record no cap would ever reach.
  for (const [key, value] of Object.entries(merged)) if (key.startsWith(confirmed) && typeof value !== "number") { out[key] = undefined; delete merged[key]; }
  const history = Object.entries(merged).filter(([key, value]) => key.startsWith(confirmed) && typeof value === "number") as [string, number][];
  if (history.length > CONFIRMED_CAP) for (const [key] of history.sort((a, b) => b[1] - a[1]).slice(CONFIRMED_CAP)) {
    const id = key.slice(confirmed.length);
    drop(id); out[key] = undefined; delete merged[key];
    if (!merged[deleted + id]) out[deleted + id] = merged[deleted + id] = now;
  }
  const tombstones = Object.keys(merged).filter(key => key.startsWith(deleted) && merged[key]);
  if (tombstones.length > TOMBSTONE_CAP) {
    const age = (key: string) => typeof merged[key] === "number" ? merged[key] as number : -Infinity;
    // A tombstone's hidden post/confirmation keys go with it, or the post would resurface as pending.
    for (const key of tombstones.sort((a, b) => age(b) - age(a)).slice(TOMBSTONE_CAP)) { const id = key.slice(deleted.length); drop(id); out[key] = out[confirmed + id] = undefined; }
  }
  return out;
}

// Each membership, confirmation and deletion has its own key. Tabs ingesting
// different scopes cannot overwrite each other's confirmation decisions.
// An updater may return `undefined` for a key to remove it from storage.
export async function writeReview(prefix: string, update: Record<string, unknown> | ((values: Record<string, unknown>) => Record<string, unknown>)): Promise<void> {
  const store = getStore(prefix);
  const operation = store.queue.catch(() => undefined).then(async () => {
    await store.loaded;
    try {
      const requested = typeof update === "function" ? update(store.snapshot.values) : update;
      if (!Object.keys(requested).length) return;
      const writes = pruneReview(prefix, store.snapshot.values, requested);
      const sets: Record<string, unknown> = {}, removes: string[] = [];
      for (const [key, value] of Object.entries(writes)) { if (value === undefined) removes.push(key); else sets[key] = value; }
      const area = storage();
      if (area) { if (Object.keys(sets).length) await area.set(sets); if (removes.length) await area.remove(removes); }
      else { for (const [key, value] of Object.entries(sets)) localStorage.setItem(key, JSON.stringify(value)); for (const key of removes) localStorage.removeItem(key); }
      const values = { ...store.snapshot.values, ...sets };
      for (const key of removes) delete values[key];
      publish(store, { ...store.snapshot, values, error: null });
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
        if (!previous || previous.update_at !== post.update_at || previous.edit_at !== post.edit_at || previous.delete_at !== post.delete_at || previous.message !== post.message) values[key] = post;
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
    if (!post || typeof post.id !== "string" || typeof post.message !== "string" || typeof post.create_at !== "number" || !Number.isFinite(post.create_at) || post.delete_at || values[`${prefix}deleted:${post.id}`]) return [];
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
          if (!store.listeners.size && stores.get(prefix) === store) { stores.delete(prefix); store.unlisten(); }
        });
      }, 1000);
    };
  }, () => store.snapshot);
  return {
    ...snapshot,
    entries: useMemo(() => selectReview(snapshot.values, prefix, scope), [snapshot.values, prefix, scope]),
    ingest: (posts: MattermostPost[]) => ingestReview(prefix, scope, posts),
    confirm: (id: string, confirmed: boolean) => writeReview(prefix, { [`${prefix}confirmed:${id}`]: confirmed ? Date.now() : undefined }),
    remove: (ids: string[]) => writeReview(prefix, Object.fromEntries(ids.map(id => [`${prefix}deleted:${id}`, Date.now()]))),
    // Ids stored in this review (any scope) that have no tombstone yet.
    untombstoned: (ids: string[]) => {
      const stored = new Set<string>();
      for (const key of Object.keys(snapshot.values)) if (key.startsWith(`${prefix}post:`)) stored.add(key.slice(key.lastIndexOf(":") + 1));
      return ids.filter(id => stored.has(id) && !snapshot.values[`${prefix}deleted:${id}`]);
    },
  };
}
