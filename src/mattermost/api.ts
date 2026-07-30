import { addTraceEntry } from "../traceLog";
import { MattermostApiError } from "./errors";

export interface MattermostUser {
  id: string;
  username: string;
  nickname?: string;
  first_name?: string;
  last_name?: string;
  // Client-enriched list of group mention handles. Mattermost's user payload
  // does not contain these; loadAppState fills them from /users/:id/groups.
  mention_group_names?: string[];
  collapsed_reply_threads?: boolean;
  notify_props?: {
    mention_keys?: string;
    first_name?: string;
    channel?: string;
    comments?: string;
  };
}

export interface MattermostGroup {
  id: string;
  name?: string | null;
  display_name: string;
  source: "ldap" | "custom" | string;
  delete_at?: number;
  allow_reference?: boolean;
}

export interface MattermostPreference {
  user_id: string;
  category: string;
  name: string;
  value: string;
}

export interface MattermostClientConfig {
  CollapsedThreads?: string;
}

export interface MattermostTeam {
  id: string;
  name: string;
  display_name: string;
}

export interface MattermostChannel {
  id: string;
  name: string;
  display_name: string;
  type: string;
  team_id?: string;
  delete_at?: number;
}

export interface MattermostChannelMember {
  channel_id: string;
  user_id: string;
  last_viewed_at?: number;
  msg_count?: number;
  mention_count?: number;
  mention_count_root?: number;
  urgent_mention_count?: number;
}

export interface MattermostPost {
  id: string;
  user_id: string;
  channel_id: string;
  create_at: number;
  update_at?: number;
  edit_at?: number;
  delete_at?: number;
  message: string;
  root_id?: string;
  type?: string;
  props?: Record<string, unknown>;
  file_ids?: string[];
}

export interface MattermostFileInfo {
  id: string;
  name: string;
  extension: string;
  size: number;
  mime_type: string;
  width?: number;
  height?: number;
  has_preview_image?: boolean;
  mini_preview?: string;
}

interface MattermostPostList {
  order: string[];
  posts: Record<string, MattermostPost>;
  has_next?: boolean;
}

export interface MattermostPostsSinceResult {
  posts: MattermostPost[];
  /**
   * True when the bounded page scan filled its budget before reaching the
   * channel read marker. Callers can then use a mention-only search catch-up
   * without retaining every intervening channel post.
  */
  truncated: boolean;
  /** First unscanned ordinary channel page when truncated, otherwise null. */
  nextPage: number | null;
}

export interface MattermostPostsSincePage {
  page: number;
  /** The page's ordinary ordered posts plus bounded root context. */
  posts: MattermostPost[];
  /** Only posts present in the server's page order, newest first. */
  orderedPosts: MattermostPost[];
}

export interface TeamUnread {
  team_id: string;
  msg_count: number;
  mention_count: number;
  mention_count_root?: number;
  msg_count_root?: number;
  thread_count?: number;
  thread_mention_count?: number;
  thread_urgent_mention_count?: number;
}

export interface MattermostUserThread {
  id: string;
  reply_count: number;
  last_reply_at: number;
  last_viewed_at: number;
  post: MattermostPost;
  unread_replies: number;
  unread_mentions: number;
  delete_at?: number;
}

export interface MattermostUserThreads {
  total: number;
  total_unread_threads: number;
  total_unread_mentions: number;
  total_unread_urgent_mentions?: number;
  threads: MattermostUserThread[];
}

export interface CurrentRoute {
  teamName: string | null;
  channelName: string | null;
}

export interface ApiPerformanceSnapshot {
  totalRequests: number;
  totalGetRequests: number;
  totalPostRequests: number;
  totalFailedRequests: number;
  inFlightRequests: number;
  recentRequestsPerMinute: number;
  recentFailedRequestsPerMinute: number;
  recentErrorRate: number;
  recentTps: number;
  averageQueueWaitMs: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  lastLatencyMs: number;
  latencySeries: number[];
  tpsSeries: number[];
}

type ApiLogLevel = "info" | "warn" | "error";

const GET_BURST_GUARD_TTL_MS = 1_000;
const RECENT_GET_RESPONSE_MAX_ENTRIES = 200;
const API_REQUEST_MIN_GAP_MS = 120;
const API_REQUEST_TIMEOUT_MS = 20_000;
const API_QUEUE_WAIT_TIMEOUT_MS = 30_000;
const API_METRICS_RETENTION_MS = 60_000;
const API_METRICS_TPS_BUCKET_MS = 3_000;
const API_METRICS_TPS_BUCKETS = 20;
const API_METRICS_LATENCY_POINTS = 20;
const API_GLOBAL_RATE_LIMIT_PER_MINUTE = 180;
const API_GLOBAL_RATE_LIMIT_BURST = 24;
const API_GET_RATE_LIMIT_PER_MINUTE = 150;
const API_GET_RATE_LIMIT_BURST = 18;
const API_POST_RATE_LIMIT_PER_MINUTE = 45;
const API_POST_RATE_LIMIT_BURST = 10;
const USER_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1_000;
const USER_LOOKUP_CACHE_MAX_ENTRIES = 2_000;
const CHANNEL_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1_000;
const MENTION_METADATA_CACHE_TTL_MS = 30 * 1_000;
const POST_BY_ID_CACHE_RETENTION_MS = 5 * 60 * 1_000;
const POST_BY_ID_CACHE_MAX_ENTRIES = 2_000;
const POSTS_SINCE_MAX = 1_000;
const POSTS_PAGE_LIMIT = 200;
let configuredMattermostServerUrl = "";
let configuredMattermostBasePath = "";
let apiServerGeneration = 0;
let apiServerConfigurationGeneration = 0;

export function configureMattermostBaseUrl(serverUrl: string): void {
  let nextServerUrl = "";
  let nextBasePath = "";
  try {
    const parsed = new URL(serverUrl);
    const parsedBasePath = parsed.pathname.replace(/\/+$/, "");
    nextServerUrl = `${parsed.origin}${parsedBasePath}`;
    if (parsed.origin === window.location.origin) {
      nextBasePath = parsedBasePath;
    }
  } catch {
    nextServerUrl = "";
    nextBasePath = "";
  }

  if (
    nextServerUrl === configuredMattermostServerUrl &&
    nextBasePath === configuredMattermostBasePath
  ) {
    return;
  }

  configuredMattermostServerUrl = nextServerUrl;
  configuredMattermostBasePath = nextBasePath;
  apiServerGeneration += 1;
  apiServerConfigurationGeneration += 1;
  clearMattermostApiCaches();
}

