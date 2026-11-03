import {
  MENTION_CACHE_HARD_TTL_MS,
  MENTION_CACHE_MAX_BYTES,
  MENTION_CACHE_MAX_ENTRIES,
  MENTION_CACHE_MAX_SNAPSHOT_BYTES,
} from "./mentionCacheProtocol";

// Only the background opens this database, so all Mattermost tabs share the
// extension's origin instead of persisting a separate cache on each website.
const DATABASE_NAME = "mattermostDeck.mentionCache";
const SNAPSHOTS = "snapshots";
const METADATA = "metadata";
const STATE = "state";
const MIGRATED = "legacy-migrated";
const LEGACY_KEY = "mattermostDeck.mentionFeedCache.v1";
const INVALIDATION_PREFIX = "invalidated:";
const GLOBAL_INVALIDATION = `${INVALIDATION_PREFIX}global`;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MIN_WRITE_INTERVAL_MS = 60_000;
let opening: Promise<IDBDatabase> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let migrationChecked = false;

export interface MentionCacheStorageRequest {
  operation: "get" | "put" | "remove" | "clear" | "prune";
  key?: string;
  snapshot?: unknown;
  now?: number;
}

type Snapshot = Record<string, unknown> & { savedAt: number; fingerprint: string };
type PreparedSnapshot = { key: string; snapshot: Snapshot; bytes: number };
type Metadata = { key: string; savedAt: number; lastAccessAt: number; bytes: number; fingerprint: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function scopeTuple(key: unknown): string[] {
  if (typeof key !== "string" || key.length > 8192) throw new Error("Invalid mention cache key");
  let tuple: unknown;
  try { tuple = JSON.parse(key); } catch { throw new Error("Invalid mention cache key"); }
  if (!Array.isArray(tuple) || tuple.length !== 3 ||
      !tuple.every(part => typeof part === "string" && part.length > 0) ||
      JSON.stringify(tuple) !== key) throw new Error("Invalid mention cache key");
  return tuple;
}

function accountInvalidationKey(key: string): string {
  return `${INVALIDATION_PREFIX}account:${JSON.stringify(scopeTuple(key).slice(0, 2))}`;
}

function entryInvalidationKey(key: string): string {
  return `${INVALIDATION_PREFIX}entry:${key}`;
}

function prepareSnapshot(key: string, value: unknown, now: number): PreparedSnapshot {
  const [serverScope, userId, scopeTeamId] = scopeTuple(key);
  if (!record(value) || value.version !== 1 || value.serverScope !== serverScope ||
      value.userId !== userId || (value.scopeTeamId ?? "all") !== scopeTeamId ||
      !(value.scopeTeamId === null || typeof value.scopeTeamId === "string") ||
      !timestamp(value.savedAt) || value.savedAt > now + FUTURE_TOLERANCE_MS ||
      now - value.savedAt > MENTION_CACHE_HARD_TTL_MS ||
      !Array.isArray(value.posts) || value.posts.length > 100 ||
      !Array.isArray(value.teamIds) || !value.teamIds.every(id => typeof id === "string" && id.length > 0) ||
      typeof value.mentionSignature !== "string" || typeof value.fingerprint !== "string" ||
      !record(value.readState)) throw new Error("Invalid mention cache snapshot");
  const allowed = new Set(["version", "serverScope", "userId", "scopeTeamId", "savedAt", "posts", "teamIds", "mentionSignature", "fingerprint", "readState", "requestStartedAt"]);
  if (value.requestStartedAt !== undefined && (!timestamp(value.requestStartedAt) || value.requestStartedAt > value.savedAt || now - value.requestStartedAt > MENTION_CACHE_HARD_TTL_MS)) throw new Error("Invalid mention cache request start");
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error("Invalid mention cache snapshot fields");
  const readState = value.readState;
  if (!record(readState.channelLastViewedAt) || !Object.values(readState.channelLastViewedAt).every(timestamp) ||
      !record(readState.threadLastViewedAt) || !Object.values(readState.threadLastViewedAt).every(timestamp) ||
      !(readState.activeChannelIds === null ||
        (record(readState.activeChannelIds) && Object.values(readState.activeChannelIds).every(active => active === true)))) {
    throw new Error("Invalid mention cache read state");
  }
  for (const post of value.posts) {
    if (!record(post) || ![post.id, post.user_id, post.channel_id].every(id => typeof id === "string" && id.length > 0) ||
        !timestamp(post.create_at) || typeof post.message !== "string" ||
        [post.update_at, post.edit_at, post.delete_at].some(time => time !== undefined && !timestamp(time))) {
      throw new Error("Invalid mention cache post");
    }
  }
  const serialized = JSON.stringify(value);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > MENTION_CACHE_MAX_SNAPSHOT_BYTES) throw new Error("Mention cache snapshot exceeds size limit");
  // Persist the same JSON representation whose UTF-8 byte length was measured.
  return { key, snapshot: JSON.parse(serialized) as Snapshot, bytes };
}

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOTS)) database.createObjectStore(SNAPSHOTS);
      if (!database.objectStoreNames.contains(METADATA)) database.createObjectStore(METADATA, { keyPath: "key" });
      if (!database.objectStoreNames.contains(STATE)) database.createObjectStore(STATE);
    };
    request.onerror = () => { failed = true; reject(request.error ?? new Error("Could not open mention cache database")); };
    request.onblocked = () => { failed = true; reject(new Error("Mention cache database upgrade is blocked")); };
    request.onsuccess = () => {
      const database = request.result;
      if (failed) { database.close(); return; }
      const invalidate = () => {
        if (opening === pending) { opening = undefined; migrationChecked = false; }
      };
      database.onversionchange = () => { invalidate(); database.close(); };
      database.onclose = invalidate;
      resolve(database);
    };
  });
  opening = pending;
  void pending.catch(() => { if (opening === pending) opening = undefined; });
  return pending;
}

