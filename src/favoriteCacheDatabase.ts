import {
  FAVORITE_CACHE_CHANGED_KEY, FAVORITE_CACHE_MAX_BYTES, FAVORITE_CACHE_MAX_ENTRIES,
  type FavoriteBodyCacheEntry, type FavoriteCacheStorageRequest,
} from "./favoriteCacheProtocol";
import { cacheFavoritePost, favoritePostVersion, favoriteStorageKey, FAVORITES_CACHE_TTL_MS, readFavorites, favoriteMembership, type FavoriteMembership } from "./ui/favorites";
import { withFavoriteMembershipLock } from "./favoriteMembershipStorage";

const DATABASE = "mattermostDeck.favoriteBodies";
const BODIES = "bodies", METADATA = "metadata", TOMBSTONES = "tombstones";
let opening: Promise<IDBDatabase> | undefined;
let queue: Promise<unknown> = Promise.resolve();
type Metadata = Omit<FavoriteBodyCacheEntry, "post" | "deleted"> & {
  key: string; scope: string; bytes: number; postVersion: number; lastAccessAt: number;
};
type Tombstone = { key: string; scope: string; id: string; invalidatedAt: number };
type MaintenanceRequest = { operation: "clear" | "prune"; scope: string };
const PRIVACY_GLOBAL = "privacy:global";
const privacyScope = (scope: string) => `privacy:scope:${scope}`;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_-]{1,128}$/i.test(value);
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function scopeParts(scope: unknown): [string, string] {
  if (typeof scope !== "string" || scope.length > 8192) throw new Error("Invalid favorite cache scope");
  let parts: unknown;
  try { parts = JSON.parse(scope); } catch { throw new Error("Invalid favorite cache scope"); }
  if (!Array.isArray(parts) || parts.length !== 2 || !parts.every(value => typeof value === "string" && value.length > 0) ||
      JSON.stringify(parts) !== scope) throw new Error("Invalid favorite cache scope");
  return parts as [string, string];
}
function validateMembers(value: unknown): FavoriteMembership[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(member => !member || !validId(member.id) ||
      typeof member.revision !== "string" || !member.revision.length || member.revision.length > 128 || !timestamp(member.addedAt))) {
    throw new Error("Invalid favorite cache membership");
  }
  return value;
}
function cacheKey(scope: string, id: string): string { return JSON.stringify([scope, id]); }

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      for (const name of [BODIES, METADATA, TOMBSTONES]) request.result.createObjectStore(name, { keyPath: "key" });
    };
    request.onerror = () => { failed = true; reject(request.error ?? new Error("Favorite cache database unavailable")); };
    request.onblocked = () => { failed = true; reject(new Error("Favorite cache database blocked")); };
    request.onsuccess = () => {
      const database = request.result;
      if (failed) { database.close(); return; }
      const invalidate = () => { if (opening === pending) opening = undefined; };
      database.onversionchange = () => { invalidate(); database.close(); };
      database.onclose = invalidate;
      resolve(database);
    };
  });
  opening = pending;
  void pending.catch(() => { if (opening === pending) opening = undefined; });
  return pending;
}

