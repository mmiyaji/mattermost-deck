import { getWebSocketUrl, type MattermostPost } from "./api";
import { recordWebSocketReconnectAttempt } from "../diagnostics";
import { addTraceEntry } from "../traceLog";
import { hasMattermostMention } from "./mentions";

export interface PostedEvent {
  eventType: "posted" | "post_edited";
  channelId: string;
  channelType?: string;
  teamId?: string;
  post: MattermostPost;
  mentionsUser: boolean;
}

export function appendPostedEvent(
  current: PostedEvent[],
  event: PostedEvent,
  limit = 100,
): PostedEvent[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const withoutDuplicate = current.filter(
    (entry) => entry.post.id !== event.post.id,
  );
  return [...withoutDuplicate, event].slice(-safeLimit);
}

export type WebSocketStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error"
  | "auth_failed";

interface WebSocketLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

interface HookOptions {
  userId: string | null;
  username: string | null;
  enabled: boolean;
  token: string | null;
  onReconnect: () => void;
  onPosted: (event: PostedEvent) => void;
  onPostDeleted?: (postId: string) => void;
  onMentionMetadataChanged?: () => void;
  onUnreadChanged?: () => void;
  onAuthFailure: (message: string) => void;
}

interface MattermostEventEnvelope {
  event?: string;
  data?: Record<string, unknown>;
  broadcast?: {
    user_id?: string;
    channel_id?: string;
    team_id?: string;
  };
  status?: string;
  seq_reply?: number;
}

const RECONNECT_BASE_MS = 1_500;
const RECONNECT_MAX_MS = 30_000;
const BACKGROUND_MIN_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
export function hasMentionForDeck(message: string, username: string | null): boolean {
  return hasMattermostMention(message, username);
}

export function mentionsPayloadIncludesUser(mentions: string, userId: string | null): boolean {
  if (!userId) {
    return false;
  }

  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return false;
  }

  try {
    const parsed = JSON.parse(mentions) as unknown;
    return Array.isArray(parsed) && parsed.some((entry) => entry === normalizedUserId);
  } catch {
    return mentions.split(/[^a-z0-9]+/i).includes(normalizedUserId);
  }
}

export function isUnreadStateEvent(event: string | undefined): boolean {
  return event === "multiple_channels_viewed" ||
    event === "channel_viewed" ||
    event === "thread_read_changed" ||
    event === "post_unread" ||
    event === "channel_deleted" ||
    event === "channel_restored" ||
    event === "user_added" ||
    event === "user_removed";
}

export function getDeletedPostId(
  event: string | undefined,
  postPayload: unknown,
  postIdPayload?: unknown,
): string | null {
  if (event !== "post_deleted") {
    return null;
  }
  if (typeof postIdPayload === "string" && postIdPayload.trim()) {
    return postIdPayload;
  }

  try {
    const post = typeof postPayload === "string"
      ? JSON.parse(postPayload) as { id?: unknown }
      : postPayload as { id?: unknown } | null;
    return typeof post?.id === "string" && post.id.trim()
      ? post.id
      : null;
  } catch {
    return null;
  }
}

function parseEventValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asEventRecord(value: unknown): Record<string, unknown> | null {
  const parsed = parseEventValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

export function isMentionMetadataEvent(
  event: string | undefined,
  data?: Record<string, unknown>,
  currentUserId?: string | null,
  broadcastUserId?: string,
): boolean {
  if (event === "user_updated") {
    if (!currentUserId) {
      return false;
    }
    const user = asEventRecord(data?.user);
    const eventUserId =
      typeof user?.id === "string"
        ? user.id
        : typeof data?.user_id === "string"
          ? data.user_id
          : null;
    return eventUserId
      ? eventUserId === currentUserId
      : broadcastUserId === currentUserId;
  }

  if (
    event === "preference_changed" ||
    event === "preferences_changed" ||
    event === "preferences_deleted"
  ) {
    if (!currentUserId) {
      return false;
    }
    const rawPreferences = parseEventValue(
      data?.preferences ?? data?.preference,
    );
    const preferences = Array.isArray(rawPreferences)
      ? rawPreferences
      : rawPreferences
        ? [rawPreferences]
        : [];
    if (preferences.length === 0) {
      return broadcastUserId === currentUserId;
    }
    return preferences.some((value) => {
      const preference = asEventRecord(value);
      if (!preference) {
        return false;
      }
      const belongsToCurrentUser =
        typeof preference.user_id !== "string" ||
        preference.user_id === currentUserId;
      return belongsToCurrentUser &&
        preference.category === "display_settings" &&
        preference.name === "collapsed_reply_threads";
    });
  }

  return event === "config_changed" ||
    event === "group_member_add" ||
    event === "group_member_added" ||
    event === "group_member_delete" ||
    event === "group_member_deleted" ||
    event === "group_updated" ||
    event === "group_deleted";
}

export function resolvePostedEventTeamId(
  broadcastTeamId: unknown,
  dataTeamId: unknown,
): string | undefined {
  if (typeof broadcastTeamId === "string" && broadcastTeamId.trim()) {
    return broadcastTeamId;
  }
  if (typeof dataTeamId === "string" && dataTeamId.trim()) {
    return dataTeamId;
  }
  return undefined;
}

function jitter(ms: number): number {
  const variance = Math.floor(ms * 0.2);
  return ms + Math.floor((Math.random() * (variance * 2 + 1)) - variance);
}

function nextDelay(attempt: number): number {
  const exp = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  const withJitter = jitter(exp);
  return document.hidden ? Math.max(withJitter, BACKGROUND_MIN_MS) : withJitter;
}

export function parsePostedEvent(
  payload: MattermostEventEnvelope,
  username: string | null,
  userId: string | null,
): PostedEvent | null {
  if (
    (payload.event !== "posted" && payload.event !== "post_edited") ||
    typeof payload.data?.post !== "string"
  ) {
    return null;
  }

  try {
    const post = JSON.parse(payload.data.post) as MattermostPost;
    const channelId = payload.broadcast?.channel_id ?? post.channel_id;
    if (!channelId) {
      return null;
    }

    const mentionsUser =
      (typeof post.message === "string" && hasMentionForDeck(post.message, username)) ||
      (typeof payload.data.mentions === "string" &&
        mentionsPayloadIncludesUser(payload.data.mentions, userId));

    return {
      eventType: payload.event,
      channelId,
      channelType:
        typeof payload.data?.channel_type === "string"
          ? payload.data.channel_type
          : undefined,
      // Mattermost 9.x places the posted event's team_id in data while the
      // broadcast envelope commonly contains an empty team_id.
      teamId: resolvePostedEventTeamId(
        payload.broadcast?.team_id,
        payload.data?.team_id,
      ),
      post,
      mentionsUser,
    };
  } catch {
    return null;
  }
}

export function connectMattermostWebSocket(options: HookOptions): () => void {
  if (!options.enabled || !options.userId || !options.username || !options.token) {
    window.dispatchEvent(
      new CustomEvent("mattermost-deck-ws-status", {
        detail: "idle" satisfies WebSocketStatus,
      }),
    );
    return () => undefined;
  }

  let socket: WebSocket | null = null;
  let disposed = false;
  let reconnectTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let heartbeatTimeout: number | null = null;
  let seq = 1;
  let reconnectAttempt = 0;
  let authenticated = false;
  let hasAuthenticatedOnce = false;
  let pendingAuthSeq: number | null = null;
  let pendingPingSeq: number | null = null;

  const log = (level: WebSocketLogEntry["level"], message: string) => {
    addTraceEntry({
      source: "ws",
      level,
      event: "ws.log",
      payload: { message },
    });
    window.dispatchEvent(
      new CustomEvent("mattermost-deck-ws-log", {
        detail: {
          level,
          message,
          timestamp: Date.now(),
        } satisfies WebSocketLogEntry,
      }),
    );
  };

  const updateStatus = (status: WebSocketStatus) => {
    window.dispatchEvent(
      new CustomEvent("mattermost-deck-ws-status", {
        detail: status,
      }),
    );
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
    if (heartbeatTimeout !== null) window.clearTimeout(heartbeatTimeout);
    heartbeatTimer = null;
    heartbeatTimeout = null;
    pendingPingSeq = null;
  };

  const startHeartbeat = (currentSocket: WebSocket) => {
    clearHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      if (disposed || socket !== currentSocket || currentSocket.readyState !== WebSocket.OPEN) return;
      const pingSeq = seq++;
      pendingPingSeq = pingSeq;
      currentSocket.send(JSON.stringify({ seq: pingSeq, action: "ping" }));
      if (heartbeatTimeout !== null) window.clearTimeout(heartbeatTimeout);
      heartbeatTimeout = window.setTimeout(() => {
        if (socket === currentSocket) currentSocket.close(4000, "Heartbeat timeout");
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== null) {
      return;
    }

    if (!navigator.onLine) {
      updateStatus("offline");
    } else {
      updateStatus("reconnecting");
    }

    const delay = nextDelay(reconnectAttempt);
    reconnectAttempt += 1;
    log("warn", `WS reconnect scheduled in ${delay}ms`);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void open();
    }, delay);
  };

  const open = async () => {
    if (disposed || !navigator.onLine) {
      scheduleReconnect();
      return;
    }

    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      return;
    }

    if (reconnectAttempt > 0) {
      recordWebSocketReconnectAttempt();
    }
    updateStatus(reconnectAttempt === 0 ? "connecting" : "reconnecting");
    log("info", reconnectAttempt === 0 ? "WS connecting" : "WS reconnecting");

    try {
      const currentSocket = new WebSocket(getWebSocketUrl());
      socket = currentSocket;
      authenticated = false;
      pendingAuthSeq = null;

      const markAuthenticated = () => {
        if (authenticated || disposed || socket !== currentSocket) {
          return;
        }
        const wasReconnecting = reconnectAttempt > 0 || hasAuthenticatedOnce;
        authenticated = true;
        hasAuthenticatedOnce = true;
        reconnectAttempt = 0;
        clearReconnectTimer();
        startHeartbeat(currentSocket);
        updateStatus("connected");
        log("info", "WS authenticated");
        if (wasReconnecting) {
          options.onReconnect();
        }
      };

      currentSocket.addEventListener("open", () => {
        if (disposed || socket !== currentSocket) {
          currentSocket.close();
          return;
        }
        log("info", "WS socket open");
        pendingAuthSeq = seq++;
        currentSocket.send(
          JSON.stringify({
            seq: pendingAuthSeq,
            action: "authentication_challenge",
            data: {
              token: options.token,
            },
          }),
        );
        log("info", "WS authentication challenge sent");
      });

      currentSocket.addEventListener("message", (event) => {
        if (disposed || socket !== currentSocket) return;
        let payload: MattermostEventEnvelope;
        try {
          payload = JSON.parse(String(event.data)) as MattermostEventEnvelope;
        } catch (error) {
          log("warn", error instanceof Error ? `WS ignored malformed message: ${error.message}` : "WS ignored malformed message");
          return;
        }

        if (pendingPingSeq !== null && payload.seq_reply === pendingPingSeq) {
          pendingPingSeq = null;
          if (heartbeatTimeout !== null) window.clearTimeout(heartbeatTimeout);
          heartbeatTimeout = null;
          return;
        }

        if (
          payload.event === "hello" &&
          payload.broadcast?.user_id === options.userId
        ) {
          // A Mattermost browser session may authenticate the socket from its
          // cookie before the PAT challenge arrives. In that case the server
          // sends an authenticated hello and intentionally does not answer a
          // second challenge.
          pendingAuthSeq = null;
          markAuthenticated();
          return;
        }

        if (pendingAuthSeq !== null && payload.seq_reply === pendingAuthSeq) {
          pendingAuthSeq = null;
          if (payload.status === "OK") {
            markAuthenticated();
            return;
          }

          clearReconnectTimer();
          disposed = true;
          updateStatus("auth_failed");
          log("error", `WS authentication failed${payload.status ? ` status=${payload.status}` : ""}`);
          currentSocket.close();
          if (socket === currentSocket) socket = null;
          options.onAuthFailure("Realtime authentication failed. Falling back to polling.");
          return;
        }

        const posted = parsePostedEvent(payload, options.username, options.userId);
        const deletedPostId = authenticated
          ? getDeletedPostId(
              payload.event,
              payload.data?.post,
              payload.data?.post_id,
            )
          : null;
        if (posted) {
          options.onPosted(posted);
        } else if (deletedPostId) {
          options.onPostDeleted?.(deletedPostId);
        } else if (authenticated && isMentionMetadataEvent(
          payload.event,
          payload.data,
          options.userId,
          payload.broadcast?.user_id,
        )) {
          options.onMentionMetadataChanged?.();
        } else if (authenticated && isUnreadStateEvent(payload.event)) {
          options.onUnreadChanged?.();
        }
      });

      currentSocket.addEventListener("close", (event) => {
        log("warn", `WS closed code=${event.code}${event.reason ? ` reason=${event.reason}` : ""}`);
        if (socket !== currentSocket) return;
        socket = null;
        authenticated = false;
        clearHeartbeat();
        if (!disposed) {
          scheduleReconnect();
        }
      });

      currentSocket.addEventListener("error", () => {
        if (socket !== currentSocket) return;
        updateStatus("error");
        log("error", "WS error event");
      });
    } catch (error) {
      log("error", error instanceof Error ? `WS setup failed: ${error.message}` : "WS setup failed");
      scheduleReconnect();
    }
  };

  const handleOnline = () => {
    if (disposed) {
      return;
    }

    clearReconnectTimer();
    reconnectAttempt = Math.max(1, reconnectAttempt);
    void open();
  };

  const handleOffline = () => {
    if (disposed) return;
    clearReconnectTimer();
    clearHeartbeat();
    reconnectAttempt = Math.max(1, reconnectAttempt);
    authenticated = false;
    const currentSocket = socket;
    socket = null;
    currentSocket?.close();
    updateStatus("offline");
  };

  const handleVisibility = () => {
    if (!document.hidden && !socket && !disposed) {
      clearReconnectTimer();
      void open();
    }
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  document.addEventListener("visibilitychange", handleVisibility);
  void open();

  return () => {
    disposed = true;
    clearReconnectTimer();
    clearHeartbeat();
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    document.removeEventListener("visibilitychange", handleVisibility);
    socket?.close();
    socket = null;
    updateStatus("idle");
  };
}
