import { getWebSocketUrl, type MattermostPost } from "./api";
import { recordWebSocketReconnectAttempt } from "../diagnostics";

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
  | "error";

interface WebSocketLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

interface HookOptions {
  username: string | null;
  enabled: boolean;
  token: string | null;
  onReconnect: () => void;
  onPosted: (event: PostedEvent) => void;
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
const SPECIAL_MENTION_PATTERN = /(^|[^a-z0-9_])@(all|here|channel)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createUserMentionPattern(username: string | null): RegExp | null {
  if (!username) {
    return null;
  }

  return new RegExp(`(^|[^a-z0-9_])@${escapeRegExp(username)}\\b`, "i");
}

function hasMentionForDeck(message: string, username: string | null): boolean {
  const userMentionPattern = createUserMentionPattern(username);
  return (userMentionPattern?.test(message) ?? false) || SPECIAL_MENTION_PATTERN.test(message);
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
        payload.data.mentions.toLowerCase().includes(username?.toLowerCase() ?? ""));

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
  if (!options.enabled || !options.username || !options.token) {
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
  let seq = 1;
  let reconnectAttempt = 0;
  let authenticated = false;

  const log = (level: WebSocketLogEntry["level"], message: string) => {
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

    if (reconnectAttempt > 0) {
      recordWebSocketReconnectAttempt();
    }
    updateStatus(reconnectAttempt === 0 ? "connecting" : "reconnecting");
    log("info", reconnectAttempt === 0 ? "WS connecting" : "WS reconnecting");

    try {
      socket = new WebSocket(getWebSocketUrl());
      authenticated = false;

      socket.addEventListener("open", () => {
        log("info", "WS socket open");
        socket?.send(
          JSON.stringify({
            seq: seq++,
            action: "authentication_challenge",
            data: {
              token: options.token,
            },
          }),
        );
        log("info", "WS authentication challenge sent");
      });

      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data as string) as MattermostEventEnvelope;

        if (payload.status === "OK" && payload.seq_reply) {
          const wasReconnecting = reconnectAttempt > 0 || authenticated;
          authenticated = true;
          reconnectAttempt = 0;
          clearReconnectTimer();
          updateStatus("connected");
          log("info", "WS authenticated");
          if (wasReconnecting) {
            options.onReconnect();
          }
          return;
        }

        const posted = parsePostedEvent(payload, options.username);
        if (posted) {
          options.onPosted(posted);
        }
      });

      socket.addEventListener("close", (event) => {
        log("warn", `WS closed code=${event.code}${event.reason ? ` reason=${event.reason}` : ""}`);
        socket = null;
        if (!disposed) {
          scheduleReconnect();
        }
      });

      socket.addEventListener("error", () => {
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
    reconnectAttempt = 0;
    void open();
  };

  const handleVisibility = () => {
    if (!document.hidden && !socket && !disposed) {
      clearReconnectTimer();
      void open();
    }
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);
  void open();

  return () => {
    disposed = true;
    clearReconnectTimer();
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
    socket?.close();
    socket = null;
    updateStatus("idle");
  };
}
