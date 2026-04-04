export interface MattermostUser {
  id: string;
  username: string;
  nickname?: string;
  first_name?: string;
  last_name?: string;
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
}

export interface MattermostChannelMember {
  channel_id: string;
  user_id: string;
}

export interface MattermostPost {
  id: string;
  user_id: string;
  channel_id: string;
  create_at: number;
  message: string;
  root_id?: string;
}

interface MattermostPostList {
  order: string[];
  posts: Record<string, MattermostPost>;
}

export interface TeamUnread {
  team_id: string;
  msg_count: number;
  mention_count: number;
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
const API_REQUEST_MIN_GAP_MS = 120;
const API_METRICS_RETENTION_MS = 60_000;
const API_METRICS_TPS_BUCKET_MS = 3_000;
const API_METRICS_TPS_BUCKETS = 20;
const API_METRICS_LATENCY_POINTS = 20;
const inflightGetRequests = new Map<string, Promise<unknown>>();
const recentGetResponses = new Map<string, { expiresAt: number; value: unknown }>();
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

function trimRequestSamples(now = Date.now()): void {
  while (requestSamples.length > 0 && now - requestSamples[0].timestamp > API_METRICS_RETENTION_MS) {
    requestSamples.shift();
  }
}

function emitApiLog(level: ApiLogLevel, message: string): void {
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

async function performMeasuredFetch(
  method: "GET" | "POST",
  pathname: string,
  request: () => Promise<Response>,
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
    const response = await scheduleApiRequest(async () => {
      queueWaitMs = Date.now() - queueEnteredAt;
      return await request();
    });
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    failed = !response.ok;
    if (failed) {
      totalFailedRequests += 1;
    }
    emitApiLog(
      response.ok ? "info" : response.status >= 500 ? "error" : "warn",
      `${method} ${response.status} ${durationMs}ms ${pathname}`,
    );
    return response;
  } catch (error) {
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    failed = true;
    totalFailedRequests += 1;
    emitApiLog("error", `${method} failed ${durationMs}ms ${pathname}`);
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

async function scheduleApiRequest<T>(task: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const waitTurn = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const previous = requestQueue;
  requestQueue = previous.then(() => waitTurn);
  await previous;

  const delay = Math.max(0, nextRequestAt - Date.now());
  if (delay > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
  }

  try {
    return await task();
  } finally {
    nextRequestAt = Date.now() + API_REQUEST_MIN_GAP_MS;
    release();
  }
}

async function apiGet<T>(pathname: string): Promise<T> {
  const now = Date.now();
  const cached = recentGetResponses.get(pathname);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const inflight = inflightGetRequests.get(pathname);
  if (inflight) {
    return (await inflight) as T;
  }

  const csrfToken = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("MMCSRF="))
    ?.split("=")[1];

  const request = (async () => {
    const response = await performMeasuredFetch("GET", pathname, async () =>
      await fetch(`/api/v4${pathname}`, {
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {}),
        },
      }),
    );

    if (!response.ok) {
      throw new Error(`GET ${pathname} failed with ${response.status}`);
    }

    const payload = (await response.json()) as T;
    recentGetResponses.set(pathname, {
      expiresAt: Date.now() + GET_BURST_GUARD_TTL_MS,
      value: payload,
    });
    return payload;
  })();

  inflightGetRequests.set(pathname, request as Promise<unknown>);

  try {
    return await request;
  } finally {
    inflightGetRequests.delete(pathname);
  }
}

async function apiGetAbsolute(pathname: string): Promise<Response> {
  const csrfToken = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("MMCSRF="))
    ?.split("=")[1];

  return await performMeasuredFetch("GET", pathname, async () =>
    await fetch(pathname, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {}),
      },
    }),
  );
}

async function apiPost<T>(pathname: string, body: unknown): Promise<T> {
  const csrfToken = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("MMCSRF="))
    ?.split("=")[1];

  const response = await performMeasuredFetch("POST", pathname, async () =>
    await fetch(`/api/v4${pathname}`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

  if (!response.ok) {
    throw new Error(`POST ${pathname} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function readCurrentRoute(): CurrentRoute {
  const path = window.location.pathname.split("/").filter(Boolean);
  if (path.length < 3) {
    return {
      teamName: null,
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
  const response = await apiGetAbsolute(pathname);
  return response.ok;
}

export async function getUsersByIds(userIds: string[]): Promise<MattermostUser[]> {
  if (userIds.length === 0) {
    return [];
  }

  return await apiPost<MattermostUser[]>("/users/ids", userIds);
}

export async function getTeamsForCurrentUser(): Promise<MattermostTeam[]> {
  return await apiGet<MattermostTeam[]>("/users/me/teams");
}

export async function getTeamByName(teamName: string): Promise<MattermostTeam> {
  return await apiGet<MattermostTeam>(`/teams/name/${teamName}`);
}

export async function getChannelsForCurrentUser(teamId: string): Promise<MattermostChannel[]> {
  return await apiGet<MattermostChannel[]>(`/users/me/teams/${teamId}/channels`);
}

export async function getDirectChannelsForCurrentUser(): Promise<MattermostChannel[]> {
  return await apiGet<MattermostChannel[]>("/users/me/channels");
}

export async function getChannelMembers(channelId: string): Promise<MattermostChannelMember[]> {
  return await apiGet<MattermostChannelMember[]>(`/channels/${channelId}/members`);
}

export async function getChannel(channelId: string): Promise<MattermostChannel> {
  return await apiGet<MattermostChannel>(`/channels/${channelId}`);
}

export async function getChannelByName(
  teamId: string,
  channelName: string,
): Promise<MattermostChannel> {
  return await apiGet<MattermostChannel>(`/teams/${teamId}/channels/name/${channelName}`);
}

export async function getRecentPosts(channelId: string, page = 0, perPage = 20): Promise<MattermostPost[]> {
  const payload = await apiGet<MattermostPostList>(
    `/channels/${channelId}/posts?page=${page}&per_page=${perPage}`,
  );

  return payload.order
    .map((postId) => payload.posts[postId])
    .filter((post): post is MattermostPost => Boolean(post));
}

export async function getFlaggedPosts(page = 0, perPage = 20): Promise<MattermostPost[]> {
  const payload = await apiGet<MattermostPostList>(`/users/me/posts/flagged?page=${page}&per_page=${perPage}`);

  return payload.order
    .map((postId) => payload.posts[postId])
    .filter((post): post is MattermostPost => Boolean(post));
}

export async function getTeamUnread(userId: string): Promise<TeamUnread[]> {
  return await apiGet<TeamUnread[]>(`/users/${userId}/teams/unread`);
}

export async function searchPostsInTeam(
  teamId: string,
  terms: string,
  page = 0,
  perPage = 20,
): Promise<MattermostPost[]> {
  const payload = await apiPost<MattermostPostList>(
    `/teams/${teamId}/posts/search?page=${page}&per_page=${perPage}`,
    {
      terms,
      is_or_search: false,
      include_deleted_channels: false,
    },
  );

  return payload.order
    .map((postId) => payload.posts[postId])
    .filter((post): post is MattermostPost => Boolean(post));
}

export function getWebSocketUrl(): string {
  const url = new URL("/api/v4/websocket", window.location.origin);
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