function legacySnapshots(value: unknown, now: number): PreparedSnapshot[] {
  if (!record(value) || value.version !== 1 || !record(value.entries)) return [];
  const result: PreparedSnapshot[] = [];
  for (const [key, snapshot] of Object.entries(value.entries)) {
    try { result.push(prepareSnapshot(key, snapshot, now)); }
    catch { /* Malformed, expired and oversized old snapshots are disposable. */ }
  }
  return result;
}

function transact(
  database: IDBDatabase,
  message: MentionCacheStorageRequest,
  now: number,
  legacy: PreparedSnapshot[],
  prepared?: PreparedSnapshot,
): Promise<{ snapshot?: unknown }> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SNAPSHOTS, METADATA, STATE], "readwrite", { durability: "relaxed" });
    const snapshots = transaction.objectStore(SNAPSHOTS);
    const metadata = transaction.objectStore(METADATA);
    const state = transaction.objectStore(STATE);
    let result: { snapshot?: unknown } = {};
    let failure: unknown;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = event => { failure ??= (event.target as IDBRequest | null)?.error ?? transaction.error; };
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Mention cache transaction aborted"));
    const guard = (operation: () => void) => {
      try { operation(); }
      catch (error) { failure = error; transaction.abort(); }
    };
    let migrated = false;
    const watermarks = new Map<string, number>();
    const scanState = state.openCursor();
    scanState.onsuccess = () => guard(() => {
      const cursor = scanState.result;
      if (cursor) {
        if (cursor.key === MIGRATED) migrated = cursor.value === true;
        if (typeof cursor.key === "string" && cursor.key.startsWith(INVALIDATION_PREFIX)) {
          if (!timestamp(cursor.value) || now - cursor.value > MENTION_CACHE_HARD_TTL_MS) cursor.delete();
          else watermarks.set(cursor.key, cursor.value);
        }
        cursor.continue();
        return;
      }
      const records = metadata.getAll();
      records.onsuccess = () => guard(() => {
        const entries = new Map((records.result as Metadata[]).map(entry => [entry.key, entry]));
        const dirty = new Set<string>();
        const remove = (key: string) => {
          entries.delete(key); dirty.delete(key); snapshots.delete(key); metadata.delete(key);
        };
        const put = (entry: PreparedSnapshot, lastAccessAt: number) => {
          snapshots.put(entry.snapshot, entry.key);
          entries.set(entry.key, {
            key: entry.key, savedAt: entry.snapshot.savedAt, lastAccessAt,
            bytes: entry.bytes, fingerprint: entry.snapshot.fingerprint,
          });
          dirty.add(entry.key);
        };
        const invalidatedAt = (key: string) => Math.max(
          watermarks.get(GLOBAL_INVALIDATION) ?? -1,
          watermarks.get(accountInvalidationKey(key)) ?? -1,
          watermarks.get(entryInvalidationKey(key)) ?? -1,
        );
        const invalidate = (key: string) => {
          // Never move a watermark backward if nearby callers' clocks differ.
          const at = Math.max(now, watermarks.get(key) ?? 0);
          watermarks.set(key, at);
          state.put(at, key);
        };
        for (const entry of entries.values()) {
          if (now - entry.savedAt > MENTION_CACHE_HARD_TTL_MS || entry.savedAt > now + FUTURE_TOLERANCE_MS) remove(entry.key);
        }
        const clearAll = message.operation === "clear" && message.key === undefined;
        if (!migrated && !clearAll) {
          for (const entry of legacy) {
            if (entry.snapshot.savedAt <= invalidatedAt(entry.key)) continue;
            const existing = entries.get(entry.key);
            if (!existing || existing.savedAt < entry.snapshot.savedAt) put(entry, entry.snapshot.savedAt);
          }
        }
        if (!migrated || message.operation === "clear") state.put(true, MIGRATED);
        const existing = entries.get(message.key!);
        if (message.operation === "clear") {
          if (clearAll) {
            snapshots.clear(); metadata.clear(); entries.clear(); dirty.clear();
            invalidate(GLOBAL_INVALIDATION);
          } else {
            const account = accountInvalidationKey(message.key!);
            for (const key of entries.keys()) if (accountInvalidationKey(key) === account) remove(key);
            invalidate(account);
          }
        }
        if (message.operation === "remove") {
          remove(message.key!);
          invalidate(entryInvalidationKey(message.key!));
        }
        if (message.operation === "put" && prepared && ((prepared.snapshot.requestStartedAt ?? prepared.snapshot.savedAt) as number) > invalidatedAt(prepared.key) &&
            (!existing || prepared.snapshot.savedAt >= existing.savedAt)) {
          if (existing?.fingerprint === prepared.snapshot.fingerprint && now - existing.savedAt < MIN_WRITE_INTERVAL_MS) {
            existing.lastAccessAt = now;
            dirty.add(existing.key);
          } else {
            put(prepared, now);
          }
        }
        if (message.operation === "get" && existing) {
          existing.lastAccessAt = now;
          dirty.add(existing.key);
        }
        let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
        const oldestFirst = [...entries.values()].sort((a, b) => a.lastAccessAt - b.lastAccessAt || a.savedAt - b.savedAt || a.key.localeCompare(b.key));
        for (const entry of oldestFirst) {
          if (entries.size <= MENTION_CACHE_MAX_ENTRIES && bytes <= MENTION_CACHE_MAX_BYTES) break;
          bytes -= entry.bytes;
          remove(entry.key);
        }
        for (const key of dirty) metadata.put(entries.get(key)!);
        if (message.operation === "get" && entries.has(message.key!)) {
          const read = snapshots.get(message.key!);
          read.onsuccess = () => guard(() => {
            if (read.result !== undefined) result = { snapshot: read.result };
            else remove(message.key!);
          });
        }
      });
    });
  });
}

