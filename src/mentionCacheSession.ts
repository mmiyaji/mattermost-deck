import { MENTION_CACHE_MAX_ENTRIES, MENTION_CACHE_MAX_SNAPSHOT_BYTES } from "./mentionCacheProtocol";

const STORAGE_KEY = "mattermostDeck.mentionFeedCache.v1";
const MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 15 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MIN_WRITE_INTERVAL_MS = 60_000;
let queue: Promise<unknown> = Promise.resolve();

export interface MentionCacheSessionRequest {
  operation: "get" | "put" | "remove" | "clear" | "prune";
  key?: string;
  snapshot?: unknown;
  now?: number;
}

type Snapshot = Record<string, unknown> & { savedAt: number; fingerprint: string };
type Registry = { version: 1; entries: Record<string, Snapshot>; invalidations: Record<string, number> };
const GLOBAL_INVALIDATION = "global";
const entryToken = (key: string) => `entry:${key}`;
const accountToken = (key: string) => `account:${JSON.stringify(scopeTuple(key).slice(0, 2))}`;

function invalidatedAt(registry: Registry, key: string): number {
  return Math.max(registry.invalidations[GLOBAL_INVALIDATION] ?? -1,
    registry.invalidations[entryToken(key)] ?? -1, registry.invalidations[accountToken(key)] ?? -1);
}

function invalidate(registry: Registry, token: string, now: number): void {
  registry.invalidations[token] = Math.max(now, registry.invalidations[token] ?? 0);
}

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
      !tuple.every(part => typeof part === "string" && part.length > 0) || JSON.stringify(tuple) !== key) {
    throw new Error("Invalid mention cache key");
  }
  return tuple;
}

function prepareSnapshot(key: string, value: unknown, now: number): Snapshot {
  const [serverScope, userId, scopeTeamId] = scopeTuple(key);
  if (!record(value) || value.version !== 1 || value.serverScope !== serverScope || value.userId !== userId ||
      (value.scopeTeamId ?? "all") !== scopeTeamId || !(value.scopeTeamId === null || typeof value.scopeTeamId === "string") ||
      !timestamp(value.savedAt) || value.savedAt > now + FUTURE_TOLERANCE_MS || now - value.savedAt > TTL_MS ||
      !Array.isArray(value.posts) || value.posts.length > 100 ||
      !Array.isArray(value.teamIds) || !value.teamIds.every(id => typeof id === "string" && id.length > 0) ||
      typeof value.mentionSignature !== "string" || typeof value.fingerprint !== "string" || !record(value.readState)) {
    throw new Error("Invalid mention cache snapshot");
  }
  if (value.requestStartedAt !== undefined && (!timestamp(value.requestStartedAt) || value.requestStartedAt > value.savedAt || now - value.requestStartedAt > TTL_MS)) throw new Error("Invalid mention cache request start");
  for (const post of value.posts) {
    if (!record(post) || ![post.id, post.user_id, post.channel_id].every(id => typeof id === "string" && id.length > 0) ||
        !timestamp(post.create_at) || typeof post.message !== "string") throw new Error("Invalid mention cache post");
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MENTION_CACHE_MAX_SNAPSHOT_BYTES) {
    throw new Error("Mention cache snapshot exceeds size limit");
  }
  return JSON.parse(serialized) as Snapshot;
}

function normaliseRegistry(value: unknown, now: number): Registry {
  const entries: Record<string, Snapshot> = {};
  if (record(value) && value.version === 1 && record(value.entries)) {
    for (const [key, snapshot] of Object.entries(value.entries)) {
      try { entries[key] = prepareSnapshot(key, snapshot, now); }
      catch { /* Expired or malformed session snapshots are disposable. */ }
    }
  }
  const invalidations: Record<string, number> = {};
  if (record(value) && record(value.invalidations)) {
    for (const [token, at] of Object.entries(value.invalidations)) {
      if (token.length <= 8200 && timestamp(at) && at <= now + FUTURE_TOLERANCE_MS && now - at <= TTL_MS &&
          (token === GLOBAL_INVALIDATION || token.startsWith("entry:") || token.startsWith("account:"))) {
        invalidations[token] = at;
      }
    }
  }
  return { version: 1, entries, invalidations };
}