function getApiPath(pathname: string): string {
  return `${configuredMattermostBasePath}/api/v4${pathname}`;
}

function getConfiguredPath(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (
    !configuredMattermostBasePath ||
    normalized === configuredMattermostBasePath ||
    normalized.startsWith(`${configuredMattermostBasePath}/`)
  ) {
    return normalized;
  }
  return `${configuredMattermostBasePath}${normalized}`;
}

export function getMattermostUrl(pathname: string): string {
  return new URL(getConfiguredPath(pathname), window.location.origin).toString();
}

function describeApiPath(pathname: string, method: "GET" | "POST"): string {
  const normalized = pathname.replace(/\?.*$/, "");

  if (normalized === "/users/me") {
    return "Current user profile";
  }
  if (normalized === "/users/ids" && method === "POST") {
    return "Batch user lookup";
  }
  if (normalized === "/users/me/teams") {
    return "Joined teams";
  }
  if (normalized === "/users/me/channels") {
    return "Direct and group channels";
  }
  if (/^\/teams\/[^/]+\/channels\/name\/[^/]+$/.test(normalized)) {
    return "Resolve channel by team and name";
  }
  if (/^\/teams\/name\/[^/]+$/.test(normalized)) {
    return "Resolve team by name";
  }
  if (/^\/users\/me\/teams\/[^/]+\/channels$/.test(normalized)) {
    return "Team channel list";
  }
  if (/^\/users\/me\/teams\/[^/]+\/channels\/members$/.test(normalized)) {
    return "Current user channel membership list";
  }
  if (/^\/channels\/members\/me\/view$/.test(normalized)) {
    return "Mark channel as viewed";
  }
  if (/^\/channels\/[^/]+\/members\/me$/.test(normalized)) {
    return "Current user channel membership";
  }
  if (/^\/channels\/[^/]+\/members$/.test(normalized)) {
    return "Channel members";
  }
  if (/^\/channels\/[^/]+\/posts$/.test(normalized)) {
    return "Recent channel posts";
  }
  if (/^\/channels\/[^/]+$/.test(normalized)) {
    return "Channel details";
  }
  if (/^\/users\/me\/posts\/flagged$/.test(normalized)) {
    return "Saved or flagged posts";
  }
  if (/^\/users\/[^/]+\/teams\/unread$/.test(normalized)) {
    return "Team unread counts";
  }
  if (/^\/teams\/[^/]+\/posts\/search$/.test(normalized) && method === "POST") {
    return "Team post search";
  }
  if (/^\/posts\/[^/]+\/files\/info$/.test(normalized)) {
    return "Post attachment metadata";
  }
  if (normalized === "/api/v4/users/me") {
    return "Health check";
  }

  return "Other API request";
}

type ApiRateBucket = {
  capacity: number;
  refillPerMs: number;
  tokens: number;
  lastRefillAt: number;
};

const inflightGetRequests = new Map<string, Promise<unknown>>();
const recentGetResponses = new Map<string, { expiresAt: number; value: unknown }>();
const userLookupCache = new Map<string, { expiresAt: number; user: MattermostUser }>();
const inflightUserLookups = new Map<string, Promise<MattermostUser[]>>();
const channelLookupCache = new Map<string, { expiresAt: number; channel: MattermostChannel }>();
const inflightChannelLookups = new Map<string, Promise<MattermostChannel>>();
const mentionGroupLookupCache = new Map<string, { expiresAt: number; groups: MattermostGroup[] }>();
const clientConfigCache = new Map<string, { expiresAt: number; config: MattermostClientConfig }>();
const postByIdCache = new Map<string, { fetchedAt: number; post: MattermostPost | null }>();
const inflightPostByIdLookups = new Map<string, Promise<MattermostPost | null>>();
const postByIdLookupTokens = new Map<string, symbol>();
const activeRequestControllers = new Set<AbortController>();
const globalRateBucket: ApiRateBucket = createRateBucket(API_GLOBAL_RATE_LIMIT_BURST, API_GLOBAL_RATE_LIMIT_PER_MINUTE);
const methodRateBuckets: Record<"GET" | "POST", ApiRateBucket> = {
  GET: createRateBucket(API_GET_RATE_LIMIT_BURST, API_GET_RATE_LIMIT_PER_MINUTE),
  POST: createRateBucket(API_POST_RATE_LIMIT_BURST, API_POST_RATE_LIMIT_PER_MINUTE),
};
let requestQueue = Promise.resolve();
let nextRequestAt = 0;
let totalRequests = 0;
let totalGetRequests = 0;
let totalPostRequests = 0;
let totalFailedRequests = 0;
let inFlightRequests = 0;
const requestSamples: Array<{
  timestamp: number;
  durationMs: number;
  queueWaitMs: number;
  method: "GET" | "POST";
  failed: boolean;
}> = [];

function clearMattermostResponseCaches(includePostLookups = true): void {
  inflightGetRequests.clear();
  recentGetResponses.clear();
  userLookupCache.clear();
  inflightUserLookups.clear();
  channelLookupCache.clear();
  inflightChannelLookups.clear();
  mentionGroupLookupCache.clear();
  clientConfigCache.clear();
  if (includePostLookups) {
    postByIdCache.clear();
    inflightPostByIdLookups.clear();
    postByIdLookupTokens.clear();
  }
}

function clearMattermostApiCaches(): void {
  for (const controller of activeRequestControllers) {
    controller.abort();
  }
  clearMattermostResponseCaches();
  // Keep the scheduler chain intact while aborted requests unwind. Replacing
  // it here would let a request for the new server run concurrently with an
  // older request that has not reached its finally block yet.
}

export function invalidateMentionMetadataCaches(): void {
  // Bump the request generation so in-flight metadata requests cannot
  // repopulate the short-lived GET cache after an invalidation event.
  apiServerGeneration += 1;
  // Preserve the scheduler chain and its request gap. Resetting either while
  // an older request is in flight would allow two supposedly serial chains to
  // run concurrently.
  clearMattermostResponseCaches(false);
}

function getGenerationCacheKey(pathname: string, generation = apiServerGeneration): string {
  return `${generation}:${pathname}`;
}

function trimRequestSamples(now = Date.now()): void {
  while (requestSamples.length > 0 && now - requestSamples[0].timestamp > API_METRICS_RETENTION_MS) {
    requestSamples.shift();
  }
}

