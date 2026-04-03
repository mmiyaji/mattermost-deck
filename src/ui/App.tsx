import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getChannelByName,
  getChannelsForCurrentUser,
  getCurrentUser,
  getRecentPosts,
  getTeamByName,
  getTeamUnread,
  getTeamsForCurrentUser,
  getUsersByIds,
  readCurrentRoute,
  searchPostsInTeam,
  type MattermostChannel,
  type MattermostPost,
  type MattermostTeam,
  type MattermostUser,
  type TeamUnread,
} from "../mattermost/api";
import { connectMattermostWebSocket, type PostedEvent, type WebSocketStatus } from "../mattermost/websocket";
import {
  createColumn,
  createDefaultLayout,
  getColumnTitle,
  STORAGE_KEY,
  type DeckColumn,
  type DeckColumnType,
} from "./layout";
import {
  loadDeckLayout,
  loadStoredJson,
  loadStoredNumber,
  saveDeckLayout,
  saveStoredJson,
  saveStoredNumber,
} from "./storage";
import { loadDeckSettings, resolveTheme, subscribeDeckSettings, type DeckLanguage, type DeckTheme } from "./settings";

interface AppProps {
  routeKey: string;
}

interface AppState {
  status: "loading" | "ready" | "error";
  userId: string | null;
  username: string | null;
  teams: MattermostTeam[];
  unreads: TeamUnread[];
  currentTeamId: string | undefined;
  currentChannelId: string | undefined;
  currentTeamLabel: string | null;
  currentChannelLabel: string | null;
  error: string | null;
  sessionExpired: boolean;
}

interface ChannelState {
  status: "idle" | "loading" | "ready" | "error";
  channels: MattermostChannel[];
  error: string | null;
}

interface PostState {
  status: "idle" | "loading" | "ready" | "error";
  posts: MattermostPost[];
  error: string | null;
}

interface WsLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

const FALLBACK_SYNC_INTERVAL_WS_MS = 300_000;
const FALLBACK_SYNC_INTERVAL_POLLING_MS = 45_000;
const FALLBACK_SYNC_INTERVAL_HIDDEN_MS = 180_000;
const AVAILABLE_COLUMN_TYPES: DeckColumnType[] = ["mentions", "channelWatch"];
const RAIL_WIDTH_STORAGE_KEY = "mattermostDeck.railWidth.v1";
const DRAWER_OPEN_STORAGE_KEY = "mattermostDeck.drawerOpen.v1";
const RECENT_TARGETS_STORAGE_KEY = "mattermostDeck.recentTargets.v1";
const MIN_RAIL_WIDTH = 360;
const MAX_RAIL_WIDTH = 1400;
const DEFAULT_RAIL_WIDTH = 720;
const COLLAPSED_DRAWER_WIDTH = 52;
const MAX_RECENT_TARGETS = 6;

interface RecentChannelTarget {
  teamId: string;
  teamLabel: string;
  channelId: string;
  channelLabel: string;
}

