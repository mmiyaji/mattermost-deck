import { getWebSocketUrl, type MattermostPost } from "./api";
import { recordWebSocketReconnectAttempt } from "../diagnostics";
import { addTraceEntry } from "../traceLog";
import { hasMattermostMention } from "./mentions";

export interface PostedEvent {
  channelId: string;
  teamId?: string;
  post: MattermostPost;
  mentionsUser: boolean;
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
  onAuthFailure: (message: string) => void;
}

interface MattermostEventEnvelope {
  event?: string;
  data?: Record<string, unknown>;
  broadcast?: {
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

function jitter(ms: number): number {
  const variance = Math.floor(ms * 0.2);
  return ms + Math.floor((Math.random() * (variance * 2 + 1)) - variance);
}

function nextDelay(attempt: number): number {
  const exp = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  const withJitter = jitter(exp);
  return document.hidden ? Math.max(withJitter, BACKGROUND_MIN_MS) : withJitter;
}

function parsePostedEvent(
  payload: MattermostEventEnvelope,
  username: string | null,
  userId: string | null,
): PostedEvent | null {
  if (payload.event !== "posted" || typeof payload.data?.post !== "string") {
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
      channelId,
      teamId: payload.broadcast?.team_id,
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

        if (pendingAuthSeq !== null && payload.seq_reply === pendingAuthSeq) {
          pendingAuthSeq = null;
          if (payload.status === "OK") {
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
        if (posted) {
          options.onPosted(posted);
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