function pruneRecentGetResponses(now = Date.now()): void {
  for (const [pathname, entry] of recentGetResponses) {
    if (entry.expiresAt <= now) {
      recentGetResponses.delete(pathname);
    }
  }

  while (recentGetResponses.size > RECENT_GET_RESPONSE_MAX_ENTRIES) {
    const oldestKey = recentGetResponses.keys().next().value as string | undefined;
    if (!oldestKey) {
      return;
    }
    recentGetResponses.delete(oldestKey);
  }
}

function pruneChannelLookupCache(now = Date.now()): void {
  for (const [channelId, entry] of channelLookupCache) {
    if (entry.expiresAt <= now) {
      channelLookupCache.delete(channelId);
    }
  }
}

function pruneUserLookupCache(now = Date.now()): void {
  for (const [userId, entry] of userLookupCache) {
    if (entry.expiresAt <= now) {
      userLookupCache.delete(userId);
    }
  }

  while (userLookupCache.size > USER_LOOKUP_CACHE_MAX_ENTRIES) {
    const oldestUserId = userLookupCache.keys().next().value as
      | string
      | undefined;
    if (!oldestUserId) {
      return;
    }
    userLookupCache.delete(oldestUserId);
  }
}

function emitApiLog(level: ApiLogLevel, message: string): void {
  addTraceEntry({
    source: "api",
    level,
    event: "api.log",
    payload: { message },
  });
  window.dispatchEvent(
    new CustomEvent("mattermost-deck-api-log", {
      detail: {
        level,
        message,
        timestamp: Date.now(),
      },
    }),
  );
}

function createRateBucket(capacity: number, refillPerMinute: number): ApiRateBucket {
  return {
    capacity,
    refillPerMs: refillPerMinute / 60_000,
    tokens: capacity,
    lastRefillAt: Date.now(),
  };
}

function refillRateBucket(bucket: ApiRateBucket, now: number): void {
  const elapsed = Math.max(0, now - bucket.lastRefillAt);
  if (elapsed <= 0) {
    return;
  }

  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs);
  bucket.lastRefillAt = now;
}

class ApiRequestTimeoutError extends Error {
  constructor(stage: "queue" | "network", timeoutMs: number) {
    super(`mattermost_api_timeout:${stage}:${timeoutMs}`);
    this.name = "ApiRequestTimeoutError";
  }
}

class ApiServerChangedError extends Error {
  constructor() {
    super("mattermost_api_server_changed");
    this.name = "ApiServerChangedError";
  }
}

function assertApiServerConfiguration(
  generation: number,
): void {
  if (generation !== apiServerConfigurationGeneration) {
    throw new ApiServerChangedError();
  }
}