function transact(database: IDBDatabase, message: FavoriteCacheStorageRequest | MaintenanceRequest, members: FavoriteMembership[], now: number,
  prepared: Array<{ entry: FavoriteBodyCacheEntry; bytes: number }>): Promise<{ entries?: FavoriteBodyCacheEntry[] }> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([BODIES, METADATA, TOMBSTONES], "readwrite");
    const bodies = transaction.objectStore(BODIES), metadata = transaction.objectStore(METADATA), tombstones = transaction.objectStore(TOMBSTONES);
    const result: FavoriteBodyCacheEntry[] = [];
    let failure: unknown;
    transaction.oncomplete = () => resolve(message.operation === "get" ? { entries: result } : {});
    transaction.onerror = event => { failure ??= (event.target as IDBRequest | null)?.error ?? transaction.error; };
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Favorite cache transaction aborted"));
    const guard = (action: () => void) => { try { action(); } catch (error) { failure = error; transaction.abort(); } };
    const records = metadata.getAll();
    records.onsuccess = () => guard(() => {
      const entries = new Map((records.result as Metadata[]).map(entry => [entry.key, entry]));
      const removed = (key: string) => { entries.delete(key); metadata.delete(key); bodies.delete(key); };
      for (const entry of entries.values()) {
        if (now - entry.checkedAt >= FAVORITES_CACHE_TTL_MS || entry.checkedAt > now + 60_000) removed(entry.key);
      }
      const deleted = tombstones.getAll();
      deleted.onsuccess = () => guard(() => {
        const markers = new Map((deleted.result as Tombstone[]).map(entry => [entry.key, entry]));
        for (const marker of markers.values()) if (now - marker.invalidatedAt >= FAVORITES_CACHE_TTL_MS) {
          markers.delete(marker.key); tombstones.delete(marker.key);
        }
        const membership = new Map(members.map(member => [member.id, member]));
        if (message.operation === "clear") {
          for (const entry of entries.values()) if (!message.scope || entry.scope === message.scope) removed(entry.key);
          const key = message.scope ? privacyScope(message.scope) : PRIVACY_GLOBAL;
          const cutoff = { key, scope: message.scope, id: "", invalidatedAt: Math.max(now, markers.get(key)?.invalidatedAt ?? 0) };
          markers.set(key, cutoff); tombstones.put(cutoff);
        }
        const privacyCutoff = Math.max(markers.get(PRIVACY_GLOBAL)?.invalidatedAt ?? -1,
          markers.get(privacyScope(message.scope))?.invalidatedAt ?? -1);
        if (message.operation === "invalidate") for (const id of message.ids!) {
          const key = cacheKey(message.scope, id);
          removed(key);
          tombstones.put({ key, scope: message.scope, id, invalidatedAt: Math.max(now, markers.get(key)?.invalidatedAt ?? 0) } satisfies Tombstone);
        }
        if (message.operation === "remove") for (const id of message.ids!) {
          const key = cacheKey(message.scope, id), entry = entries.get(key);
          if (entry?.revision === membership.get(id)?.revision) removed(key);
        }
        if (message.operation === "put") for (const { entry, bytes } of prepared) {
          const key = cacheKey(message.scope, entry.id), existing = entries.get(key);
          if (membership.get(entry.id)?.revision !== entry.revision || markers.has(key) || entry.requestStartedAt <= privacyCutoff) continue;
          if (existing?.revision === entry.revision &&
              (entry.requestStartedAt < existing.requestStartedAt ||
                (entry.post && favoritePostVersion(entry.post) < existing.postVersion))) continue;
          const record: Metadata = { key, scope: message.scope, id: entry.id, revision: entry.revision,
            checkedAt: entry.checkedAt, requestStartedAt: entry.requestStartedAt, bytes,
            postVersion: favoritePostVersion(entry.post), lastAccessAt: now };
          entries.set(key, record); metadata.put(record); bodies.put({ key, entry });
        }
        let bytes = [...entries.values()].reduce((total, entry) => total + entry.bytes, 0);
        for (const entry of [...entries.values()].sort((a, b) => a.lastAccessAt - b.lastAccessAt || a.checkedAt - b.checkedAt)) {
          if (entries.size <= FAVORITE_CACHE_MAX_ENTRIES && bytes <= FAVORITE_CACHE_MAX_BYTES) break;
          bytes -= entry.bytes; removed(entry.key);
        }
        if (message.operation === "get") for (const member of members) {
          const key = cacheKey(message.scope, member.id), marker = markers.get(key), entry = entries.get(key);
          if (marker) { result.push({ id: member.id, revision: member.revision, checkedAt: marker.invalidatedAt,
            requestStartedAt: marker.invalidatedAt, post: null, deleted: true }); continue; }
          if (entry?.revision !== member.revision) continue;
          entry.lastAccessAt = now; metadata.put(entry);
          const read = bodies.get(key);
          read.onsuccess = () => guard(() => {
            if (read.result?.entry) result.push(read.result.entry as FavoriteBodyCacheEntry);
            else removed(key);
          });
        }
      });
    });
  });
}