function boundRegistry(registry: Registry): void {
  // Collapse excessive tombstones conservatively rather than forgetting an active cutoff.
  if (Object.keys(registry.invalidations).length > 256 ||
      new TextEncoder().encode(JSON.stringify(registry.invalidations)).byteLength > 256 * 1024) {
    registry.invalidations = { [GLOBAL_INVALIDATION]: Math.max(...Object.values(registry.invalidations)) };
  }
  for (const [key, snapshot] of Object.entries(registry.entries)) {
    if (((snapshot.requestStartedAt ?? snapshot.savedAt) as number) <= invalidatedAt(registry, key)) delete registry.entries[key];
  }
  let usedBytes = 0;
  const encoder = new TextEncoder();
  registry.entries = Object.fromEntries(Object.entries(registry.entries)
    .sort(([leftKey, left], [rightKey, right]) => right.savedAt - left.savedAt || leftKey.localeCompare(rightKey))
    .filter(([, snapshot]) => {
      const bytes = encoder.encode(JSON.stringify(snapshot)).byteLength;
      if (usedBytes + bytes > MAX_BYTES) return false;
      usedBytes += bytes;
      return true;
    }).slice(0, MENTION_CACHE_MAX_ENTRIES));
}

/** Only the background calls this handler; its queue serializes all tabs' RMWs. */
export async function handleMentionCacheSessionRequest(message: MentionCacheSessionRequest): Promise<{ snapshot?: unknown }> {
  if (!message || !["get", "put", "remove", "clear", "prune"].includes(message.operation)) throw new Error("Invalid mention cache operation");
  const tuple = (message.operation !== "clear" && message.operation !== "prune") || message.key !== undefined ? scopeTuple(message.key) : undefined;
  const task = queue.catch(() => undefined).then(async () => {
    const storage = chrome.storage?.session;
    if (!storage) throw new Error("Mention cache session storage is unavailable");
    const wallNow = Date.now();
    const now = timestamp(message.now) && Math.abs(message.now - wallNow) <= FUTURE_TOLERANCE_MS ? message.now : wallNow;
    const prepared = message.operation === "put" ? prepareSnapshot(message.key!, message.snapshot, now) : undefined;
    const payload = await storage.get(STORAGE_KEY);
    const registry = normaliseRegistry(payload[STORAGE_KEY], now);
    const existing = registry.entries[message.key!];
    if (message.operation === "clear") {
      invalidate(registry, tuple ? accountToken(message.key!) : GLOBAL_INVALIDATION, now);
      for (const key of Object.keys(registry.entries)) {
        const scope = scopeTuple(key);
        if (!tuple || (scope[0] === tuple[0] && scope[1] === tuple[1])) delete registry.entries[key];
      }
    } else if (message.operation === "remove") {
      delete registry.entries[message.key!];
      invalidate(registry, entryToken(message.key!), now);
    } else if (prepared && ((prepared.requestStartedAt ?? prepared.savedAt) as number) > invalidatedAt(registry, message.key!) && (!existing || prepared.savedAt >= existing.savedAt)) {
      if (existing?.fingerprint !== prepared.fingerprint || now - existing.savedAt >= MIN_WRITE_INTERVAL_MS) {
        registry.entries[message.key!] = prepared;
      }
    }
    boundRegistry(registry);
    // Reading an empty session must not create a registry after browser restart.
    if (!(message.operation === "get" && payload[STORAGE_KEY] === undefined) &&
        JSON.stringify(registry) !== JSON.stringify(payload[STORAGE_KEY])) {
      await storage.set({ [STORAGE_KEY]: registry });
    }
    return message.operation === "get" && registry.entries[message.key!] ? { snapshot: registry.entries[message.key!] } : {};
  });
  queue = task;
  return task;
}

/** Purge re-fetchable bodies while retaining a cutoff against in-flight saves. */
export async function purgeMentionBodyCache(scope?: { serverScope: string; userId: string }, now = Date.now()): Promise<void> {
  await handleMentionCacheSessionRequest({ operation: "clear", now, ...(scope ? { key: JSON.stringify([scope.serverScope, scope.userId, "all"]) } : {}) });
}

/** Background alarm maintenance; does not clear fresh snapshots. */
export async function pruneMentionBodyCache(): Promise<void> {
  await handleMentionCacheSessionRequest({ operation: "prune" });
}