function schedulerNow(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

async function waitForDurationWithinDeadline(
  durationMs: number,
  deadline: number,
): Promise<void> {
  const remainingMs = deadline - schedulerNow();
  if (remainingMs <= 0 || durationMs > remainingMs) {
    throw new ApiRequestTimeoutError("queue", API_QUEUE_WAIT_TIMEOUT_MS);
  }
  await new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

async function waitForPromiseWithinDeadline(
  promise: Promise<void>,
  deadline: number,
): Promise<void> {
  const remainingMs = deadline - schedulerNow();
  if (remainingMs <= 0) {
    throw new ApiRequestTimeoutError("queue", API_QUEUE_WAIT_TIMEOUT_MS);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((_, reject) => {
        timer = setTimeout(
          () => reject(new ApiRequestTimeoutError("queue", API_QUEUE_WAIT_TIMEOUT_MS)),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function waitForRateLimit(
  method: "GET" | "POST",
  deadline: number,
  serverConfigurationGeneration: number,
): Promise<number> {
  const buckets = [globalRateBucket, methodRateBuckets[method]];
  let waitedMs = 0;

  while (true) {
    assertApiServerConfiguration(
      serverConfigurationGeneration,
    );
    const now = Date.now();
    buckets.forEach((bucket) => refillRateBucket(bucket, now));
    const blockingBucket = buckets.find((bucket) => bucket.tokens < 1);

    if (!blockingBucket) {
      buckets.forEach((bucket) => {
        bucket.tokens = Math.max(0, bucket.tokens - 1);
      });
      return waitedMs;
    }

    const waitMs = Math.max(50, Math.ceil((1 - blockingBucket.tokens) / blockingBucket.refillPerMs));
    waitedMs += waitMs;
    await waitForDurationWithinDeadline(waitMs, deadline);
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  activeRequestControllers.add(controller);
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      fetch(input, {
        ...init,
        signal: controller.signal,
      }),
      new Promise<Response>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ApiRequestTimeoutError("network", API_REQUEST_TIMEOUT_MS));
        }, API_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    activeRequestControllers.delete(controller);
  }
}

async function performMeasuredFetch(
  method: "GET" | "POST",
  pathname: string,
  request: () => Promise<Response>,
  serverConfigurationGeneration:
    number = apiServerConfigurationGeneration,
): Promise<Response> {
  totalRequests += 1;
  if (method === "GET") {
    totalGetRequests += 1;
  } else {
    totalPostRequests += 1;
  }

  const startedAt = Date.now();
  inFlightRequests += 1;
  let failed = false;
  let queueWaitMs = 0;

  try {
    const queueEnteredAt = Date.now();
    const response = await scheduleApiRequest(
      method,
      async () => {
        queueWaitMs = Date.now() - queueEnteredAt;
        return await request();
      },
      serverConfigurationGeneration,
    );
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    failed = !response.ok;
    if (failed) {
      totalFailedRequests += 1;
    }
    const purpose = describeApiPath(pathname, method);
    addTraceEntry({
      source: "api",
      level: response.ok ? "info" : response.status >= 500 ? "error" : "warn",
      event: "request.complete",
      payload: {
        method,
        path: pathname.replace(/\?.*$/, ""),
        fullPath: pathname,
        purpose,
        status: response.status,
        durationMs,
        queueWaitMs,
        failed,
      },
    });
    emitApiLog(
      response.ok ? "info" : response.status >= 500 ? "error" : "warn",
      `${purpose} | ${method} ${response.status} ${durationMs}ms ${pathname}`,
    );
    return response;
  } catch (error) {
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    failed = true;
    totalFailedRequests += 1;
    const purpose = describeApiPath(pathname, method);
    addTraceEntry({
      source: "api",
      level: "error",
      event: "request.error",
      payload: {
        method,
        path: pathname.replace(/\?.*$/, ""),
        fullPath: pathname,
        purpose,
        durationMs,
        queueWaitMs,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    emitApiLog("error", `${purpose} | ${method} failed ${durationMs}ms ${pathname}`);
    throw error;
  } finally {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
    const finishedAt = Date.now();
    requestSamples.push({
      timestamp: finishedAt,
      durationMs: finishedAt - startedAt,
      queueWaitMs,
      method,
      failed,
    });
    trimRequestSamples(finishedAt);
  }
}

async function scheduleApiRequest<T>(
  method: "GET" | "POST",
  task: () => Promise<T>,
  serverConfigurationGeneration: number,
): Promise<T> {
  const deadline = schedulerNow() + API_QUEUE_WAIT_TIMEOUT_MS;
  let release!: () => void;
  const waitTurn = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const previous = requestQueue;
  requestQueue = previous.then(() => waitTurn);
  let requestSlotUsed = false;

  try {
    await waitForPromiseWithinDeadline(previous, deadline);
    // Drop requests queued for a previous profile before they consume rate
    // tokens or the inter-request gap. This lets the first request for the
    // newly configured server run as soon as the active request unwinds.
    assertApiServerConfiguration(
      serverConfigurationGeneration,
    );

    const rateLimitWaitMs = await waitForRateLimit(
      method,
      deadline,
      serverConfigurationGeneration,
    );
    assertApiServerConfiguration(
      serverConfigurationGeneration,
    );
    if (rateLimitWaitMs > 0) {
      addTraceEntry({
        source: "api",
        level: "warn",
        event: "request.rate_limit_wait",
        payload: {
          method,
          waitMs: Math.round(rateLimitWaitMs),
        },
      });
      emitApiLog("warn", `${method} rate-limit ${Math.round(rateLimitWaitMs)}ms`);
    }

    // nextRequestAt uses wall time so a normal forward clock adjustment does
    // not stall the queue. Clamp a backwards adjustment to one normal gap.
    const delay = Math.min(
      API_REQUEST_MIN_GAP_MS,
      Math.max(0, nextRequestAt - Date.now()),
    );
    if (delay > 0) {
      await waitForDurationWithinDeadline(delay, deadline);
    }
    assertApiServerConfiguration(
      serverConfigurationGeneration,
    );

    requestSlotUsed = true;
    return await task();
  } finally {
    if (requestSlotUsed) {
      nextRequestAt = Date.now() + API_REQUEST_MIN_GAP_MS;
    }
    release();
  }
}

async function apiGet<T>(
  pathname: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<T> {
  const generation = apiServerGeneration;
  const serverConfigurationGeneration =
    apiServerConfigurationGeneration;
  const cacheKey = getGenerationCacheKey(pathname, generation);
  const requestPath = getApiPath(pathname);
  const now = Date.now();
  if (!fresh) {
    const cached = recentGetResponses.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }
    if (cached) {
      recentGetResponses.delete(cacheKey);
    }

    const inflight = inflightGetRequests.get(cacheKey);
    if (inflight) {
      return (await inflight) as T;
    }
  } else {
    recentGetResponses.delete(cacheKey);
  }

  const csrfToken = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("MMCSRF="))
    ?.slice("MMCSRF=".length);

  const request = (async () => {
    const response = await performMeasuredFetch(
      "GET",
      pathname,
      async () => {
        assertApiServerConfiguration(
          serverConfigurationGeneration,
        );
        return await fetchWithTimeout(requestPath, {
          credentials: "include",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
            ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {}),
          },
        });
      },
      serverConfigurationGeneration,
    );

    if (!response.ok) {
      throw new MattermostApiError("GET", pathname, response.status);
    }

    const payload = (await response.json()) as T;
    if (generation === apiServerGeneration) {
      pruneRecentGetResponses();
      recentGetResponses.set(cacheKey, {
        expiresAt: Date.now() + GET_BURST_GUARD_TTL_MS,
        value: payload,
      });
      pruneRecentGetResponses();
    }
    return payload;
  })();

  inflightGetRequests.set(cacheKey, request as Promise<unknown>);

  try {
    return await request;
  } finally {
    if (inflightGetRequests.get(cacheKey) === request) {
      inflightGetRequests.delete(cacheKey);
    }
  }
}

async function apiGetAbsolute(pathname: string): Promise<Response> {
  const serverConfigurationGeneration =
    apiServerConfigurationGeneration;
  const csrfToken = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("MMCSRF="))
    ?.slice("MMCSRF=".length);

  return await performMeasuredFetch(
    "GET",
    pathname,
    async () => {
      assertApiServerConfiguration(
        serverConfigurationGeneration,
      );
      return await fetchWithTimeout(pathname, {
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {}),
        },
      });
    },
    serverConfigurationGeneration,
  );
}

async function apiPost<T>(pathname: string, body: unknown): Promise<T> {
  const serverConfigurationGeneration =
    apiServerConfigurationGeneration;
  const requestPath = getApiPath(pathname);
  const csrfToken = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("MMCSRF="))
    ?.slice("MMCSRF=".length);

  const response = await performMeasuredFetch(
    "POST",
    pathname,
    async () => {
      assertApiServerConfiguration(
        serverConfigurationGeneration,
      );
      return await fetchWithTimeout(requestPath, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {}),
        },
        body: JSON.stringify(body),
      });
    },
    serverConfigurationGeneration,
  );

  if (!response.ok) {
    throw new MattermostApiError("POST", pathname, response.status);
  }

  return (await response.json()) as T;
}

export function readCurrentRoute(): CurrentRoute {
  const relativePath = configuredMattermostBasePath && window.location.pathname.startsWith(`${configuredMattermostBasePath}/`)
    ? window.location.pathname.slice(configuredMattermostBasePath.length)
    : window.location.pathname;
  const path = relativePath.split("/").filter(Boolean);
  if (path.length < 3) {
    return {
      teamName: null,
      channelName: null,
    };
  }

  if (path[1] === "pl") {
    return {
      teamName: path[0] ?? null,
      channelName: null,
    };
  }

  return {
    teamName: path[0] ?? null,
    channelName: path[2] ?? null,
  };
}

export async function getCurrentUser(): Promise<MattermostUser> {
  return await apiGet<MattermostUser>("/users/me");
}

export async function checkApiHealth(pathname: string): Promise<boolean> {
  const response = await apiGetAbsolute(getConfiguredPath(pathname));
  return response.ok;
}