function formatPostTime(timestamp: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function summarisePost(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty message)";
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function getUserLabel(user: MattermostUser | undefined, fallbackId: string): string {
  if (!user) {
    return fallbackId.slice(0, 8);
  }

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (displayName) {
    return displayName;
  }

  return user.nickname?.trim() || `@${user.username}`;
}

function getWebSocketStatusLabel(status: WebSocketStatus): string {
  switch (status) {
    case "connected":
      return "Realtime";
    case "reconnecting":
      return "Reconnecting";
    case "offline":
      return "Offline";
    case "error":
      return "Error";
    case "connecting":
      return "Connecting";
    default:
      return "Idle";
  }
}

function getAppText(language: DeckLanguage) {
  return language === "en"
    ? {
        title: "Mattermost Deck",
        signedInAs: "Signed in as",
        usingSession: "Using current Mattermost session",
        realtimeOff: "Realtime Off",
        settingsHint: "Open extension settings",
        settingsButton: "Open settings",
        connectionLog: "Connection Log",
        recentLabel: "Recent",
        addLabel: "Add",
        addMentions: "Mentions",
        addChannelWatch: "Channel Watch",
        choosePane: "Choose pane",
        loading: "Loading Mattermost data...",
        sessionExpired: "Session expired. Log in again.",
        failedToLoad: "Failed to load data.",
        column: "column",
        columns: "columns",
      }
    : {
        title: "Mattermost Deck",
        signedInAs: "ログイン中",
        usingSession: "現在の Mattermost セッションを使用",
        realtimeOff: "Realtime Off",
        settingsHint: "拡張機能の設定を開く",
        settingsButton: "設定を開く",
        connectionLog: "接続ログ",
        recentLabel: "最近のチャンネル",
        addLabel: "追加",
        addMentions: "Mentions",
        addChannelWatch: "Channel Watch",
        choosePane: "追加するペイン",
        loading: "Mattermost データを読み込み中...",
        sessionExpired: "セッションが切れました。再ログインしてください。",
        failedToLoad: "データ取得に失敗しました。",
        column: "column",
        columns: "columns",
      };
}

type MattermostThemeStyle = React.CSSProperties & {
  ["--deck-bg"]?: string;
  ["--deck-bg-elevated"]?: string;
  ["--deck-bg-soft"]?: string;
  ["--deck-panel"]?: string;
  ["--deck-panel-2"]?: string;
  ["--deck-card"]?: string;
  ["--deck-card-soft"]?: string;
  ["--deck-border"]?: string;
  ["--deck-border-strong"]?: string;
  ["--deck-text"]?: string;
  ["--deck-text-soft"]?: string;
  ["--deck-text-faint"]?: string;
  ["--deck-accent"]?: string;
  ["--deck-accent-strong"]?: string;
  ["--deck-accent-soft"]?: string;
  ["--deck-success"]?: string;
  ["--deck-warn"]?: string;
  ["--deck-danger"]?: string;
};

function queryFirst(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

function rgbaFromRgb(color: string, alpha: number): string {
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) {
    return color;
  }

  const [r, g, b] = match;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lightenRgb(color: string, ratio: number): string {
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) {
    return color;
  }

  const [r, g, b] = match.slice(0, 3).map(Number);
  const mix = (value: number) => Math.round(value + (255 - value) * ratio);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function darkenRgb(color: string, ratio: number): string {
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) {
    return color;
  }

  const [r, g, b] = match.slice(0, 3).map(Number);
  const mix = (value: number) => Math.round(value * (1 - ratio));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function extractMattermostThemeStyle(): MattermostThemeStyle {
  const rootElement = document.documentElement;
  const sidebar = queryFirst(["#SidebarContainer", ".SidebarContainer", ".sidebar-left-container"]);
  const channelHeader = queryFirst([".channel-header", ".channel-header--info", ".center-channel__header"]);
  const postArea = queryFirst([".post-list", ".center-channel", ".app__content"]);
  const button = queryFirst(["button.btn.btn-primary", ".btn.btn-primary", "button[color='primary']"]);
  const link = queryFirst(["a", ".link", ".style--none"]);

  const rootStyle = getComputedStyle(rootElement);
  const sidebarStyle = sidebar ? getComputedStyle(sidebar) : rootStyle;
  const channelHeaderStyle = channelHeader ? getComputedStyle(channelHeader) : rootStyle;
  const postAreaStyle = postArea ? getComputedStyle(postArea) : rootStyle;
  const buttonStyle = button ? getComputedStyle(button) : rootStyle;
  const linkStyle = link ? getComputedStyle(link) : rootStyle;

  const sidebarBg = sidebarStyle.backgroundColor || "rgb(20, 93, 191)";
  const centerBg = postAreaStyle.backgroundColor || "rgb(255, 255, 255)";
  const centerText = postAreaStyle.color || "rgb(61, 60, 64)";
  const headerBg = channelHeaderStyle.backgroundColor || centerBg;
  const accent = buttonStyle.backgroundColor || linkStyle.color || "rgb(22, 109, 224)";

  return {
    "--deck-bg": darkenRgb(sidebarBg, 0.08),
    "--deck-bg-elevated": sidebarBg,
    "--deck-bg-soft": darkenRgb(sidebarBg, 0.18),
    "--deck-panel": headerBg,
    "--deck-panel-2": centerBg,
    "--deck-card": lightenRgb(centerBg, 0.02),
    "--deck-card-soft": centerBg,
    "--deck-border": rgbaFromRgb(centerText, 0.12),
    "--deck-border-strong": rgbaFromRgb(centerText, 0.18),
    "--deck-text": centerText,
    "--deck-text-soft": rgbaFromRgb(centerText, 0.72),
    "--deck-text-faint": rgbaFromRgb(centerText, 0.58),
    "--deck-accent": accent,
    "--deck-accent-strong": darkenRgb(accent, 0.08),
    "--deck-accent-soft": rgbaFromRgb(accent, 0.14),
    "--deck-success": rootStyle.getPropertyValue("--online-indicator") || "rgb(6, 214, 160)",
    "--deck-warn": rootStyle.getPropertyValue("--away-indicator") || "rgb(255, 188, 66)",
    "--deck-danger": rootStyle.getPropertyValue("--error-text-color") || "rgb(247, 67, 67)",
  };
}

function useMattermostThemeStyle(theme: DeckTheme, routeKey: string): MattermostThemeStyle | undefined {
  const [style, setStyle] = useState<MattermostThemeStyle | undefined>(undefined);

  useEffect(() => {
    if (theme !== "mattermost") {
      setStyle(undefined);
      return;
    }

    const apply = () => {
      setStyle(extractMattermostThemeStyle());
    };

    apply();
    const observer = new MutationObserver(() => apply());
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      observer.disconnect();
    };
  }, [routeKey, theme]);

  return style;
}

function getSyncInterval(realtimeEnabled: boolean): number {
  if (document.hidden) {
    return FALLBACK_SYNC_INTERVAL_HIDDEN_MS;
  }

  return realtimeEnabled ? FALLBACK_SYNC_INTERVAL_WS_MS : FALLBACK_SYNC_INTERVAL_POLLING_MS;
}

async function loadAppState(): Promise<Omit<AppState, "status" | "error">> {
  const route = readCurrentRoute();
  const user = await getCurrentUser();

  const [teams, unreads, routeTeam] = await Promise.all([
    getTeamsForCurrentUser(),
    getTeamUnread(user.id),
    route.teamName ? getTeamByName(route.teamName).catch(() => null) : Promise.resolve(null),
  ]);

  const routeChannel =
    routeTeam && route.channelName
      ? await getChannelByName(routeTeam.id, route.channelName).catch(() => null)
      : null;

  return {
    userId: user.id,
    username: user.username,
    teams,
    unreads,
    currentTeamId: routeTeam?.id,
    currentChannelId: routeChannel?.id,
    currentTeamLabel: routeTeam?.display_name ?? routeTeam?.name ?? route.teamName,
    currentChannelLabel: routeChannel?.display_name ?? routeChannel?.name ?? route.channelName,
    sessionExpired: false,
  };
}

function useDeckState(routeKey: string, refreshNonce: number, realtimeEnabled: boolean): AppState {
  const [state, setState] = useState<AppState>({
    status: "loading",
    userId: null,
    username: null,
    teams: [],
    unreads: [],
    currentTeamId: undefined,
    currentChannelId: undefined,
    currentTeamLabel: null,
    currentChannelLabel: null,
    error: null,
    sessionExpired: false,
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const data = await loadAppState();
        if (!cancelled) {
          setState({
            status: "ready",
            error: null,
            ...data,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Failed to load Mattermost data.";
          setState((current) => ({
            ...current,
            status: "error",
            error: message,
            sessionExpired: /401/.test(message),
          }));
        }
      }
    };

    setState((current) => ({
      ...current,
      status: "loading",
      error: null,
    }));

    void run();
    const startTimer = () =>
      window.setInterval(() => {
        void run();
      }, getSyncInterval(realtimeEnabled));

    let timer = startTimer();
    const handleVisibility = () => {
      window.clearInterval(timer);
      timer = startTimer();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [realtimeEnabled, refreshNonce, routeKey]);

  return state;
}

function useWebSocketStatus(): WebSocketStatus {
  const [status, setStatus] = useState<WebSocketStatus>("idle");

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const customEvent = event as CustomEvent<WebSocketStatus>;
      setStatus(customEvent.detail);
    };

    window.addEventListener("mattermost-deck-ws-status", handleStatus as EventListener);
    return () => {
      window.removeEventListener("mattermost-deck-ws-status", handleStatus as EventListener);
    };
  }, []);

  return status;
}