/** The service worker owns all bodies; durable membership stays in extension local storage. */
export async function handleFavoriteCacheStorageRequest(message: FavoriteCacheStorageRequest): Promise<{ entries?: FavoriteBodyCacheEntry[] }> {
  if (!message || !["get", "put", "invalidate", "remove"].includes(message.operation)) throw new Error("Invalid favorite cache operation");
  const [server, user] = scopeParts(message.scope);
  const task = queue.catch(() => undefined).then(async () => {
    const wallNow = Date.now();
    const now = timestamp(message.now) && Math.abs(message.now - wallNow) <= 60_000 ? message.now : wallNow;
    let members = message.operation === "get" || message.operation === "remove" ? validateMembers(message.members) : [];
    if (message.operation === "invalidate" || message.operation === "remove") {
      if (!Array.isArray(message.ids) || message.ids.length > 100 || !message.ids.every(validId)) throw new Error("Invalid favorite cache IDs");
    }
    const prepared: Array<{ entry: FavoriteBodyCacheEntry; bytes: number }> = [];
    if (message.operation === "put") {
      if (!Array.isArray(message.entries) || message.entries.length > 100) throw new Error("Invalid favorite cache entries");
      const stored = await chrome.storage.local.get(favoriteStorageKey(server, user));
      members = readFavorites(stored[favoriteStorageKey(server, user)], now);
      for (const value of message.entries) {
        if (!value || !validId(value.id) || typeof value.revision !== "string" || !value.revision.length || value.revision.length > 128 ||
            !timestamp(value.checkedAt) || !timestamp(value.requestStartedAt) || value.checkedAt > now + 60_000 ||
            value.requestStartedAt > now + 60_000 || now - value.checkedAt >= FAVORITES_CACHE_TTL_MS ||
            now - value.requestStartedAt >= FAVORITES_CACHE_TTL_MS) throw new Error("Invalid favorite cache entry");
        const post = value.post === null ? null : cacheFavoritePost(value.post);
        if (value.post !== null && (!post || post.id !== value.id)) throw new Error("Invalid favorite cached post");
        const entry: FavoriteBodyCacheEntry = { id: value.id, revision: value.revision, checkedAt: value.checkedAt,
          requestStartedAt: value.requestStartedAt, post };
        const bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
        if (bytes > 128 * 1024) throw new Error("Favorite cache entry exceeds size limit");
        prepared.push({ entry, bytes });
      }
    }
    const result = await transact(await openDatabase(), message, members, now, prepared);
    if (message.operation !== "get") {
      // A small, body-free notification synchronizes already-open tabs.
      await chrome.storage.session?.set({ [FAVORITE_CACHE_CHANGED_KEY]: { scope: message.scope, revision: crypto.randomUUID() } }).catch(() => undefined);
    }
    return result;
  });
  queue = task;
  return task;
}

/** Explicit body deletion preserves registration and durable deletion markers. */
export async function purgeFavoriteBodyCache(scope?: { serverScope: string; userId: string }, now = Date.now()): Promise<void> {
  const cacheScope = scope ? JSON.stringify([scope.serverScope, scope.userId]) : "";
  const task = queue.catch(() => undefined).then(async () => {
    await transact(await openDatabase(), { operation: "clear", scope: cacheScope }, [], now, []);
    // Old versions embedded bodies in the registration array. Redact those too,
    // otherwise a later migration could restore a body the user just removed.
    const selectedKey = scope ? favoriteStorageKey(scope.serverScope, scope.userId) : null;
    const local = await chrome.storage.local.get(selectedKey);
    for (const [key, value] of Object.entries(local)) {
      if (!key.startsWith("mattermostDeck.favorites.v1:") || !Array.isArray(value) ||
          !value.some(entry => entry && typeof entry === "object" && ("post" in entry || "checkedAt" in entry || "requestStartedAt" in entry))) continue;
      await withFavoriteMembershipLock(key, async () => {
        // Registration changes and cleanup share the extension worker's lock;
        // no page-origin lock or cross-context read/modify/write can race this.
        const latest = (await chrome.storage.local.get(key))[key];
        if (Array.isArray(latest) && latest.some(entry => entry && typeof entry === "object" && ("post" in entry || "checkedAt" in entry || "requestStartedAt" in entry))) {
          await chrome.storage.local.set({ [key]: favoriteMembership(readFavorites(latest, now)) });
        }
      });
    }
    await chrome.storage.session?.set({ [FAVORITE_CACHE_CHANGED_KEY]: { scope: cacheScope || "*", revision: crypto.randomUUID() } });
  });
  queue = task;
  await task;
}

/** Alarm-driven expiry; retains all membership and fresh bodies. */
export async function pruneFavoriteBodyCache(): Promise<void> {
  const task = queue.catch(() => undefined).then(async () => {
    await transact(await openDatabase(), { operation: "prune", scope: "" }, [], Date.now(), []);
  });
  queue = task;
  await task;
}