export async function getUsersByIds(userIds: string[]): Promise<MattermostUser[]> {
  const now = Date.now();
  pruneUserLookupCache(now);
  if (userIds.length === 0) {
    return [];
  }

  const generation = apiServerGeneration;
  const orderedUniqueIds = Array.from(new Set(userIds));
  const cachedUsers: MattermostUser[] = [];
  const missingIds: string[] = [];

  for (const userId of orderedUniqueIds) {
    const cached = userLookupCache.get(userId);
    if (cached && cached.expiresAt > now) {
      cachedUsers.push(cached.user);
      continue;
    }
    if (cached) {
      userLookupCache.delete(userId);
    }
    missingIds.push(userId);
  }

  if (missingIds.length === 0) {
    return orderedUniqueIds.map((userId) => cachedUsers.find((user) => user.id === userId)).filter((user): user is MattermostUser => Boolean(user));
  }

  const cacheKey = getGenerationCacheKey(missingIds.join(","), generation);
  let inflight = inflightUserLookups.get(cacheKey);
  if (!inflight) {
    inflight = apiPost<MattermostUser[]>("/users/ids", missingIds);
    inflightUserLookups.set(cacheKey, inflight);
  }

  try {
    const fetchedUsers = await inflight;
    if (generation === apiServerGeneration) {
      const expiresAt = Date.now() + USER_LOOKUP_CACHE_TTL_MS;
      for (const user of fetchedUsers) {
        userLookupCache.set(user.id, { expiresAt, user });
      }
      pruneUserLookupCache();
    }

    const userDirectory = new Map<string, MattermostUser>();
    for (const user of cachedUsers) {
      userDirectory.set(user.id, user);
    }
    for (const user of fetchedUsers) {
      userDirectory.set(user.id, user);
    }

    return orderedUniqueIds
      .map((userId) => userDirectory.get(userId))
      .filter((user): user is MattermostUser => Boolean(user));
  } finally {
    if (inflightUserLookups.get(cacheKey) === inflight) {
      inflightUserLookups.delete(cacheKey);
    }
  }
}

export async function getTeamsForCurrentUser(): Promise<MattermostTeam[]> {
  return await apiGet<MattermostTeam[]>("/users/me/teams");
}

export async function getMentionGroupsForUser(userId: string): Promise<MattermostGroup[]> {
  const generation = apiServerGeneration;
  const cacheKey = getGenerationCacheKey(userId, generation);
  const cached = mentionGroupLookupCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.groups;
  }

  let groups: MattermostGroup[];
  try {
    groups = await apiGet<MattermostGroup[]>(
      `/users/${encodeURIComponent(userId)}/groups`,
    );
  } catch (error) {
    if (
      error instanceof MattermostApiError &&
      (error.status === 403 || error.status === 501)
    ) {
      // Group mentions are license-gated. Free and restricted servers must
      // keep the rest of the mentions feed operational.
      groups = [];
    } else {
      throw error;
    }
  }

  const mentionableGroups = groups.filter(
    (group) =>
      Boolean(group.name?.trim()) &&
      group.allow_reference !== false &&
      (group.delete_at ?? 0) === 0,
  );
  if (generation === apiServerGeneration) {
    mentionGroupLookupCache.set(cacheKey, {
      expiresAt: Date.now() + MENTION_METADATA_CACHE_TTL_MS,
      groups: mentionableGroups,
    });
  }
  return mentionableGroups;
}

export async function getUserPreferences(userId: string): Promise<MattermostPreference[]> {
  return await apiGet<MattermostPreference[]>(
    `/users/${encodeURIComponent(userId)}/preferences`,
  );
}

export async function getMattermostClientConfig(): Promise<MattermostClientConfig> {
  const generation = apiServerGeneration;
  const cacheKey = getGenerationCacheKey("client-config", generation);
  const cached = clientConfigCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  const config = await apiGet<MattermostClientConfig>("/config/client?format=old");
  if (generation === apiServerGeneration) {
    clientConfigCache.set(cacheKey, {
      expiresAt: Date.now() + MENTION_METADATA_CACHE_TTL_MS,
      config,
    });
  }
  return config;
}

export async function getTeamByName(teamName: string): Promise<MattermostTeam> {
  return await apiGet<MattermostTeam>(`/teams/name/${encodeURIComponent(teamName)}`);
}

export async function getChannelsForCurrentUser(teamId: string): Promise<MattermostChannel[]> {
  return await apiGet<MattermostChannel[]>(`/users/me/teams/${encodeURIComponent(teamId)}/channels`);
}

export async function getChannelMembersForCurrentUser(teamId: string): Promise<MattermostChannelMember[]> {
  return await apiGet<MattermostChannelMember[]>(`/users/me/teams/${encodeURIComponent(teamId)}/channels/members`);
}

export async function getDirectChannelsForCurrentUser(): Promise<MattermostChannel[]> {
  return await apiGet<MattermostChannel[]>("/users/me/channels");
}

export async function getChannelMembers(channelId: string): Promise<MattermostChannelMember[]> {
  return await apiGet<MattermostChannelMember[]>(`/channels/${encodeURIComponent(channelId)}/members`);
}

export async function getChannel(channelId: string): Promise<MattermostChannel> {
  return await apiGet<MattermostChannel>(`/channels/${encodeURIComponent(channelId)}`);
}

async function getCachedChannel(channelId: string): Promise<MattermostChannel> {
  const generation = apiServerGeneration;
  const inflightKey = getGenerationCacheKey(channelId, generation);
  const now = Date.now();
  const cached = channelLookupCache.get(channelId);
  if (cached && cached.expiresAt > now) {
    return cached.channel;
  }
  if (cached) {
    channelLookupCache.delete(channelId);
  }

  const inflight = inflightChannelLookups.get(inflightKey);
  if (inflight) {
    return await inflight;
  }

  const request = (async () => {
    const channel = await getChannel(channelId);
    if (generation === apiServerGeneration) {
      channelLookupCache.set(channelId, {
        expiresAt: Date.now() + CHANNEL_LOOKUP_CACHE_TTL_MS,
        channel,
      });
      pruneChannelLookupCache();
    }
    return channel;
  })();

  inflightChannelLookups.set(inflightKey, request);
  try {
    return await request;
  } finally {
    if (inflightChannelLookups.get(inflightKey) === request) {
      inflightChannelLookups.delete(inflightKey);
    }
  }
}

export async function getChannelByName(
  teamId: string,
  channelName: string,
): Promise<MattermostChannel> {
  return await apiGet<MattermostChannel>(
    `/teams/${encodeURIComponent(teamId)}/channels/name/${encodeURIComponent(channelName)}`,
  );
}