function useWebSocketLogs(): WsLogEntry[] {
  const [logs, setLogs] = useState<WsLogEntry[]>([]);

  useEffect(() => {
    const handleLog = (event: Event) => {
      const entry = (event as CustomEvent<WsLogEntry>).detail;
      setLogs((current) => [entry, ...current].slice(0, 12));
    };

    window.addEventListener("mattermost-deck-ws-log", handleLog as EventListener);
    return () => {
      window.removeEventListener("mattermost-deck-ws-log", handleLog as EventListener);
    };
  }, []);

  return logs;
}

function useDeckLayout(): [
  DeckColumn[] | null,
  (type: DeckColumnType, defaults?: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void,
  (id: string) => void,
  (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void,
  (nextColumns: DeckColumn[]) => void,
] {
  const [columns, setColumns] = useState<DeckColumn[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const layout = await loadDeckLayout(STORAGE_KEY);
      if (!cancelled) {
        setColumns(layout);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = (nextColumns: DeckColumn[]): void => {
    setColumns(nextColumns);
    void saveDeckLayout(STORAGE_KEY, nextColumns);
  };

  const persistFromCurrent = (transform: (current: DeckColumn[]) => DeckColumn[]): void => {
    setColumns((current) => {
      const base = current ?? createDefaultLayout();
      const next = transform(base);
      void saveDeckLayout(STORAGE_KEY, next);
      return next;
    });
  };

  const addColumn = (
    type: DeckColumnType,
    defaults: Partial<Pick<DeckColumn, "teamId" | "channelId">> = {},
  ): void => {
    persistFromCurrent((current) => [...current, createColumn(type, defaults)]);
  };

  const removeColumn = (id: string): void => {
    persistFromCurrent((current) => {
      const nextColumns = current.filter((column) => column.id !== id);
      return nextColumns.length > 0 ? nextColumns : [createColumn("mentions")];
    });
  };

  const updateColumn = (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>): void => {
    persistFromCurrent((current) =>
      current.map((column) =>
        column.id === id
          ? {
              ...column,
              ...patch,
            }
          : column,
      ),
    );
  };

  return [columns, addColumn, removeColumn, updateColumn, persist];
}

function useRecentTargets(): [RecentChannelTarget[], (target: RecentChannelTarget) => void] {
  const [targets, setTargets] = useState<RecentChannelTarget[]>([]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredJson<RecentChannelTarget[]>(RECENT_TARGETS_STORAGE_KEY, []);
      if (!cancelled) {
        setTargets(
          Array.isArray(stored)
            ? stored.filter(
                (entry) =>
                  Boolean(entry) &&
                  typeof entry.teamId === "string" &&
                  typeof entry.teamLabel === "string" &&
                  typeof entry.channelId === "string" &&
                  typeof entry.channelLabel === "string",
              )
            : [],
        );
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const remember = useCallback((target: RecentChannelTarget) => {
    setTargets((current) => {
      const next = [
        target,
        ...current.filter(
          (entry) => !(entry.teamId === target.teamId && entry.channelId === target.channelId),
        ),
      ].slice(0, MAX_RECENT_TARGETS);
      void saveStoredJson(RECENT_TARGETS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  return [targets, remember];
}

function clampRailWidth(nextWidth: number): number {
  const viewportMax = Math.max(MIN_RAIL_WIDTH, window.innerWidth - 320);
  return Math.min(Math.max(nextWidth, MIN_RAIL_WIDTH), Math.min(MAX_RAIL_WIDTH, viewportMax));
}

function useStoredBoolean(storageKey: string, defaultValue: boolean): [boolean, (nextValue: boolean) => void] {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredNumber(storageKey);
      if (!cancelled && stored !== null) {
        setValue(stored !== 0);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    void saveStoredNumber(storageKey, value ? 1 : 0);
  }, [storageKey, value]);

  return [value, setValue];
}

function useDeckSettingsState(): { loaded: boolean; wsPat: string; theme: DeckTheme; language: DeckLanguage } {
  const [settings, setSettings] = useState<{ loaded: boolean; wsPat: string; theme: DeckTheme; language: DeckLanguage }>({
    loaded: false,
    wsPat: "",
    theme: "system",
    language: "ja",
  });

  useEffect(() => {
    let cancelled = false;

    const apply = async () => {
      const next = await loadDeckSettings();
      if (!cancelled) {
        setSettings({
          loaded: true,
          ...next,
        });
      }
    };

    void apply();
    const unsubscribe = subscribeDeckSettings((next) => {
      setSettings({
        loaded: true,
        ...next,
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return settings;
}

function useRailWidth(drawerOpen: boolean): [number, (nextWidth: number) => void] {
  const [railWidth, setRailWidth] = useState<number>(DEFAULT_RAIL_WIDTH);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredNumber(RAIL_WIDTH_STORAGE_KEY);
      if (!cancelled && stored !== null) {
        setRailWidth(clampRailWidth(stored));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--mattermost-deck-rail-width", `${railWidth}px`);
    document.documentElement.style.setProperty(
      "--mattermost-deck-offset-width",
      drawerOpen ? `${railWidth}px` : `${COLLAPSED_DRAWER_WIDTH}px`,
    );
    void saveStoredNumber(RAIL_WIDTH_STORAGE_KEY, railWidth);
  }, [drawerOpen, railWidth]);

  useEffect(() => {
    const handleResize = () => {
      setRailWidth((current) => clampRailWidth(current));
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return [railWidth, (nextWidth: number) => setRailWidth(clampRailWidth(nextWidth))];
}

function TeamSelect({
  teams,
  teamId,
  onChange,
}: {
  teams: MattermostTeam[];
  teamId?: string;
  onChange: (teamId: string) => void;
}): React.JSX.Element {
  return (
    <label className="deck-field">
      <span>Team</span>
      <select className="deck-select" value={teamId ?? ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select team</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.display_name || team.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function PostList({
  posts,
  userDirectory,
}: {
  posts: MattermostPost[];
  userDirectory: Record<string, MattermostUser>;
}): React.JSX.Element {
  return (
    <ul className="deck-list">
      {posts.map((post) => (
        <li key={post.id} className="deck-card deck-card--post">
          <div className="deck-card-header">
            <strong>{formatPostTime(post.create_at)}</strong>
            <span>{getUserLabel(userDirectory[post.user_id], post.user_id)}</span>
          </div>
          <p>{summarisePost(post.message)}</p>
        </li>
      ))}
    </ul>
  );
}

function MentionsColumn({
  column,
  username,
  realtimeEnabled,
  teams,
  unreads,
  userDirectory,
  ensureUsers,
  postedEvent,
  reconnectNonce,
  onUpdate,
  onRemove,
}: {
  column: DeckColumn;
  username: string | null;
  realtimeEnabled: boolean;
  teams: MattermostTeam[];
  unreads: TeamUnread[];
  userDirectory: Record<string, MattermostUser>;
  ensureUsers: (userIds: string[]) => void;
  postedEvent: PostedEvent | null;
  reconnectNonce: number;
  onUpdate: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const [postState, setPostState] = useState<PostState>({
    status: "idle",
    posts: [],
    error: null,
  });
  const [showControls, setShowControls] = useState(!column.teamId);
  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const mentionCount = column.teamId
    ? unreads.find((entry) => entry.team_id === column.teamId)?.mention_count ?? 0
    : null;

  useEffect(() => {
    setShowControls(!column.teamId);
  }, [column.teamId]);

  useEffect(() => {
    let cancelled = false;

    if (!column.teamId || !username) {
      setPostState({
        status: "idle",
        posts: [],
        error: null,
      });
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setPostState((current) => ({
        ...current,
        status: current.posts.length > 0 ? current.status : "loading",
        error: null,
      }));

      try {
        const posts = await searchPostsInTeam(column.teamId as string, `@${username}`, 0, 20);
        if (!cancelled) {
          setPostState({
            status: "ready",
            posts,
            error: null,
          });
          ensureUsers(posts.map((post) => post.user_id));
        }
      } catch (error) {
        if (!cancelled) {
          setPostState({
            status: "error",
            posts: [],
            error: error instanceof Error ? error.message : "Failed to load mentions.",
          });
        }
      }
    };

    void run();
    const startTimer = () =>
      window.setInterval(() => {
        void run();
      }, getSyncInterval(realtimeEnabled));

    let timer = startTimer();
    const handleVisibility = () => {
      window.clearInterval(timer);
      timer = startTimer();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [column.teamId, ensureUsers, realtimeEnabled, reconnectNonce, username]);

  useEffect(() => {
    if (!postedEvent || !column.teamId || postedEvent.teamId !== column.teamId || !postedEvent.mentionsUser) {
      return;
    }

    ensureUsers([postedEvent.post.user_id]);
    setPostState((current) => {
      const posts = current.posts.filter((post) => post.id !== postedEvent.post.id);
      return {
        status: "ready",
        error: null,
        posts: [postedEvent.post, ...posts].slice(0, 20),
      };
    });
  }, [column.teamId, ensureUsers, postedEvent]);

  return (
    <section className="deck-column">
      <header className="deck-column-header">
        <div>
          <h2>Mentions</h2>
          <p>{selectedTeam ? selectedTeam.display_name || selectedTeam.name : "Pick a team for this column"}</p>
        </div>
        <div className="deck-column-actions">
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            aria-label={showControls ? "Collapse mentions controls" : "Expand mentions controls"}
          >
            {showControls ? "-" : "+"}
          </button>
          <div className="deck-badge">{mentionCount ?? "--"}</div>
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => onRemove(column.id)}
            aria-label="Remove mentions column"
          >
            x
          </button>
        </div>
      </header>

      {showControls && (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-controls">
            <TeamSelect
              teams={teams}
              teamId={column.teamId}
              onChange={(teamId) => onUpdate(column.id, { teamId: teamId || undefined })}
            />
          </div>

          {!column.teamId ? (
            <article className="deck-card">
              <strong>Select a team</strong>
              <p>This mentions pane stays pinned to the team you choose here.</p>
            </article>
          ) : (
            <>
              <article className="deck-card">
                <strong>Team</strong>
                <p>{selectedTeam?.display_name || selectedTeam?.name || "Unknown team"}</p>
              </article>
              <article className="deck-card">
                <strong>Mentions</strong>
                <p>{mentionCount === null ? "Loading..." : `${mentionCount} unread mention(s) in this team`}</p>
              </article>
            </>
          )}
        </div>
      )}

      {!column.teamId ? null : postState.status === "error" ? (
        <article className="deck-card">
          <strong>Failed to load mentions</strong>
          <p>{postState.error ?? "Unknown error"}</p>
        </article>
      ) : postState.posts.length === 0 ? (
        <article className="deck-card">
          <strong>No mentions found</strong>
          <p>Matching mention posts will appear here after initial sync or realtime updates.</p>
        </article>
      ) : (
        <PostList posts={postState.posts} userDirectory={userDirectory} />
      )}
    </section>
  );
}

function ChannelWatchColumn({
  column,
  realtimeEnabled,
  teams,
  userDirectory,
  ensureUsers,
  postedEvent,
  reconnectNonce,
  onRememberTarget,
  onUpdate,
  onRemove,
}: {
  column: DeckColumn;
  realtimeEnabled: boolean;
  teams: MattermostTeam[];
  userDirectory: Record<string, MattermostUser>;
  ensureUsers: (userIds: string[]) => void;
  postedEvent: PostedEvent | null;
  reconnectNonce: number;
  onRememberTarget: (target: RecentChannelTarget) => void;
  onUpdate: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const [channelState, setChannelState] = useState<ChannelState>({
    status: "idle",
    channels: [],
    error: null,
  });
  const [postState, setPostState] = useState<PostState>({
    status: "idle",
    posts: [],
    error: null,
  });
  const [showControls, setShowControls] = useState(!(column.teamId && column.channelId));

  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const selectedChannel = channelState.channels.find((channel) => channel.id === column.channelId);

  useEffect(() => {
    setShowControls(!(column.teamId && column.channelId));
  }, [column.channelId, column.teamId]);

  useEffect(() => {
    if (!selectedTeam || !selectedChannel) {
      return;
    }

    onRememberTarget({
      teamId: selectedTeam.id,
      teamLabel: selectedTeam.display_name || selectedTeam.name,
      channelId: selectedChannel.id,
      channelLabel: selectedChannel.display_name || selectedChannel.name,
    });
  }, [onRememberTarget, selectedChannel, selectedTeam]);

  useEffect(() => {
    let cancelled = false;

    if (!column.teamId) {
      setChannelState({
        status: "idle",
        channels: [],
        error: null,
      });
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setChannelState((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      try {
        const channels = await getChannelsForCurrentUser(column.teamId as string);
        if (!cancelled) {
          setChannelState({
            status: "ready",
            channels,
            error: null,
          });

          if (column.channelId && !channels.some((channel) => channel.id === column.channelId)) {
            onUpdate(column.id, { channelId: undefined });
          }
        }
      } catch (error) {
        if (!cancelled) {
          setChannelState({
            status: "error",
            channels: [],
            error: error instanceof Error ? error.message : "Failed to load channels.",
          });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [column.channelId, column.id, column.teamId, onUpdate]);

  useEffect(() => {
    let cancelled = false;

    if (!column.channelId) {
      setPostState({
        status: "idle",
        posts: [],
        error: null,
      });
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setPostState((current) => ({
        ...current,
        status: current.posts.length > 0 ? current.status : "loading",
        error: null,
      }));

      try {
        const posts = await getRecentPosts(column.channelId as string);
        if (!cancelled) {
          setPostState({
            status: "ready",
            posts,
            error: null,
          });
          ensureUsers(posts.map((post) => post.user_id));
        }
      } catch (error) {
        if (!cancelled) {
          setPostState({
            status: "error",
            posts: [],
            error: error instanceof Error ? error.message : "Failed to load posts.",
          });
        }
      }
    };

    void run();
    const startTimer = () =>
      window.setInterval(() => {
        void run();
      }, getSyncInterval(realtimeEnabled));

    let timer = startTimer();
    const handleVisibility = () => {
      window.clearInterval(timer);
      timer = startTimer();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [column.channelId, ensureUsers, realtimeEnabled, reconnectNonce]);

  useEffect(() => {
    if (!postedEvent || !column.channelId || postedEvent.channelId !== column.channelId) {
      return;
    }

    ensureUsers([postedEvent.post.user_id]);
    setPostState((current) => {
      const posts = current.posts.filter((post) => post.id !== postedEvent.post.id);
      return {
        status: "ready",
        error: null,
        posts: [postedEvent.post, ...posts].slice(0, 15),
      };
    });
  }, [column.channelId, ensureUsers, postedEvent]);

  return (
    <section className="deck-column">
      <header className="deck-column-header">
        <div>
          <h2>Channel Watch</h2>
          <p>{selectedChannel ? selectedChannel.display_name || selectedChannel.name : "Pick a team and channel"}</p>
        </div>
        <div className="deck-column-actions">
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            aria-label={showControls ? "Collapse channel controls" : "Expand channel controls"}
          >
            {showControls ? "-" : "+"}
          </button>
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => onRemove(column.id)}
            aria-label="Remove channel watch column"
          >
            x
          </button>
        </div>
      </header>

      {showControls && (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-controls">
            <TeamSelect
              teams={teams}
              teamId={column.teamId}
              onChange={(teamId) => onUpdate(column.id, { teamId: teamId || undefined, channelId: undefined })}
            />
            <label className="deck-field">
              <span>Channel</span>
              <select
                className="deck-select"
                value={column.channelId ?? ""}
                disabled={!column.teamId || channelState.status === "loading"}
                onChange={(event) => onUpdate(column.id, { channelId: event.target.value || undefined })}
              >
                <option value="">Select channel</option>
                {channelState.channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.display_name || channel.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!column.teamId ? (
            <article className="deck-card">
              <strong>Select a team</strong>
              <p>This pane no longer follows the main page. Choose a fixed team first.</p>
            </article>
          ) : !column.channelId ? (
            <article className="deck-card">
              <strong>Select a channel</strong>
              <p>{channelState.error ?? "Choose which channel this pane should watch."}</p>
            </article>
          ) : selectedTeam ? (
            <article className="deck-card deck-card--muted">
              <strong>Pinned target</strong>
              <p>
                {selectedTeam.display_name || selectedTeam.name}
                {selectedChannel ? ` / ${selectedChannel.display_name || selectedChannel.name}` : ""}
              </p>
            </article>
          ) : null}
        </div>
      )}

      {!column.teamId ? null : !column.channelId ? null : postState.status === "error" ? (
        <article className="deck-card">
          <strong>Failed to load posts</strong>
          <p>{postState.error ?? "Unknown error"}</p>
        </article>
      ) : postState.posts.length === 0 ? (
        <article className="deck-card">
          <strong>No posts yet</strong>
          <p>This pinned channel does not have recent posts to show.</p>
        </article>
      ) : (
        <PostList posts={postState.posts.slice(0, 8)} userDirectory={userDirectory} />
      )}
    </section>
  );
}

export function App({ routeKey }: AppProps): React.JSX.Element {
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [postedEvent, setPostedEvent] = useState<PostedEvent | null>(null);
  const [userDirectory, setUserDirectory] = useState<Record<string, MattermostUser>>({});
  const userDirectoryRef = useRef<Record<string, MattermostUser>>({});
  const [drawerOpen, setDrawerOpen] = useStoredBoolean(DRAWER_OPEN_STORAGE_KEY, true);
  const deckSettings = useDeckSettingsState();
  const text = useMemo(() => getAppText(deckSettings.language), [deckSettings.language]);
  const realtimeEnabled = deckSettings.wsPat.trim().length > 0;
  const state = useDeckState(routeKey, reconnectNonce, realtimeEnabled);
  const [columns, addColumn, removeColumn, updateColumn, replaceColumns] = useDeckLayout();
  const [recentTargets, rememberRecentTarget] = useRecentTargets();
  const [railWidth, setRailWidth] = useRailWidth(drawerOpen);
  const [isResizing, setIsResizing] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{ pointerId: number } | null>(null);
  const wsStatus = useWebSocketStatus();
  const wsLogs = useWebSocketLogs();
  const mattermostThemeStyle = useMattermostThemeStyle(deckSettings.theme, routeKey);

  useEffect(() => {
    userDirectoryRef.current = userDirectory;
  }, [userDirectory]);

  const ensureUsers = useCallback(
    (userIds: string[]) => {
      const missing = Array.from(
        new Set(userIds.filter((userId) => userId && !userDirectoryRef.current[userId])),
      );
      if (missing.length === 0) {
        return;
      }

      void getUsersByIds(missing)
        .then((users) => {
          setUserDirectory((current) => {
            const next = { ...current };
            for (const user of users) {
              next[user.id] = user;
            }
            return next;
          });
        })
        .catch(() => undefined);
    },
    [],
  );
  const statusText = useMemo(() => {
    if (state.status === "error") {
      return state.sessionExpired ? text.sessionExpired : state.error ?? text.failedToLoad;
    }
    if (state.status === "loading" || columns === null) {
      return text.loading;
    }

    const layoutText = columns.length === 1 ? `1 ${text.column}` : `${columns.length} ${text.columns}`;
    return layoutText;
  }, [columns, state.error, state.sessionExpired, state.status, text]);

  const realtimeLabel = realtimeEnabled ? getWebSocketStatusLabel(wsStatus) : text.realtimeOff;

  useEffect(() => {
    document.body.classList.toggle("mattermost-deck-resizing", isResizing);
    return () => {
      document.body.classList.remove("mattermost-deck-resizing");
    };
  }, [isResizing]);

  useEffect(() => {
    const mentionTeamIds = new Set(
      (columns ?? [])
        .filter((column) => column.type === "mentions" && column.teamId)
        .map((column) => column.teamId as string),
    );

    if (!state.username || columns === null) {
      return;
    }

    return connectMattermostWebSocket({
      username: state.username,
      enabled: realtimeEnabled,
      token: deckSettings.wsPat,
      onReconnect: () => {
        setReconnectNonce((current) => current + 1);
      },
      onPosted: (event) => {
        setPostedEvent(event);
        if (event.mentionsUser && event.teamId && mentionTeamIds.has(event.teamId)) {
          setReconnectNonce((current) => current + 1);
        }
      },
    });
  }, [columns, deckSettings.wsPat, realtimeEnabled, state.username]);

  useEffect(() => {
    if (!showAddMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showAddMenu]);

  useEffect(() => {
    if (!isResizing || !drawerOpen) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeStateRef.current || event.pointerId !== resizeStateRef.current.pointerId) {
        return;
      }

      setRailWidth(window.innerWidth - event.clientX);
    };

    const finishResize = (event: PointerEvent) => {
      if (!resizeStateRef.current || event.pointerId !== resizeStateRef.current.pointerId) {
        return;
      }

      resizeStateRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };
  }, [drawerOpen, isResizing, setRailWidth]);

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drawerOpen) {
      return;
    }

    resizeStateRef.current = { pointerId: event.pointerId };
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleOpenSettings = () => {
    if (chrome.runtime?.openOptionsPage) {
      void chrome.runtime.openOptionsPage();
      return;
    }

    const url = chrome.runtime?.getURL("options.html");
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <aside
      className={`deck-shell${drawerOpen ? "" : " deck-shell--collapsed"}`}
      aria-label="Mattermost Deck"
      data-theme={deckSettings.theme === "mattermost" ? "mattermost" : resolveTheme(deckSettings.theme)}
      style={mattermostThemeStyle}
    >
      <button
        type="button"
        className={`deck-resizer${isResizing ? " deck-resizer--active" : ""}`}
        onPointerDown={handleResizeStart}
        aria-label="Resize deck area"
        title="Drag to resize deck area"
      >
        <span />
      </button>

      <button
        type="button"
        className="deck-drawer-toggle"
        onClick={() => setDrawerOpen(!drawerOpen)}
        aria-label={drawerOpen ? "Hide deck" : "Show deck"}
        title={drawerOpen ? "Hide deck" : "Show deck"}
      >
        {drawerOpen ? ">" : "<"}
      </button>

      {drawerOpen ? (
        <>
          <header className="deck-topbar">
            <div className="deck-topbar-copy">
              <p className="deck-eyebrow">Mattermost Deck</p>
              <h1>{text.title}</h1>
              <p className="deck-meta">
                {state.username ? `${text.signedInAs} @${state.username}` : text.usingSession}
              </p>
            </div>
            <div className="deck-topbar-actions">
              <button
                type="button"
                className="deck-icon-button deck-icon-button--ghost"
                onClick={handleOpenSettings}
                aria-label={text.settingsHint}
                title={text.settingsHint}
              >
                ⚙
              </button>
              <div className={`deck-status-badge deck-status-badge--${wsStatus}`}>
                <span className="deck-status-badge-dot" />
                <span>{realtimeLabel}</span>
              </div>
              <div className="deck-status-inline">
                <span className="deck-dot" />
                <span>{statusText}</span>
              </div>
              <div className="deck-add-wrap" ref={addMenuRef}>
                <button
                  type="button"
                  className="deck-button"
                  onClick={() => setShowAddMenu((current) => !current)}
                  disabled={columns === null || state.status === "loading"}
                >
                  {text.addLabel}
                </button>
                {showAddMenu ? (
                  <div className="deck-add-menu">
                    <div className="deck-add-menu-title">{text.choosePane}</div>
                    <button
                      type="button"
                      className="deck-add-item"
                      onClick={() => {
                        addColumn("mentions");
                        setShowAddMenu(false);
                      }}
                    >
                      {text.addMentions}
                    </button>
                    <button
                      type="button"
                      className="deck-add-item"
                      onClick={() => {
                        addColumn("channelWatch");
                        setShowAddMenu(false);
                      }}
                    >
                      {text.addChannelWatch}
                    </button>
                    {recentTargets.length > 0 ? (
                      <>
                        <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.recentLabel}</div>
                        {recentTargets.map((target) => (
                          <button
                            key={`${target.teamId}:${target.channelId}`}
                            type="button"
                            className="deck-add-item deck-add-item--recent"
                            onClick={() => {
                              addColumn("channelWatch", {
                                teamId: target.teamId,
                                channelId: target.channelId,
                              });
                              setShowAddMenu(false);
                            }}
                            title={`${target.teamLabel} / ${target.channelLabel}`}
                          >
                            <span>{target.channelLabel}</span>
                            <small>{target.teamLabel}</small>
                          </button>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="deck-scroll-wrap">
            {wsLogs.length > 0 ? (
              <section className="deck-log-panel">
                <div className="deck-log-title">{text.connectionLog}</div>
                <ul className="deck-log-list">
                  {wsLogs.slice(0, 4).map((entry) => (
                    <li key={`${entry.timestamp}-${entry.message}`} className={`deck-log-entry deck-log-entry--${entry.level}`}>
                      <span className="deck-log-time">{formatPostTime(entry.timestamp)}</span>
                      <span className="deck-log-text">{entry.message}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <main
              className="deck-columns"
              style={{ minWidth: Math.max((columns?.length ?? 1) * 340 + 32, railWidth - 24) }}
            >
              {(columns ?? []).map((column) => {
                switch (column.type) {
                  case "mentions":
                    return (
                      <MentionsColumn
                        key={column.id}
                        column={column}
                        username={state.username}
                        realtimeEnabled={realtimeEnabled}
                        teams={state.teams}
                        unreads={state.unreads}
                        userDirectory={userDirectory}
                        ensureUsers={ensureUsers}
                        postedEvent={postedEvent}
                        reconnectNonce={reconnectNonce}
                        onUpdate={updateColumn}
                        onRemove={removeColumn}
                      />
                    );
                  case "channelWatch":
                    return (
                      <ChannelWatchColumn
                        key={column.id}
                        column={column}
                        realtimeEnabled={realtimeEnabled}
                        teams={state.teams}
                        userDirectory={userDirectory}
                        ensureUsers={ensureUsers}
                        postedEvent={postedEvent}
                        reconnectNonce={reconnectNonce}
                        onRememberTarget={rememberRecentTarget}
                        onUpdate={updateColumn}
                        onRemove={removeColumn}
                      />
                    );
                }
              })}
            </main>
          </div>
        </>
      ) : (
        <div className="deck-collapsed-banner">Deck</div>
      )}
    </aside>
  );
}