export async function handleMentionCacheStorageRequest(message: MentionCacheStorageRequest): Promise<{ snapshot?: unknown }> {
  if (!message || !["get", "put", "remove", "clear", "prune"].includes(message.operation)) throw new Error("Invalid mention cache operation");
  if ((message.operation !== "clear" && message.operation !== "prune") || message.key !== undefined) scopeTuple(message.key);
  const task = queue.catch(() => undefined).then(async () => {
    const wallNow = Date.now();
    // A content script cannot advance the global cache clock to expire other
    // scopes. Nearby caller times are useful for ordinary clock skew and tests.
    const now = timestamp(message.now) && Math.abs(message.now - wallNow) <= FUTURE_TOLERANCE_MS ? message.now : wallNow;
    const prepared = message.operation === "put" ? prepareSnapshot(message.key!, message.snapshot, now) : undefined;
    const database = await openDatabase();
    const needsMigrationCheck = !migrationChecked;
    const legacy = needsMigrationCheck && (message.operation !== "clear" || message.key !== undefined)
      ? legacySnapshots((await chrome.storage.local.get(LEGACY_KEY))[LEGACY_KEY], now) : [];
    const result = await transact(database, message, now, legacy, prepared);
    if (needsMigrationCheck || message.operation === "clear") {
      // The durable marker, all imported bodies and pruning have committed.
      // If cleanup fails, retry it next time; the marker prevents resurrection.
      migrationChecked = false;
      await chrome.storage.local.remove(LEGACY_KEY);
      migrationChecked = true;
    }
    return result;
  });
  queue = task;
  return task;
}

/** Purge re-fetchable bodies while retaining a cutoff against in-flight saves. */
export async function purgeMentionBodyCache(scope?: { serverScope: string; userId: string }, now = Date.now()): Promise<void> {
  await handleMentionCacheStorageRequest({ operation: "clear", now, ...(scope ? { key: JSON.stringify([scope.serverScope, scope.userId, "all"]) } : {}) });
}

/** Background alarm maintenance; does not clear fresh snapshots. */
export async function pruneMentionBodyCache(): Promise<void> {
  await handleMentionCacheStorageRequest({ operation: "prune" });
}