export async function getChannelsByIds(channelIds: string[]): Promise<MattermostChannel[]> {
  if (channelIds.length === 0) {
    return [];
  }
  return await Promise.all(channelIds.map((id) => getCachedChannel(id)));
}

export async function getRecentPosts(channelId: string, page = 0, perPage = 20): Promise<MattermostPost[]> {
  const payload = await apiGet<MattermostPostList>(
    `/channels/${encodeURIComponent(channelId)}/posts?page=${page}&per_page=${perPage}`,
  );

  return payload.order
    .map((postId) => payload.posts[postId])
    .filter(
      (post): post is MattermostPost =>
        Boolean(post) && (post.delete_at ?? 0) === 0,
    );
}

export async function getPostsSince(
  channelId: string,
  since: number,
  maxPosts?: number,
): Promise<MattermostPost[]> {
  return (
    await getPostsSinceWithMetadata(
      channelId,
      since,
      maxPosts,
    )
  ).posts;
}

export async function getPostsSinceWithMetadata(
  channelId: string,
  since: number,
  maxPosts?: number,
): Promise<MattermostPostsSinceResult> {
  const safeMaxPosts = Math.min(
    POSTS_SINCE_MAX,
    maxPosts === undefined || !Number.isFinite(maxPosts)
      ? POSTS_SINCE_MAX
      : Math.max(0, Math.floor(maxPosts)),
  );
  if (safeMaxPosts === 0) {
    return {
      posts: [],
      truncated: false,
      nextPage: null,
    };
  }
  const safeSince = Math.max(0, Math.floor(since));
  const encodedChannelId = encodeURIComponent(channelId);
  const primaryPosts: MattermostPost[] = [];
  const contextById = new Map<string, MattermostPost>();

  // Mattermost does not allow page/per_page to be combined with `since`, so
  // the since form cannot make a smaller maxPosts reduce the response body.
  // Read ordinary pages instead: every response is limited to 200 ordered
  // posts. Stop as soon as a page crosses the read marker; only a channel
  // with more than maxPosts newer posts consumes the full scan budget.
  // skipFetchThreads=true still returns each selected reply's root but avoids
  // expanding every sibling reply in a large thread into the same JSON body.
  let scannedPosts = 0;
  let page = 0;
  let reachedSinceBoundary = false;
  let reachedChannelEnd = false;
  const pageSize = Math.min(POSTS_PAGE_LIMIT, safeMaxPosts);
  const maxPages = Math.ceil(safeMaxPosts / pageSize);
  while (scannedPosts < safeMaxPosts && page < maxPages) {
    const payload = await apiGet<MattermostPostList>(
      `/channels/${encodedChannelId}/posts?page=${page}&per_page=${pageSize}&skipFetchThreads=true`,
    );
    for (const post of Object.values(payload.posts)) {
      if (post && (post.delete_at ?? 0) === 0) {
        contextById.set(post.id, post);
      }
    }

    const orderedPosts = payload.order
      .map((postId) => contextById.get(postId))
      .filter((post): post is MattermostPost => Boolean(post))
      .sort((left, right) => right.create_at - left.create_at);
    const boundedOrderedPosts = orderedPosts.slice(
      0,
      safeMaxPosts - scannedPosts,
    );
    scannedPosts += boundedOrderedPosts.length;
    primaryPosts.push(
      ...boundedOrderedPosts.filter(
        (post) =>
          Math.max(
            post.create_at,
            post.update_at ?? 0,
            post.edit_at ?? 0,
          ) > safeSince,
      ),
    );

    reachedSinceBoundary = orderedPosts.some(
      (post) => post.create_at <= safeSince,
    );
    if (orderedPosts.length < pageSize) {
      reachedChannelEnd = true;
      break;
    }
    if (reachedSinceBoundary) {
      break;
    }
    page += 1;
  }

  primaryPosts.sort((left, right) => right.create_at - left.create_at);

  // Context roots are present in `posts` but normally absent from `order`.
  // Count them inside the caller's limit and only accept a reply when its root
  // can fit too, so every returned reply remains evaluable without allowing
  // the result to grow beyond maxPosts.
  const selected = new Map<string, MattermostPost>();
  for (const post of primaryPosts) {
    const root = post.root_id ? contextById.get(post.root_id) : undefined;
    const additions = [post, root]
      .filter((candidate): candidate is MattermostPost => Boolean(candidate))
      .filter((candidate) => !selected.has(candidate.id));
    if (selected.size + additions.length > safeMaxPosts) {
      continue;
    }
    for (const addition of additions) {
      selected.set(addition.id, addition);
    }
    if (selected.size >= safeMaxPosts) {
      break;
    }
  }

  const truncated =
    !reachedSinceBoundary &&
    !reachedChannelEnd &&
    scannedPosts >= safeMaxPosts;
  return {
    posts: Array.from(selected.values()).sort(
      (left, right) => right.create_at - left.create_at,
    ),
    truncated,
    nextPage: truncated ? page : null,
  };
}

export async function scanPostsSincePages(
  channelId: string,
  since: number,
  startPage: number,
  onPage: (
    page: MattermostPostsSincePage,
  ) => Promise<void> | void,
  shouldStop?: () => boolean,
): Promise<void> {
  const safeSince = Math.max(0, Math.floor(since));
  const encodedChannelId = encodeURIComponent(channelId);
  let page = Math.max(0, Math.floor(startPage));

  while (!shouldStop?.()) {
    const payload = await apiGet<MattermostPostList>(
      `/channels/${encodedChannelId}/posts?page=${page}&per_page=${POSTS_PAGE_LIMIT}&skipFetchThreads=true`,
    );
    if (shouldStop?.()) {
      return;
    }

    const contextPosts = Object.values(payload.posts)
      .filter(
        (post): post is MattermostPost =>
          Boolean(post) &&
          (post.delete_at ?? 0) === 0,
      );
    const contextById = new Map(
      contextPosts.map((post) => [post.id, post]),
    );
    const orderedPosts = payload.order
      .map((postId) => contextById.get(postId))
      .filter(
        (post): post is MattermostPost =>
          Boolean(post),
      )
      .sort(
        (left, right) =>
          right.create_at - left.create_at,
      );

    await onPage({
      page,
      posts: contextPosts,
      orderedPosts,
    });
    if (shouldStop?.()) {
      return;
    }

    const reachedSinceBoundary = orderedPosts.some(
      (post) => post.create_at <= safeSince,
    );
    if (
      orderedPosts.length < POSTS_PAGE_LIMIT ||
      reachedSinceBoundary
    ) {
      return;
    }
    page += 1;
  }
}

