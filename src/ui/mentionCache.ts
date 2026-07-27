import type { MattermostPost } from "../mattermost/api";
import {
  compactMentionReadState,
  type MentionReadState,
} from "./mentionFeed";

const MENTION_CACHE_STORAGE_KEY = "mattermostDeck.mentionFeedCache.v1";
const MENTION_CACHE_VERSION = 1;
const MENTION_CACHE_MAX_ENTRIES = 4;
const MENTION_CACHE_MAX_POSTS = 100;
const MENTION_CACHE_POST_BYTES = 240 * 1024;
export const MENTION_CACHE_SOFT_TTL_MS = 15 * 60_000;
export const MENTION_CACHE_HARD_TTL_MS = 24 * 60 * 60_000;
const MENTION_CACHE_MIN_WRITE_INTERVAL_MS = 60_000;
const MENTION_CACHE_FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface MentionCacheContext {
  serverScope: string;
  userId: string;
  scopeTeamId: string | null;
  teamIds: string[];
  mentionSignature: string;
}

export interface MentionCacheSnapshot extends MentionCacheContext {
  version: 1;
  savedAt: number;
  posts: MattermostPost[];
  readState: MentionReadState;
  fingerprint: string;
}

interface MentionCacheRegistry {
  version: 1;
  entries: Record<string, MentionCacheSnapshot>;
}

let mentionCacheWriteQueue: Promise<void> = Promise.resolve();

function normaliseId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normaliseOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function normaliseViewedAtMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [id, viewedAt] of Object.entries(value)) {
    if (
      id.length > 0 &&
      typeof viewedAt === "number" &&
      Number.isFinite(viewedAt) &&
      viewedAt >= 0
    ) {
      result[id] = viewedAt;
    }
  }
  return result;
}

function normaliseActiveChannelIds(
  value: unknown,
): Record<string, true> | null {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, true> = {};
  for (const [id, active] of Object.entries(value)) {
    if (id.length > 0 && active === true) {
      result[id] = true;
    }
  }
  return result;
}

function normaliseReadState(value: unknown): MentionReadState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<MentionReadState>;
  if (
    candidate.channelLastViewedAt === undefined ||
    candidate.threadLastViewedAt === undefined ||
    candidate.activeChannelIds === undefined
  ) {
    return null;
  }

  return {
    channelLastViewedAt: normaliseViewedAtMap(
      candidate.channelLastViewedAt,
    ),
    threadLastViewedAt: normaliseViewedAtMap(candidate.threadLastViewedAt),
    activeChannelIds: normaliseActiveChannelIds(
      candidate.activeChannelIds,
    ),
  };
}

function compactPost(value: unknown): MattermostPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<MattermostPost>;
  const id = normaliseId(candidate.id);
  const userId = normaliseId(candidate.user_id);
  const channelId = normaliseId(candidate.channel_id);
  if (
    !id ||
    !userId ||
    !channelId ||
    typeof candidate.create_at !== "number" ||
    !Number.isFinite(candidate.create_at) ||
    candidate.create_at < 0 ||
    typeof candidate.message !== "string"
  ) {
    return null;
  }
  if ((candidate.delete_at ?? 0) > 0) {
    return null;
  }

  const post: MattermostPost = {
    id,
    user_id: userId,
    channel_id: channelId,
    create_at: candidate.create_at,
    message: candidate.message,
  };
  const updateAt = normaliseOptionalNumber(candidate.update_at);
  const editAt = normaliseOptionalNumber(candidate.edit_at);
  const rootId = normaliseId(candidate.root_id);
  if (updateAt !== undefined) post.update_at = updateAt;
  if (editAt !== undefined) post.edit_at = editAt;
  if (rootId) post.root_id = rootId;
  if (typeof candidate.type === "string" && candidate.type.length > 0) {
    post.type = candidate.type;
  }
  return post;
}

