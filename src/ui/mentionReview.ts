import { useMemo, useSyncExternalStore } from "react";
import type { MattermostPost } from "../mattermost/api";

export interface ReviewEntry { post: MattermostPost; confirmedAt: number | null }
interface Snapshot { values: Record<string, unknown>; ready: boolean; error: string | null }
interface Store { snapshot: Snapshot; listeners: Set<() => void>; loaded: Promise<void>; queue: Promise<void>; pending: Record<string, unknown> | null; revisions: Map<string, number>; unlisten: () => void; cleanup?: ReturnType<typeof setTimeout> }
const stores = new Map<string, Store>();
const CONFIRMED_BODY_CAP = 200;
export const reviewPrefix = (server: string, user: string) => `mattermostDeck.mentionReview.v1:${encodeURIComponent(server)}:${encodeURIComponent(user)}:`;
export const reviewScope = (team?: string) => encodeURIComponent(team ?? "*");
const storage = () => typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function publish(store: Store, snapshot: Snapshot) { store.snapshot = snapshot; store.listeners.forEach(listener => listener()); }
function getStore(prefix: string): Store {
  const existing = stores.get(prefix);
  if (existing) return existing;
  const store: Store = { snapshot: { values: {}, ready: false, error: null }, listeners: new Set(), loaded: Promise.resolve(), queue: Promise.resolve(), pending: {}, revisions: new Map(), unlisten: () => {} };
  stores.set(prefix, store);
  const accept = (changes: Record<string, unknown>) => {
    const relevant = Object.entries(changes).filter(([key]) => key.startsWith(prefix));
    if (!relevant.length) return;
    const values = { ...store.snapshot.values };
    for (const [key, value] of relevant) { store.revisions.set(key, (store.revisions.get(key) ?? 0) + 1); if (store.pending) store.pending[key] = value; if (value == null) delete values[key]; else values[key] = value; }
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

// Decisions outlive history bodies. Neither pending posts nor confirmation/deletion
// markers expire: old server results must never become pending again after cleanup.
function retainedConfirmedIds(prefix: string, values: Record<string, unknown>, limit: number): Set<string> {
  const start = `${prefix}confirmed:`;
  return new Set(Object.entries(values)
    .filter(([key, value]) => key.startsWith(start) && typeof value === "number")
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, limit).map(([key]) => key.slice(start.length)));
}
function historyBodyRemovals(prefix: string, values: Record<string, unknown>, limit: number): string[] {
  const retained = retainedConfirmedIds(prefix, values, limit);
  return Object.keys(values).filter(key => {
    if (!key.startsWith(`${prefix}post:`)) return false;
    const id = key.slice(key.lastIndexOf(":") + 1);
    return Boolean(values[`${prefix}deleted:${id}`]) ||
      (typeof values[`${prefix}confirmed:${id}`] === "number" && !retained.has(id));
  });
}
// Storage events can carry a later remote write before an earlier local promise
// resolves. Only apply its result to keys that have received no event since then.
async function persistReview(store: Store, sets: Record<string, unknown>, removes: string[]): Promise<void> {
  const keys = [...Object.keys(sets), ...removes];
  if (!keys.length) return;
  const revisions = new Map(keys.map(key => [key, store.revisions.get(key) ?? 0]));
  const area = storage();
  if (area) {
    if (Object.keys(sets).length) await area.set(sets);
    if (removes.length) await area.remove(removes);
  } else {
    for (const [key, value] of Object.entries(sets)) localStorage.setItem(key, JSON.stringify(value));
    for (const key of removes) localStorage.removeItem(key);
  }
  const values = { ...store.snapshot.values };
  for (const key of keys) {
    if ((store.revisions.get(key) ?? 0) !== revisions.get(key)) continue;
    if (key in sets) values[key] = sets[key]; else delete values[key];
  }
  publish(store, { ...store.snapshot, values });
}
async function cleanHistoryBodies(prefix: string, store: Store, limit: number, reopening = new Set<string>()): Promise<number> {
  const keys = historyBodyRemovals(prefix, store.snapshot.values, limit)
    .filter(key => !reopening.has(key.slice(key.lastIndexOf(":") + 1)));
  await persistReview(store, {}, keys);
  return keys.length;
}

// Each membership, confirmation and deletion has its own key. An updater may
// return `undefined` to explicitly remove a key (for example, to reopen a post).
export async function writeReview(prefix: string, update: Record<string, unknown> | ((values: Record<string, unknown>) => Record<string, unknown>)): Promise<void> {
  const store = getStore(prefix);
  const operation = store.queue.catch(() => undefined).then(async () => {
    await store.loaded;
    try {
      const requested = typeof update === "function" ? update(store.snapshot.values) : update;
      if (!Object.keys(requested).length) return;
      const reopening = new Set(Object.entries(requested)
        .filter(([key, value]) => key.startsWith(`${prefix}confirmed:`) && value === undefined)
        .map(([key]) => key.slice(`${prefix}confirmed:`.length)));
      // Free already confirmed/deleted bodies before allocating new storage.
      // A newly requested confirmation is not eligible until its decision saves.
      await cleanHistoryBodies(prefix, store, CONFIRMED_BODY_CAP, reopening);
      const sets: Record<string, unknown> = {}, removes: string[] = [];
      for (const [key, value] of Object.entries(requested)) { if (value === undefined) removes.push(key); else sets[key] = value; }
      try {
        await persistReview(store, sets, []);
      } catch (error) {
        // Under storage pressure discard even recent confirmed bodies, but keep
        // every decision and every pending post. If none can be freed, surface it.
        if (!/quota|exceed/i.test(message(error)) || !await cleanHistoryBodies(prefix, store, 0, reopening)) throw error;
        await persistReview(store, sets, []);
      }
      await persistReview(store, {}, removes);
      await cleanHistoryBodies(prefix, store, CONFIRMED_BODY_CAP);
      publish(store, { ...store.snapshot, error: null });
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
    const retained = retainedConfirmedIds(prefix, current, CONFIRMED_BODY_CAP);
    for (const post of posts) {
      if (!post.id || post.delete_at || current[`${prefix}deleted:${post.id}`]) continue;
      if (typeof current[`${prefix}confirmed:${post.id}`] === "number" && !retained.has(post.id)) continue;
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