function prunePostByIdCache(now = Date.now()): void {
  for (const [postId, cached] of postByIdCache) {
    if (now - cached.fetchedAt > POST_BY_ID_CACHE_RETENTION_MS) {
      postByIdCache.delete(postId);
      if (!inflightPostByIdLookups.has(postId)) {
        postByIdLookupTokens.delete(postId);
      }
    }
  }

  if (postByIdCache.size <= POST_BY_ID_CACHE_MAX_ENTRIES) {
    return;
  }
  const expiredCount = postByIdCache.size - POST_BY_ID_CACHE_MAX_ENTRIES;
  const oldestPostIds = Array.from(postByIdCache.entries())
    .sort((left, right) => left[1].fetchedAt - right[1].fetchedAt)
    .slice(0, expiredCount)
    .map(([postId]) => postId);
  for (const postId of oldestPostIds) {
    postByIdCache.delete(postId);
    if (!inflightPostByIdLookups.has(postId)) {
      postByIdLookupTokens.delete(postId);
    }
  }
}

export async function getPostsByIds(
  postIds: string[],
  options: { maxAgeMs?: number } = {},
): Promise<MattermostPost[]> {
  const uniquePostIds = Array.from(new Set(postIds.filter(Boolean)));
  if (uniquePostIds.length === 0) {
    return [];
  }

  const maxAgeMs = Math.max(0, Math.floor(options.maxAgeMs ?? 0));
  const now = Date.now();
  prunePostByIdCache(now);
  const pendingById = new Map<string, Promise<MattermostPost | null>>();
  const missingPostIds: string[] = [];

  for (const postId of uniquePostIds) {
    const cached = postByIdCache.get(postId);
    if (
      maxAgeMs > 0 &&
      cached &&
      now - cached.fetchedAt <= maxAgeMs
    ) {
      pendingById.set(postId, Promise.resolve(cached.post));
      continue;
    }

    const inflight = inflightPostByIdLookups.get(postId);
    if (inflight) {
      pendingById.set(postId, inflight);
      continue;
    }
    missingPostIds.push(postId);
  }

  if (missingPostIds.length > 0) {
    const generation = apiServerGeneration;
    const batch = apiPost<MattermostPost[]>("/posts/ids", missingPostIds)
      .then((posts) => new Map(posts.map((post) => [post.id, post])))
      .catch((error: unknown) => {
        if (error instanceof MattermostApiError && error.status === 404) {
          // Mattermost returns ErrNotFound when every requested post was
          // hard-deleted by retention. In that case the valid subset is empty.
          return new Map<string, MattermostPost>();
        }
        throw error;
      });

    for (const postId of missingPostIds) {
      const lookupToken = Symbol(postId);
      postByIdLookupTokens.set(postId, lookupToken);
      let lookup: Promise<MattermostPost | null>;
      lookup = batch
        .then((postsById) => {
          const post = postsById.get(postId) ?? null;
          if (
            generation === apiServerGeneration &&
            postByIdLookupTokens.get(postId) === lookupToken
          ) {
            postByIdCache.set(postId, { fetchedAt: Date.now(), post });
          }
          return post;
        })
        .finally(() => {
          if (inflightPostByIdLookups.get(postId) === lookup) {
            inflightPostByIdLookups.delete(postId);
            if (!postByIdCache.has(postId)) {
              postByIdLookupTokens.delete(postId);
            }
          }
        });
      inflightPostByIdLookups.set(postId, lookup);
      pendingById.set(postId, lookup);
    }
  }

  const posts = await Promise.all(
    uniquePostIds.map((postId) => pendingById.get(postId) ?? Promise.resolve(null)),
  );
  prunePostByIdCache();
  return posts.filter((post): post is MattermostPost => post !== null);
}

export function invalidatePostByIdCache(postId: string): void {
  postByIdCache.delete(postId);
  inflightPostByIdLookups.delete(postId);
  postByIdLookupTokens.delete(postId);
}

export interface PostThreadSinceResult {
  posts: MattermostPost[];
  truncated: boolean;
}

async function loadPostThreadSince(
  postId: string,
  since: number,
  perPage = 200,
  maxPosts?: number,
): Promise<PostThreadSinceResult> {
  const safeSince = Math.max(0, Math.floor(since));
  const safePerPage = Math.min(200, Math.max(1, Math.floor(perPage)));
  const safeMaxPosts =
    maxPosts === undefined || !Number.isFinite(maxPosts)
      ? null
      : Math.max(0, Math.floor(maxPosts));
  if (safeMaxPosts === 0) {
    return { posts: [], truncated: true };
  }
  const newestFirst = safeMaxPosts !== null;
  const collected = new Map<string, MattermostPost>();
  let truncated = false;
  let fromCreateAt = newestFirst ? Number.MAX_SAFE_INTEGER : safeSince;
  let fromPost = "";

  while (true) {
    const remainingPosts =
      safeMaxPosts === null
        ? safePerPage
        : Math.max(1, safeMaxPosts - collected.size);
    const requestPerPage = Math.min(safePerPage, remainingPosts);
    const cursor = fromPost
      ? `&fromPost=${encodeURIComponent(fromPost)}&fromCreateAt=${fromCreateAt}`
      : `&fromCreateAt=${fromCreateAt}`;
    const payload = await apiGet<MattermostPostList>(
      `/posts/${encodeURIComponent(postId)}/thread?direction=${newestFirst ? "up" : "down"}&perPage=${requestPerPage}${cursor}`,
    );
    const rawPage = payload.order
      .map((threadPostId) => payload.posts[threadPostId])
      .filter((post): post is MattermostPost => Boolean(post))
      .filter((post) => post.id !== postId && post.create_at > safeSince);
    const page = rawPage.filter((post) => (post.delete_at ?? 0) === 0);

    for (const post of page) {
      collected.set(post.id, post);
    }

    const exceededLimit =
      safeMaxPosts !== null && collected.size > safeMaxPosts;
    const reachedLimit =
      safeMaxPosts !== null && collected.size >= safeMaxPosts;
    if (reachedLimit) {
      truncated = exceededLimit || payload.has_next === true;
      break;
    }

    if (!payload.has_next || rawPage.length === 0) {
      break;
    }

    const lastPost = rawPage.reduce((cursorPost, post) => {
      const shouldAdvanceCursor = newestFirst
        ? post.create_at < cursorPost.create_at ||
          (post.create_at === cursorPost.create_at && post.id < cursorPost.id)
        : post.create_at > cursorPost.create_at ||
          (post.create_at === cursorPost.create_at && post.id > cursorPost.id);
      return shouldAdvanceCursor ? post : cursorPost;
    });
    if (lastPost.id === fromPost && lastPost.create_at === fromCreateAt) {
      break;
    }
    fromPost = lastPost.id;
    fromCreateAt = lastPost.create_at;
  }

  const posts = Array.from(collected.values()).sort(
    (left, right) => right.create_at - left.create_at,
  );
  return {
    posts: safeMaxPosts === null ? posts : posts.slice(0, safeMaxPosts),
    truncated,
  };
}