function compactPosts(values: unknown[]): MattermostPost[] {
  const postsById = new Map<string, MattermostPost>();
  for (const value of values) {
    const post = compactPost(value);
    if (!post) {
      continue;
    }
    const existing = postsById.get(post.id);
    if (
      !existing ||
      (post.update_at ?? post.create_at) >
        (existing.update_at ?? existing.create_at)
    ) {
      postsById.set(post.id, post);
    }
  }

  const encoder = new TextEncoder();
  const compacted: MattermostPost[] = [];
  let usedBytes = 0;
  for (const post of [...postsById.values()]
    .sort((left, right) => right.create_at - left.create_at)
    .slice(0, MENTION_CACHE_MAX_POSTS)) {
    const postBytes = encoder.encode(JSON.stringify(post)).byteLength;
    if (postBytes > MENTION_CACHE_POST_BYTES) {
      continue;
    }
    if (usedBytes + postBytes > MENTION_CACHE_POST_BYTES) {
      break;
    }
    compacted.push(post);
    usedBytes += postBytes;
  }
  return compacted;
}

function normaliseTeamIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((teamId): teamId is string =>
    typeof teamId === "string" && teamId.length > 0
  ))].sort();
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function createFingerprint(value: unknown): string {
  const serialized = JSON.stringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(
    second >>> 0
  ).toString(16).padStart(8, "0")}`;
}

export function buildMentionCacheEntryId(
  context: MentionCacheContext,
): string {
  return JSON.stringify([
    context.serverScope,
    context.userId,
    context.scopeTeamId ?? "all",
  ]);
}

export function createMentionCacheSnapshot(
  context: MentionCacheContext,
  posts: MattermostPost[],
  readState: MentionReadState,
  now = Date.now(),
): MentionCacheSnapshot {
  const activePosts =
    readState.activeChannelIds === null
      ? posts
      : posts.filter(
          (post) => readState.activeChannelIds?.[post.channel_id] === true,
        );
  const compactedPosts = compactPosts(activePosts);
  const compactedReadState = compactMentionReadState(
    readState,
    compactedPosts,
  );
  const teamIds = normaliseTeamIds(context.teamIds);
  const fingerprint = createFingerprint({
    teamIds,
    mentionSignature: context.mentionSignature,
    posts: compactedPosts,
    readState: compactedReadState,
  });

  return {
    version: MENTION_CACHE_VERSION,
    savedAt: now,
    serverScope: context.serverScope,
    userId: context.userId,
    scopeTeamId: context.scopeTeamId,
    teamIds,
    mentionSignature: context.mentionSignature,
    posts: compactedPosts,
    readState: compactedReadState,
    fingerprint,
  };
}

export function normaliseMentionCacheSnapshot(
  value: unknown,
  context: MentionCacheContext,
  now = Date.now(),
): MentionCacheSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<MentionCacheSnapshot>;
  const expectedTeamIds = normaliseTeamIds(context.teamIds);
  const candidateTeamIds = normaliseTeamIds(candidate.teamIds);
  if (
    candidate.version !== MENTION_CACHE_VERSION ||
    candidate.serverScope !== context.serverScope ||
    candidate.userId !== context.userId ||
    candidate.scopeTeamId !== context.scopeTeamId ||
    candidate.mentionSignature !== context.mentionSignature ||
    !sameStringArray(candidateTeamIds, expectedTeamIds) ||
    typeof candidate.savedAt !== "number" ||
    !Number.isFinite(candidate.savedAt) ||
    candidate.savedAt > now + MENTION_CACHE_FUTURE_TOLERANCE_MS ||
    now - candidate.savedAt > MENTION_CACHE_SOFT_TTL_MS ||
    !Array.isArray(candidate.posts)
  ) {
    return null;
  }
  const readState = normaliseReadState(candidate.readState);
  if (!readState) {
    return null;
  }

  const posts = compactPosts(candidate.posts);
  const compactedReadState = compactMentionReadState(readState, posts);
  return {
    version: MENTION_CACHE_VERSION,
    savedAt: candidate.savedAt,
    serverScope: context.serverScope,
    userId: context.userId,
    scopeTeamId: context.scopeTeamId,
    teamIds: expectedTeamIds,
    mentionSignature: context.mentionSignature,
    posts,
    readState: compactedReadState,
    fingerprint: createFingerprint({
      teamIds: expectedTeamIds,
      mentionSignature: context.mentionSignature,
      posts,
      readState: compactedReadState,
    }),
  };
}

function normaliseRegistry(value: unknown, now: number): MentionCacheRegistry {
  const registry = value as Partial<MentionCacheRegistry> | null | undefined;
  const entries =
    registry?.version === MENTION_CACHE_VERSION &&
    registry.entries &&
    typeof registry.entries === "object" &&
    !Array.isArray(registry.entries)
      ? Object.fromEntries(
          Object.entries(registry.entries)
            .filter(([, snapshot]) => {
              const savedAt = (snapshot as Partial<MentionCacheSnapshot>)
                ?.savedAt;
              return (
                typeof savedAt === "number" &&
                Number.isFinite(savedAt) &&
                savedAt <= now + MENTION_CACHE_FUTURE_TOLERANCE_MS &&
                now - savedAt <= MENTION_CACHE_HARD_TTL_MS
              );
            })
            .sort(
              ([, left], [, right]) =>
                (right as MentionCacheSnapshot).savedAt -
                (left as MentionCacheSnapshot).savedAt,
            )
            .slice(0, MENTION_CACHE_MAX_ENTRIES),
        )
      : {};
  return { version: MENTION_CACHE_VERSION, entries };
}

function getSessionStorage(): chrome.storage.StorageArea | null {
  if (
    typeof chrome === "undefined" ||
    !chrome.storage?.session
  ) {
    return null;
  }
  return chrome.storage.session;
}

export async function loadMentionCache(
  context: MentionCacheContext,
  now = Date.now(),
): Promise<MentionCacheSnapshot | null> {
  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }
  try {
    const payload = await storage.get(MENTION_CACHE_STORAGE_KEY);
    const registry = normaliseRegistry(
      payload[MENTION_CACHE_STORAGE_KEY],
      now,
    );
    return normaliseMentionCacheSnapshot(
      registry.entries[buildMentionCacheEntryId(context)],
      context,
      now,
    );
  } catch {
    return null;
  }
}

async function writeMentionCache(
  context: MentionCacheContext,
  snapshot: MentionCacheSnapshot,
  now: number,
): Promise<void> {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  const payload = await storage.get(MENTION_CACHE_STORAGE_KEY);
  const registry = normaliseRegistry(
    payload[MENTION_CACHE_STORAGE_KEY],
    now,
  );
  const entryId = buildMentionCacheEntryId(context);
  const previous = normaliseMentionCacheSnapshot(
    registry.entries[entryId],
    context,
    now,
  );
  if (
    previous?.fingerprint === snapshot.fingerprint &&
    now - previous.savedAt < MENTION_CACHE_MIN_WRITE_INTERVAL_MS
  ) {
    return;
  }

  registry.entries[entryId] = snapshot;
  registry.entries = Object.fromEntries(
    Object.entries(registry.entries)
      .sort(([, left], [, right]) => right.savedAt - left.savedAt)
      .slice(0, MENTION_CACHE_MAX_ENTRIES),
  );
  await storage.set({ [MENTION_CACHE_STORAGE_KEY]: registry });
}

export async function saveMentionCache(
  context: MentionCacheContext,
  posts: MattermostPost[],
  readState: MentionReadState,
  now = Date.now(),
): Promise<void> {
  const snapshot = createMentionCacheSnapshot(
    context,
    posts,
    readState,
    now,
  );
  const write = mentionCacheWriteQueue.then(
    () => writeMentionCache(context, snapshot, now),
    () => writeMentionCache(context, snapshot, now),
  );
  mentionCacheWriteQueue = write.catch(() => undefined);
  await write.catch(() => undefined);
}

async function removeMentionCacheEntry(
  context: MentionCacheContext,
  now: number,
): Promise<void> {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  const payload = await storage.get(MENTION_CACHE_STORAGE_KEY);
  const registry = normaliseRegistry(
    payload[MENTION_CACHE_STORAGE_KEY],
    now,
  );
  const entryId = buildMentionCacheEntryId(context);
  if (!(entryId in registry.entries)) {
    return;
  }
  delete registry.entries[entryId];
  await storage.set({ [MENTION_CACHE_STORAGE_KEY]: registry });
}

export async function removeMentionCache(
  context: MentionCacheContext,
  now = Date.now(),
): Promise<void> {
  const write = mentionCacheWriteQueue.then(
    () => removeMentionCacheEntry(context, now),
    () => removeMentionCacheEntry(context, now),
  );
  mentionCacheWriteQueue = write.catch(() => undefined);
  await write.catch(() => undefined);
}