export async function getPostThreadSinceWithMetadata(
  postId: string,
  since: number,
  perPage = 200,
  maxPosts?: number,
): Promise<PostThreadSinceResult> {
  return loadPostThreadSince(postId, since, perPage, maxPosts);
}

export async function getPostThreadSince(
  postId: string,
  since: number,
  perPage = 200,
  maxPosts?: number,
): Promise<MattermostPost[]> {
  const result = await loadPostThreadSince(postId, since, perPage, maxPosts);
  return result.posts;
}

export async function getFlaggedPosts(page = 0, perPage = 20): Promise<MattermostPost[]> {
  const payload = await apiGet<MattermostPostList>(`/users/me/posts/flagged?page=${page}&per_page=${perPage}`);

  return payload.order
    .map((postId) => payload.posts[postId])
    .filter(
      (post): post is MattermostPost =>
        Boolean(post) && (post.delete_at ?? 0) === 0,
    );
}

export async function getTeamUnread(userId: string, includeCollapsedThreads = true): Promise<TeamUnread[]> {
  return await apiGet<TeamUnread[]>(
    `/users/${encodeURIComponent(userId)}/teams/unread?include_collapsed_threads=${includeCollapsedThreads ? "true" : "false"}`,
  );
}

export async function getUserThreads(
  userId: string,
  teamId: string,
  options: { unread?: boolean; perPage?: number; before?: string } = {},
): Promise<MattermostUserThreads> {
  const unread = options.unread ?? false;
  const perPage = Math.min(200, Math.max(1, Math.floor(options.perPage ?? 100)));
  const before = options.before ? `&before=${encodeURIComponent(options.before)}` : "";
  return await apiGet<MattermostUserThreads>(
    `/users/${encodeURIComponent(userId)}/teams/${encodeURIComponent(teamId)}/threads?unread=${unread ? "true" : "false"}&extended=false&deleted=false&per_page=${perPage}${before}`,
  );
}

export async function searchPostsInTeam(
  teamId: string,
  terms: string,
  page = 0,
  perPage = 20,
  options?: { isOrSearch?: boolean },
): Promise<MattermostPost[]> {
  const payload = await apiPost<MattermostPostList>(
    `/teams/${encodeURIComponent(teamId)}/posts/search`,
    {
      terms,
      is_or_search: options?.isOrSearch ?? false,
      include_deleted_channels: false,
      page,
      per_page: perPage,
    },
  );

  return payload.order
    .map((postId) => payload.posts[postId])
    .filter(
      (post): post is MattermostPost =>
        Boolean(post) && (post.delete_at ?? 0) === 0,
    );
}

export async function getMyChannelMember(
  channelId: string,
  options?: { fresh?: boolean },
): Promise<MattermostChannelMember> {
  return await apiGet<MattermostChannelMember>(
    `/channels/${encodeURIComponent(channelId)}/members/me`,
    options,
  );
}

export async function viewChannel(channelId: string): Promise<void> {
  await apiPost<unknown>("/channels/members/me/view", { channel_id: channelId });
  recentGetResponses.delete(getGenerationCacheKey(`/channels/${encodeURIComponent(channelId)}/members/me`));
}

export async function fetchPostFileInfos(postId: string): Promise<MattermostFileInfo[]> {
  const payload = await apiGet<MattermostFileInfo[]>(`/posts/${encodeURIComponent(postId)}/files/info`);
  return Array.isArray(payload) ? payload : [];
}

export function getWebSocketUrl(): string {
  const url = new URL(`${configuredMattermostBasePath}/api/v4/websocket`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function getApiPerformanceSnapshot(): ApiPerformanceSnapshot {
  const now = Date.now();
  trimRequestSamples(now);
  const recent = requestSamples.slice();
  const durations = recent.map((sample) => sample.durationMs);
  const queueWaits = recent.map((sample) => sample.queueWaitMs);
  const recentFailedRequestsPerMinute = recent.filter((sample) => sample.failed).length;
  const sortedDurations = durations.slice().sort((left, right) => left - right);
  const averageQueueWaitMs =
    queueWaits.length > 0 ? queueWaits.reduce((sum, value) => sum + value, 0) / queueWaits.length : 0;
  const averageLatencyMs =
    durations.length > 0 ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : 0;
  const p95Index = sortedDurations.length > 0 ? Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * 0.95)) : -1;
  const lastLatencyMs = durations.length > 0 ? durations[durations.length - 1] : 0;

  const tpsSeries = Array.from({ length: API_METRICS_TPS_BUCKETS }, (_, index) => {
    const bucketEnd = now - (API_METRICS_TPS_BUCKETS - 1 - index) * API_METRICS_TPS_BUCKET_MS;
    const bucketStart = bucketEnd - API_METRICS_TPS_BUCKET_MS;
    const hits = recent.filter((sample) => sample.timestamp > bucketStart && sample.timestamp <= bucketEnd).length;
    return hits / (API_METRICS_TPS_BUCKET_MS / 1_000);
  });

  return {
    totalRequests,
    totalGetRequests,
    totalPostRequests,
    totalFailedRequests,
    inFlightRequests,
    recentRequestsPerMinute: recent.length,
    recentFailedRequestsPerMinute,
    recentErrorRate: recent.length > 0 ? recentFailedRequestsPerMinute / recent.length : 0,
    recentTps: recent.filter((sample) => now - sample.timestamp <= 10_000).length / 10,
    averageQueueWaitMs,
    averageLatencyMs,
    p95LatencyMs: p95Index >= 0 ? sortedDurations[p95Index] : 0,
    lastLatencyMs,
    latencySeries: durations.slice(-API_METRICS_LATENCY_POINTS),
    tpsSeries,
  };
}
