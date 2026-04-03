import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  checkApiHealth,
  getChannel,
  getChannelByName,
  getChannelMembers,
  getChannelsForCurrentUser,
  getCurrentUser,
  getDirectChannelsForCurrentUser,
  getRecentPosts,
  getTeamByName,
  getTeamUnread,
  getTeamsForCurrentUser,
  getUsersByIds,
  readCurrentRoute,
  searchPostsInTeam,
  type MattermostChannel,
  type MattermostChannelMember,
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
import { APP_VERSION } from "../version";
import { CustomSelect, type CustomSelectOption } from "./CustomSelect";
import {
  DEFAULT_SETTINGS,
  loadDeckSettings,
  normalisePreferredColumnWidth,
  normalisePreferredRailWidth,
  resolveTheme,
  subscribeDeckSettings,
  type DeckLanguage,
  type DeckTheme,
} from "./settings";

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
  nextPage: number;
  hasMore: boolean;
  loadingMore: boolean;
}

interface WsLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

type ApiHealthStatus = "healthy" | "degraded" | "error";

const FALLBACK_SYNC_INTERVAL_WS_MS = 300_000;
const FALLBACK_SYNC_INTERVAL_HIDDEN_MS = 180_000;
const AVAILABLE_COLUMN_TYPES: DeckColumnType[] = ["mentions", "channelWatch", "dmWatch"];
const RAIL_WIDTH_STORAGE_KEY = "mattermostDeck.railWidth.v1";
const DRAWER_OPEN_STORAGE_KEY = "mattermostDeck.drawerOpen.v1";
const RECENT_TARGETS_STORAGE_KEY = "mattermostDeck.recentTargets.v1";
const MIN_RAIL_WIDTH = 360;
const MAX_RAIL_WIDTH = 1400;
const DEFAULT_RAIL_WIDTH = 720;
const COLLAPSED_DRAWER_WIDTH = 52;
const MAX_RECENT_TARGETS = 6;
const POSTS_PAGE_SIZE = 20;
const POSTS_MAX_BUFFER = 100;
const MIN_MANUAL_REFRESH_MS = 350;
const MIN_LOAD_MORE_MS = 350;
const IDLE_AUTOSCROLL_MS = 8_000;
const POST_ROW_ESTIMATE = 116;
const POST_SEPARATOR_ESTIMATE = 32;
const POST_OVERSCAN = 4;
const POST_VIRTUALIZE_THRESHOLD = 40;

type PostListEntry =
  | {
      type: "separator";
      key: string;
      label: string;
    }
  | {
      type: "post";
      key: string;
      post: MattermostPost;
    };

interface RecentChannelTarget {
  teamId: string;
  teamLabel: string;
  channelId: string;
  channelLabel: string;
}

function formatPostTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return new Intl.DateTimeFormat(
    "ja-JP",
    isToday
      ? {
          hour: "2-digit",
          minute: "2-digit",
        }
      : {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        },
  ).format(date);
}

function isSameCalendarDay(left: number, right: number): boolean {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function getPostDayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return "Today";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildPostListEntries(posts: MattermostPost[]): PostListEntry[] {
  const entries: PostListEntry[] = [];

  posts.forEach((post, index) => {
    const previous = posts[index - 1];
    if (previous && !isSameCalendarDay(previous.create_at, post.create_at)) {
      entries.push({
        type: "separator",
        key: `separator:${post.id}`,
        label: getPostDayLabel(previous.create_at),
      });
    }

    entries.push({
      type: "post",
      key: post.id,
      post,
    });
  });

  return entries;
}

function binarySearchOffsets(offsets: number[], value: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid] <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return Math.max(0, low - 1);
}

function summarisePost(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty message)";
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function isSelectableChannel(channel: MattermostChannel): boolean {
  const candidates = [channel.name, channel.display_name]
    .filter(Boolean)
    .map((value) => value.trim().toLowerCase());

  if (candidates.some((value) => value === "threads" || value === "__threads")) {
    return false;
  }

  return true;
}

function isStandardChannel(channel: MattermostChannel): boolean {
  return isSelectableChannel(channel) && (channel.type === "O" || channel.type === "P");
}

function isDirectMessageChannel(channel: MattermostChannel): boolean {
  return isSelectableChannel(channel) && (channel.type === "D" || channel.type === "G");
}

function getChannelLabel(
  channel: MattermostChannel,
  userDirectory: Record<string, MattermostUser>,
  memberDirectory: Record<string, string[]>,
  currentUserId?: string | null,
): string {
  if (channel.type !== "D" && channel.type !== "G") {
    return channel.display_name?.trim() || channel.name;
  }

  const allMemberIds = (memberDirectory[channel.id] ?? channel.name.split("__"))
    .map((part) => part.trim())
    .filter(Boolean);
  const memberIds =
    allMemberIds.filter((part) => part !== currentUserId).length > 0
      ? allMemberIds.filter((part) => part !== currentUserId)
      : allMemberIds;

  const labels = memberIds.map((userId) => {
    const label = getUserLabel(userDirectory[userId], userId);
    return userId === currentUserId ? `${label} (me)` : label;
  });
  const resolvedLabels = labels.filter(Boolean);
  if (resolvedLabels.length > 0) {
    return resolvedLabels.join(", ");
  }

  return channel.display_name?.trim() || channel.name;
}

function getChannelKindLabel(channel: MattermostChannel | undefined): string | null {
  if (!channel) {
    return null;
  }

  if (channel.type === "D") {
    return "Direct message";
  }

  if (channel.type === "G") {
    return "Group DM";
  }

  return null;
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

function mergePosts(primary: MattermostPost[], secondary: MattermostPost[], limit = POSTS_MAX_BUFFER): MattermostPost[] {
  const deduped = new Map<string, MattermostPost>();
  for (const post of [...primary, ...secondary]) {
    if (!deduped.has(post.id)) {
      deduped.set(post.id, post);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => right.create_at - left.create_at)
    .slice(0, limit);
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

function getApiHealthLabel(status: ApiHealthStatus): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    default:
      return "Error";
  }
}

function openMattermostThread(teamName: string, postId: string): void {
  const nextPath = `/${teamName}/pl/${postId}`;
  if (window.location.pathname === nextPath) {
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }

  window.history.pushState({}, "", nextPath);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      className={`deck-chevron${expanded ? " deck-chevron--expanded" : ""}`}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path d="M4 2.5L7.5 6L4 9.5" />
    </svg>
  );
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg className="deck-close-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3L9 9" />
      <path d="M9 3L3 9" />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: "left" | "right" }): React.JSX.Element {
  return (
    <svg className={`deck-arrow-icon deck-arrow-icon--${direction}`} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 2.5L7.5 6L4 9.5" />
    </svg>
  );
}

function DrawerToggleIcon({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg className={`deck-drawer-icon${open ? " deck-drawer-icon--open" : ""}`} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 2.5L7.5 6L4 9.5" />
    </svg>
  );
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg className="deck-settings-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.9 1.6h2.2l.4 1.6c.4.1.8.3 1.2.5l1.5-.8 1.5 1.5-.8 1.5c.2.4.4.8.5 1.2l1.6.4v2.2l-1.6.4c-.1.4-.3.8-.5 1.2l.8 1.5-1.5 1.5-1.5-.8c-.4.2-.8.4-1.2.5l-.4 1.6H6.9l-.4-1.6c-.4-.1-.8-.3-1.2-.5l-1.5.8-1.5-1.5.8-1.5c-.2-.4-.4-.8-.5-1.2L.9 9.1V6.9l1.6-.4c.1-.4.3-.8.5-1.2l-.8-1.5 1.5-1.5 1.5.8c.4-.2.8-.4 1.2-.5l.4-1.6Z" />
      <circle cx="8" cy="8" r="2.3" />
    </svg>
  );
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg className="deck-plus-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 2v8" />
      <path d="M2 6h8" />
    </svg>
  );
}

function HamburgerIcon(): React.JSX.Element {
  return (
    <svg className="deck-hamburger-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4h10" />
      <path d="M3 8h10" />
      <path d="M3 12h10" />
    </svg>
  );
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }): React.JSX.Element {
  return (
    <svg className={`deck-refresh-icon${spinning ? " deck-refresh-icon--spinning" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12.5 6.5A4.8 4.8 0 0 0 4.3 4.9" />
      <path d="M4.3 4.9V2.8" />
      <path d="M4.3 4.9H6.5" />
      <path d="M3.5 9.5a4.8 4.8 0 0 0 8.2 1.6" />
      <path d="M11.7 11.1v2.1" />
      <path d="M11.7 11.1H9.5" />
    </svg>
  );
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
        addDmWatch: "DM / Group",
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
        addDmWatch: "DM / Group",
        choosePane: "追加するペイン",
        loading: "Mattermost データを読み込み中...",
        sessionExpired: "セッションの有効期限が切れました。再ログインしてください。",
        failedToLoad: "データの読み込みに失敗しました。",
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
  ["--deck-topbar-text"]?: string;
  ["--deck-topbar-text-soft"]?: string;
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
  const appBody = queryFirst([".app__body", ".app__body-center-channel", ".app__content"]);
  const channelHeader = queryFirst([".channel-header", ".channel-header--info", ".center-channel__header"]);
  const postArea = queryFirst([".post-list", ".center-channel", ".app__content"]);
  const button = queryFirst(["button.btn.btn-primary", ".btn.btn-primary", "button[color='primary']"]);
  const link = queryFirst(["a", ".link", ".style--none"]);

  const rootStyle = getComputedStyle(rootElement);
  const sidebarStyle = sidebar ? getComputedStyle(sidebar) : rootStyle;
  const appBodyStyle = appBody ? getComputedStyle(appBody) : rootStyle;
  const channelHeaderStyle = channelHeader ? getComputedStyle(channelHeader) : rootStyle;
  const postAreaStyle = postArea ? getComputedStyle(postArea) : rootStyle;
  const buttonStyle = button ? getComputedStyle(button) : rootStyle;
  const linkStyle = link ? getComputedStyle(link) : rootStyle;

  const sidebarBg = sidebarStyle.backgroundColor || "rgb(20, 93, 191)";
  const sidebarText = sidebarStyle.color || "rgb(255, 255, 255)";
  const shellBg = appBodyStyle.backgroundColor || sidebarBg;
  const centerBg = postAreaStyle.backgroundColor || "rgb(255, 255, 255)";
  const centerText = postAreaStyle.color || "rgb(61, 60, 64)";
  const headerBg = channelHeaderStyle.backgroundColor || centerBg;
  const accent = buttonStyle.backgroundColor || linkStyle.color || "rgb(22, 109, 224)";

  return {
    "--deck-bg": shellBg,
    "--deck-bg-elevated": shellBg,
    "--deck-bg-soft": lightenRgb(shellBg, 0.03),
    "--deck-panel": centerBg,
    "--deck-panel-2": centerBg,
    "--deck-card": lightenRgb(centerBg, 0.015),
    "--deck-card-soft": centerBg,
    "--deck-border": rgbaFromRgb(centerText, 0.12),
    "--deck-border-strong": rgbaFromRgb(centerText, 0.18),
    "--deck-text": centerText,
    "--deck-text-soft": rgbaFromRgb(centerText, 0.72),
    "--deck-text-faint": rgbaFromRgb(centerText, 0.58),
    "--deck-topbar-text": lightenRgb(sidebarText, 0.22),
    "--deck-topbar-text-soft": lightenRgb(rgbaFromRgb(sidebarText, 0.8), 0.12),
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

function getSyncInterval(realtimeEnabled: boolean, pollingIntervalSeconds: number): number {
  if (document.hidden) {
    return Math.max(FALLBACK_SYNC_INTERVAL_HIDDEN_MS, pollingIntervalSeconds * 4_000);
  }

  return realtimeEnabled ? FALLBACK_SYNC_INTERVAL_WS_MS : pollingIntervalSeconds * 1_000;
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

function useDeckState(
  routeKey: string,
  refreshNonce: number,
  realtimeEnabled: boolean,
  pollingIntervalSeconds: number,
): AppState {
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
      }, getSyncInterval(realtimeEnabled, pollingIntervalSeconds));

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
  }, [pollingIntervalSeconds, realtimeEnabled, refreshNonce, routeKey]);

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
  (id: string, direction: "left" | "right") => void,
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

  const persist = useCallback((nextColumns: DeckColumn[]): void => {
    setColumns(nextColumns);
    void saveDeckLayout(STORAGE_KEY, nextColumns);
  }, []);

  const persistFromCurrent = useCallback((transform: (current: DeckColumn[]) => DeckColumn[]): void => {
    setColumns((current) => {
      const base = current ?? createDefaultLayout();
      const next = transform(base);
      void saveDeckLayout(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const addColumn = useCallback(
    (
      type: DeckColumnType,
      defaults: Partial<Pick<DeckColumn, "teamId" | "channelId">> = {},
    ): void => {
      persistFromCurrent((current) => [...current, createColumn(type, defaults)]);
    },
    [persistFromCurrent],
  );

  const removeColumn = useCallback((id: string): void => {
    persistFromCurrent((current) => {
      const nextColumns = current.filter((column) => column.id !== id);
      return nextColumns.length > 0 ? nextColumns : [createColumn("mentions")];
    });
  }, [persistFromCurrent]);

  const updateColumn = useCallback((id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>): void => {
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
  }, [persistFromCurrent]);

  const moveColumn = useCallback((id: string, direction: "left" | "right"): void => {
    persistFromCurrent((current) => {
      const index = current.findIndex((column) => column.id === id);
      if (index < 0) {
        return current;
      }

      const targetIndex = direction === "left" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [column] = next.splice(index, 1);
      next.splice(targetIndex, 0, column);
      return next;
    });
  }, [persistFromCurrent]);

  return [columns, addColumn, removeColumn, updateColumn, moveColumn, persist];
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

function useDeckSettingsState(): {
  loaded: boolean;
  wsPat: string;
  theme: DeckTheme;
  language: DeckLanguage;
  pollingIntervalSeconds: number;
  fontScalePercent: number;
  preferredRailWidth: number;
  preferredColumnWidth: number;
  healthCheckPath: string;
} {
  const [settings, setSettings] = useState<{
    loaded: boolean;
    wsPat: string;
    theme: DeckTheme;
    language: DeckLanguage;
    pollingIntervalSeconds: number;
    fontScalePercent: number;
    preferredRailWidth: number;
    preferredColumnWidth: number;
    healthCheckPath: string;
  }>({
    loaded: false,
    wsPat: "",
    theme: "mattermost",
    language: "ja",
    pollingIntervalSeconds: 45,
    fontScalePercent: DEFAULT_SETTINGS.fontScalePercent,
    preferredRailWidth: DEFAULT_SETTINGS.preferredRailWidth,
    preferredColumnWidth: DEFAULT_SETTINGS.preferredColumnWidth,
    healthCheckPath: DEFAULT_SETTINGS.healthCheckPath,
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

function useApiHealth(
  appStatus: AppState["status"],
  healthCheckPath: string,
  pollingIntervalSeconds: number,
): ApiHealthStatus {
  const [healthStatus, setHealthStatus] = useState<ApiHealthStatus>("healthy");
  const lastSuccessAtRef = useRef<number>(Date.now());
  const consecutiveFailuresRef = useRef(0);

  useEffect(() => {
    if (appStatus === "ready") {
      lastSuccessAtRef.current = Date.now();
      consecutiveFailuresRef.current = 0;
      setHealthStatus("healthy");
      return;
    }

    if (appStatus === "error") {
      consecutiveFailuresRef.current += 1;
      setHealthStatus(consecutiveFailuresRef.current >= 2 ? "error" : "degraded");
    }
  }, [appStatus]);

  useEffect(() => {
    let cancelled = false;

    const intervalMs = Math.max(60_000, pollingIntervalSeconds * 2_000);
    const run = async () => {
      const idleForMs = Date.now() - lastSuccessAtRef.current;
      if (idleForMs < intervalMs) {
        return;
      }

      try {
        const ok = await checkApiHealth(healthCheckPath);
        if (cancelled) {
          return;
        }

        if (ok) {
          lastSuccessAtRef.current = Date.now();
          consecutiveFailuresRef.current = 0;
          setHealthStatus("healthy");
        } else {
          consecutiveFailuresRef.current += 1;
          setHealthStatus(consecutiveFailuresRef.current >= 2 ? "error" : "degraded");
        }
      } catch {
        if (cancelled) {
          return;
        }
        consecutiveFailuresRef.current += 1;
        setHealthStatus(consecutiveFailuresRef.current >= 2 ? "error" : "degraded");
      }
    };

    const timer = window.setInterval(() => {
      void run();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [healthCheckPath, pollingIntervalSeconds]);

  return healthStatus;
}

function useRailWidth(drawerOpen: boolean, preferredRailWidth: number): [number, (nextWidth: number) => void] {
  const [railWidth, setRailWidth] = useState<number>(clampRailWidth(normalisePreferredRailWidth(preferredRailWidth)));

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredNumber(RAIL_WIDTH_STORAGE_KEY);
      if (cancelled) {
        return;
      }

      if (stored !== null) {
        setRailWidth(clampRailWidth(stored));
      } else {
        setRailWidth(clampRailWidth(normalisePreferredRailWidth(preferredRailWidth)));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [preferredRailWidth]);

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

  return [railWidth, setRailWidth];
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
  const options = teams.map((team) => ({
    value: team.id,
    label: team.display_name || team.name,
  })) satisfies CustomSelectOption[];

  return (
    <label className="deck-field">
      <span>Team</span>
      <CustomSelect
        options={options}
        value={teamId ?? ""}
        placeholder="Select team"
        onChange={onChange}
      />
    </label>
  );
}

function PostList({
  posts,
  userDirectory,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  renderMeta,
  onOpenPost,
}: {
  posts: MattermostPost[];
  userDirectory: Record<string, MattermostUser>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  renderMeta?: (post: MattermostPost) => React.ReactNode;
  onOpenPost?: (post: MattermostPost) => void;
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const lastInteractionAtRef = useRef(Date.now());
  const previousTopPostIdRef = useRef<string | null>(posts[0]?.id ?? null);
  const entries = useMemo(() => buildPostListEntries(posts), [posts]);
  const shouldVirtualize = posts.length > POST_VIRTUALIZE_THRESHOLD;

  const markInteraction = useCallback(() => {
    lastInteractionAtRef.current = Date.now();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const column = viewport.closest(".deck-column");
    if (!(column instanceof HTMLElement)) {
      return;
    }

    const updateMetrics = () => {
      setViewportHeight(viewport.clientHeight);
    };

    updateMetrics();

    const observer = new ResizeObserver(() => {
      updateMetrics();
    });
    observer.observe(viewport);
    observer.observe(column);

    const frame = window.requestAnimationFrame(() => {
      updateMetrics();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [posts, shouldVirtualize]);

  useEffect(() => {
    const nextTopPostId = posts[0]?.id ?? null;
    const previousTopPostId = previousTopPostIdRef.current;
    previousTopPostIdRef.current = nextTopPostId;

    if (!nextTopPostId || !previousTopPostId || nextTopPostId === previousTopPostId) {
      return;
    }

    if (Date.now() - lastInteractionAtRef.current < IDLE_AUTOSCROLL_MS) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({ top: 0, behavior: "smooth" });
    setScrollTop(0);
  }, [posts]);

  const rowHeights = useMemo(
    () => entries.map((entry) => (entry.type === "separator" ? POST_SEPARATOR_ESTIMATE : POST_ROW_ESTIMATE)),
    [entries],
  );
  const offsets = useMemo(() => {
    const values: number[] = new Array(entries.length);
    let total = 0;
    for (let index = 0; index < entries.length; index += 1) {
      values[index] = total;
      total += rowHeights[index] ?? 0;
    }
    return values;
  }, [entries, rowHeights]);
  const totalHeight = useMemo(() => rowHeights.reduce((sum, height) => sum + height, 0), [rowHeights]);
  const startIndex = shouldVirtualize ? Math.max(0, binarySearchOffsets(offsets, scrollTop) - POST_OVERSCAN) : 0;
  const endBoundary = scrollTop + viewportHeight;
  const endIndex = shouldVirtualize
    ? Math.min(entries.length, binarySearchOffsets(offsets, endBoundary) + POST_OVERSCAN + 2)
    : entries.length;
  const visibleEntries = entries.slice(startIndex, endIndex);
  const offsetY = offsets[startIndex] ?? 0;
  const spacerHeight = totalHeight;

  const renderEntry = (entry: PostListEntry): React.ReactNode => {
    if (entry.type === "separator") {
      return (
        <li key={entry.key} className="deck-list-separator" aria-hidden="true">
          <span>{entry.label}</span>
        </li>
      );
    }

    const { post } = entry;
    return (
      <li
        key={entry.key}
        className={`deck-card deck-card--post${onOpenPost ? " deck-card--clickable" : ""}`}
        onClick={onOpenPost ? () => onOpenPost(post) : undefined}
      >
        <div className="deck-card-header">
          <strong>{formatPostTime(post.create_at)}</strong>
          <span>{getUserLabel(userDirectory[post.user_id], post.user_id)}</span>
        </div>
        {renderMeta ? <div className="deck-card-meta">{renderMeta(post)}</div> : null}
        <p>{summarisePost(post.message)}</p>
      </li>
    );
  };

  return (
    <div className="deck-post-list">
      {shouldVirtualize ? (
        <div
          ref={viewportRef}
          className="deck-list-viewport"
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);
            markInteraction();
          }}
          onWheel={markInteraction}
          onPointerDown={markInteraction}
        >
          <div className="deck-list-spacer" style={{ height: `${Math.max(spacerHeight, viewportHeight)}px` }}>
            <ul className="deck-list deck-list--virtual" style={{ transform: `translateY(${offsetY}px)` }}>
              {visibleEntries.map((entry) => renderEntry(entry))}
            </ul>
          </div>
        </div>
      ) : (
        <div
          ref={viewportRef}
          className="deck-list-viewport"
          onScroll={markInteraction}
          onWheel={markInteraction}
          onPointerDown={markInteraction}
        >
          <ul className="deck-list">{entries.map((entry) => renderEntry(entry))}</ul>
        </div>
      )}
      {hasMore || loadingMore ? (
        <div className="deck-list-footer">
          <button
            type="button"
            className="deck-load-more"
            onClick={() => onLoadMore?.()}
            disabled={!hasMore || loadingMore}
          >
            <RefreshIcon spinning={loadingMore} />
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
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
  pollingIntervalSeconds,
  canMoveLeft,
  canMoveRight,
  onMove,
  onUpdate,
  onRemove,
  onOpenPost,
}: {
  column: DeckColumn;
  username: string | null;
  realtimeEnabled: boolean;
  teams: MattermostTeam[];
  unreads: TeamUnread[];
  userDirectory: Record<string, MattermostUser>;
  ensureUsers: (userIds: string[]) => Promise<void>;
  postedEvent: PostedEvent | null;
  reconnectNonce: number;
  pollingIntervalSeconds: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (id: string, direction: "left" | "right") => void;
  onUpdate: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void;
  onRemove: (id: string) => void;
  onOpenPost: (post: MattermostPost, teamName?: string) => void;
}): React.JSX.Element {
  const teamIds = useMemo(() => (column.teamId ? [column.teamId] : teams.map((team) => team.id)), [column.teamId, teams]);
  const teamDirectory = useMemo(() => Object.fromEntries(teams.map((team) => [team.id, team])), [teams]);
  const [postState, setPostState] = useState<PostState>({
    status: "idle",
    posts: [],
    error: null,
    nextPage: 1,
    hasMore: false,
    loadingMore: false,
  });
  const [channelDirectory, setChannelDirectory] = useState<Record<string, MattermostChannel>>({});
  const [memberDirectory, setMemberDirectory] = useState<Record<string, string[]>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshStopTimerRef = useRef<number | null>(null);
  const [showControls, setShowControls] = useState(false);
  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const mentionCount = useMemo(
    () =>
      column.teamId
        ? (unreads.find((entry) => entry.team_id === column.teamId)?.mention_count ?? 0)
        : unreads.reduce((total, entry) => total + entry.mention_count, 0),
    [column.teamId, unreads],
  );
  const teamOptions = useMemo(
    () => [{ value: "", label: "All teams" }, ...teams.map((team) => ({ value: team.id, label: team.display_name || team.name }))],
    [teams],
  );

  const finishRefresh = useCallback(() => {
    if (refreshStartedAtRef.current === null) {
      setIsRefreshing(false);
      return;
    }
    const elapsed = Date.now() - refreshStartedAtRef.current;
    const remaining = Math.max(0, MIN_MANUAL_REFRESH_MS - elapsed);
    if (refreshStopTimerRef.current !== null) {
      window.clearTimeout(refreshStopTimerRef.current);
    }
    refreshStopTimerRef.current = window.setTimeout(() => {
      setIsRefreshing(false);
      refreshStartedAtRef.current = null;
      refreshStopTimerRef.current = null;
    }, remaining);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshStopTimerRef.current !== null) {
        window.clearTimeout(refreshStopTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (teamIds.length === 0 || !username) {
      finishRefresh();
      setPostState({
        status: "idle",
        posts: [],
        error: null,
        nextPage: 1,
        hasMore: false,
        loadingMore: false,
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
        const results = await Promise.all(
          teamIds.map(async (teamId) => ({
            teamId,
            posts: await searchPostsInTeam(teamId, `@${username}`, 0, POSTS_PAGE_SIZE),
          })),
        );
        const posts = mergePosts(
          results.flatMap((entry) => entry.posts),
          [],
        );
        if (!cancelled) {
          setPostState((current) => ({
            status: "ready",
            posts: mergePosts(posts, current.posts),
            error: null,
            nextPage: 1,
            hasMore: results.some((entry) => entry.posts.length === POSTS_PAGE_SIZE),
            loadingMore: false,
          }));
          finishRefresh();
          ensureUsers(posts.map((post) => post.user_id));
        }
      } catch (error) {
        if (!cancelled) {
          setPostState({
            status: "error",
            posts: [],
            error: error instanceof Error ? error.message : "Failed to load mentions.",
            nextPage: 1,
            hasMore: false,
            loadingMore: false,
          });
          finishRefresh();
        }
      }
    };

    void run();
    const startTimer = () =>
      window.setInterval(() => {
        void run();
      }, column.teamId ? getSyncInterval(realtimeEnabled, pollingIntervalSeconds) : Math.max(getSyncInterval(realtimeEnabled, pollingIntervalSeconds), 120_000));

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
  }, [column.teamId, ensureUsers, finishRefresh, pollingIntervalSeconds, realtimeEnabled, reconnectNonce, refreshNonce, teamIds, username]);

  useEffect(() => {
    if (!postedEvent || !postedEvent.mentionsUser) {
      return;
    }
    if (column.teamId && postedEvent.teamId !== column.teamId) {
      return;
    }

    ensureUsers([postedEvent.post.user_id]);
    setPostState((current) => {
      const posts = current.posts.filter((post) => post.id !== postedEvent.post.id);
      return {
        status: "ready",
        error: null,
        posts: mergePosts([postedEvent.post], posts),
        nextPage: current.nextPage,
        hasMore: current.hasMore,
        loadingMore: false,
      };
    });
  }, [column.teamId, ensureUsers, postedEvent]);

  useEffect(() => {
    const missingChannelIds = Array.from(
      new Set(postState.posts.map((post) => post.channel_id).filter((channelId) => channelId && !channelDirectory[channelId])),
    );

    if (missingChannelIds.length === 0) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const channels = await Promise.all(missingChannelIds.map((channelId) => getChannel(channelId)));
        if (cancelled) {
          return;
        }

        setChannelDirectory((current) => {
          const next = { ...current };
          for (const channel of channels) {
            next[channel.id] = channel;
          }
          return next;
        });

        const dmChannels = channels.filter((channel) => channel.type === "D" || channel.type === "G");
        if (dmChannels.length === 0) {
          return;
        }

        const memberEntries = await Promise.all(
          dmChannels.map(async (channel) => ({
            channelId: channel.id,
            members: await getChannelMembers(channel.id),
          })),
        );
        if (cancelled) {
          return;
        }

        const nextMemberDirectory = Object.fromEntries(
          memberEntries.map((entry) => [entry.channelId, entry.members.map((member) => member.user_id)]),
        );
        setMemberDirectory((current) => ({ ...current, ...nextMemberDirectory }));
        await ensureUsers(Object.values(nextMemberDirectory).flat());
      } catch {
        return;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [channelDirectory, ensureUsers, postState.posts]);

  const renderPostMeta = useCallback(
    (post: MattermostPost) => {
      const channel = channelDirectory[post.channel_id];
      if (!channel) {
        return null;
      }

      const channelLabel = getChannelLabel(channel, userDirectory, memberDirectory, null);
      if (channel.type === "D" || channel.type === "G") {
        return getChannelKindLabel(channel) === "Group DM" ? `Group DM / ${channelLabel}` : `DM / ${channelLabel}`;
      }

      const teamLabel = channel.team_id ? teamDirectory[channel.team_id]?.display_name || teamDirectory[channel.team_id]?.name : null;
      return teamLabel ? `${channelLabel} / ${teamLabel}` : channelLabel;
    },
    [channelDirectory, memberDirectory, teamDirectory, userDirectory],
  );

  const handleLoadMore = async () => {
    if (teamIds.length === 0 || !username || postState.loadingMore || !postState.hasMore) {
      return;
    }

    setPostState((current) => ({ ...current, loadingMore: true, error: null }));

    try {
      const [results] = await Promise.all([
        Promise.all(
          teamIds.map(async (teamId) => ({
            teamId,
            posts: await searchPostsInTeam(teamId, `@${username}`, postState.nextPage, POSTS_PAGE_SIZE),
          })),
        ),
        new Promise((resolve) => window.setTimeout(resolve, MIN_LOAD_MORE_MS)),
      ]);
      const posts = mergePosts(
        results.flatMap((entry) => entry.posts),
        [],
      );
      ensureUsers(posts.map((post) => post.user_id));
      setPostState((current) => ({
        status: "ready",
        posts: mergePosts(current.posts, posts),
        error: null,
        nextPage: current.nextPage + 1,
        hasMore:
          results.some((entry) => entry.posts.length === POSTS_PAGE_SIZE) &&
          current.posts.length + posts.length < POSTS_MAX_BUFFER,
        loadingMore: false,
      }));
    } catch (error) {
      setPostState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Failed to load more mentions.",
        loadingMore: false,
      }));
    }
  };

  return (
    <section className="deck-column">
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2 title="Mentions">Mentions</h2>
          <p title={selectedTeam ? selectedTeam.display_name || selectedTeam.name : "All teams"}>
            {selectedTeam ? selectedTeam.display_name || selectedTeam.name : "All teams"}
          </p>
        </div>
        <div className="deck-column-actions">
          <div className="deck-badge" title={column.teamId ? "Unread mentions in this team" : "Unread mentions across all teams"}>
            {mentionCount}
          </div>
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            aria-label={showControls ? "Collapse mentions controls" : "Expand mentions controls"}
          >
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>

      {showControls && (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-inline-actions">
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              onClick={() => onMove(column.id, "left")}
              aria-label="Move column left"
              disabled={!canMoveLeft}
            >
              <ArrowIcon direction="left" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              onClick={() => onMove(column.id, "right")}
              aria-label="Move column right"
              disabled={!canMoveRight}
            >
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              onClick={() => {
                refreshStartedAtRef.current = Date.now();
                setIsRefreshing(true);
                setRefreshNonce((current) => current + 1);
              }}
              aria-label="Reload mentions column"
              disabled={isRefreshing}
            >
              <RefreshIcon spinning={isRefreshing} />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              onClick={() => onRemove(column.id)}
              aria-label="Remove mentions column"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="deck-controls">
            <label className="deck-field">
              <span>Team</span>
              <CustomSelect
                options={teamOptions}
                value={column.teamId ?? ""}
                placeholder="All teams"
                onChange={(teamId) => onUpdate(column.id, { teamId: teamId || undefined })}
              />
            </label>
          </div>

          <article className="deck-card">
            <strong>Scope</strong>
            <p>{selectedTeam ? selectedTeam.display_name || selectedTeam.name : "All teams"}</p>
          </article>
          <article className="deck-card">
            <strong>Mentions</strong>
            <p>
              {column.teamId
                ? `${mentionCount} unread mention(s) in this team`
                : `${mentionCount} unread mention(s) across all teams`}
            </p>
          </article>
          {!column.teamId ? (
            <article className="deck-card deck-card--muted">
              <strong>All teams</strong>
              <p>This mode polls each joined team sequentially with a slower interval to reduce API load.</p>
            </article>
          ) : null}
        </div>
      )}

      {postState.status === "error" ? (
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
        <PostList
          posts={postState.posts}
          userDirectory={userDirectory}
          hasMore={postState.hasMore}
          loadingMore={postState.loadingMore}
          onLoadMore={handleLoadMore}
          renderMeta={renderPostMeta}
          onOpenPost={(post) => {
            const channel = channelDirectory[post.channel_id];
            const teamName = channel?.team_id ? teamDirectory[channel.team_id]?.name : selectedTeam?.name;
            onOpenPost(post, teamName);
          }}
        />
      )}
    </section>
  );
}

function ChannelWatchColumn({
  column,
  mode,
  currentUserId,
  realtimeEnabled,
  teams,
  userDirectory,
  ensureUsers,
  postedEvent,
  reconnectNonce,
  pollingIntervalSeconds,
  canMoveLeft,
  canMoveRight,
  onMove,
  onRememberTarget,
  onUpdate,
  onRemove,
  onOpenPost,
}: {
  column: DeckColumn;
  mode: "channel" | "dm";
  currentUserId: string | null;
  realtimeEnabled: boolean;
  teams: MattermostTeam[];
  userDirectory: Record<string, MattermostUser>;
  ensureUsers: (userIds: string[]) => Promise<void>;
  postedEvent: PostedEvent | null;
  reconnectNonce: number;
  pollingIntervalSeconds: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (id: string, direction: "left" | "right") => void;
  onRememberTarget: (target: RecentChannelTarget) => void;
  onUpdate: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void;
  onRemove: (id: string) => void;
  onOpenPost: (post: MattermostPost, teamName?: string) => void;
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
    nextPage: 1,
    hasMore: false,
    loadingMore: false,
  });
  const [memberDirectory, setMemberDirectory] = useState<Record<string, string[]>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshStopTimerRef = useRef<number | null>(null);
  const [showControls, setShowControls] = useState(!(column.teamId && column.channelId));

  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const selectedChannel = channelState.channels.find((channel) => channel.id === column.channelId);
  const selectedChannelKindLabel = getChannelKindLabel(selectedChannel);
  const selectedTeamLabel = selectedTeam ? selectedTeam.display_name || selectedTeam.name : null;
  const selectedChannelLabel = selectedChannel
    ? getChannelLabel(selectedChannel, userDirectory, memberDirectory, currentUserId)
    : null;
  const channelOptions = useMemo(
    () =>
      channelState.channels
        .filter(mode === "dm" ? isDirectMessageChannel : isStandardChannel)
        .map((channel) => ({
          value: channel.id,
          label: getChannelLabel(channel, userDirectory, memberDirectory, currentUserId),
        })),
    [channelState.channels, currentUserId, memberDirectory, mode, userDirectory],
  );

  const finishRefresh = useCallback(() => {
    if (refreshStartedAtRef.current === null) {
      setIsRefreshing(false);
      return;
    }
    const elapsed = Date.now() - refreshStartedAtRef.current;
    const remaining = Math.max(0, MIN_MANUAL_REFRESH_MS - elapsed);
    if (refreshStopTimerRef.current !== null) {
      window.clearTimeout(refreshStopTimerRef.current);
    }
    refreshStopTimerRef.current = window.setTimeout(() => {
      setIsRefreshing(false);
      refreshStartedAtRef.current = null;
      refreshStopTimerRef.current = null;
    }, remaining);
  }, []);

  useEffect(() => {
    setShowControls(mode === "dm" ? !column.channelId : !(column.teamId && column.channelId));
  }, [column.channelId, column.teamId, mode]);

  useEffect(() => {
    return () => {
      if (refreshStopTimerRef.current !== null) {
        window.clearTimeout(refreshStopTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedChannel || !selectedTeam || mode === "dm") {
      return;
    }

    onRememberTarget({
      teamId: selectedTeam.id,
      teamLabel: selectedTeam.display_name || selectedTeam.name,
      channelId: selectedChannel.id,
      channelLabel: getChannelLabel(selectedChannel, userDirectory, memberDirectory, currentUserId),
    });
  }, [currentUserId, memberDirectory, mode, onRememberTarget, selectedChannel, selectedTeam, userDirectory]);

  useEffect(() => {
    let cancelled = false;

    if (mode === "channel" && !column.teamId) {
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
        const channels =
          mode === "dm"
            ? (await getDirectChannelsForCurrentUser()).filter(isDirectMessageChannel)
            : (await getChannelsForCurrentUser(column.teamId as string)).filter(isStandardChannel);
        if (!cancelled) {
          const dmChannels = channels.filter((channel) => channel.type === "D" || channel.type === "G");
          const dmMemberEntries =
            dmChannels.length > 0
              ? await Promise.all(
                  dmChannels.map(async (channel) => ({
                    channelId: channel.id,
                    members: await getChannelMembers(channel.id),
                  })),
                )
              : [];
          const nextMemberDirectory = Object.fromEntries(
            dmMemberEntries.map((entry) => [
              entry.channelId,
              entry.members.map((member: MattermostChannelMember) => member.user_id),
            ]),
          );
          const dmMemberIds = Object.values(nextMemberDirectory)
            .flat()
            .filter((userId) => userId !== currentUserId);
          await ensureUsers(dmMemberIds);
          setMemberDirectory(nextMemberDirectory);
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
  }, [column.channelId, column.id, column.teamId, currentUserId, ensureUsers, mode, onUpdate]);

  useEffect(() => {
    let cancelled = false;

    if (!column.channelId) {
      finishRefresh();
      setPostState({
        status: "idle",
        posts: [],
        error: null,
        nextPage: 1,
        hasMore: false,
        loadingMore: false,
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
        const posts = await getRecentPosts(column.channelId as string, 0, POSTS_PAGE_SIZE);
        if (!cancelled) {
          setPostState((current) => ({
            status: "ready",
            posts: mergePosts(posts, current.posts),
            error: null,
            nextPage: 1,
            hasMore: posts.length === POSTS_PAGE_SIZE,
            loadingMore: false,
          }));
          finishRefresh();
          ensureUsers(posts.map((post) => post.user_id));
        }
      } catch (error) {
        if (!cancelled) {
          setPostState({
            status: "error",
            posts: [],
            error: error instanceof Error ? error.message : "Failed to load posts.",
            nextPage: 1,
            hasMore: false,
            loadingMore: false,
          });
          finishRefresh();
        }
      }
    };

    void run();
    const startTimer = () =>
      window.setInterval(() => {
        void run();
      }, getSyncInterval(realtimeEnabled, pollingIntervalSeconds));

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
  }, [column.channelId, ensureUsers, pollingIntervalSeconds, realtimeEnabled, reconnectNonce, refreshNonce]);

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
        posts: mergePosts([postedEvent.post], posts),
        nextPage: current.nextPage,
        hasMore: current.hasMore,
        loadingMore: false,
      };
    });
  }, [column.channelId, ensureUsers, postedEvent]);

  const handleLoadMore = async () => {
    if (!column.channelId || postState.loadingMore || !postState.hasMore) {
      return;
    }

    setPostState((current) => ({ ...current, loadingMore: true, error: null }));

    try {
      const [posts] = await Promise.all([
        getRecentPosts(column.channelId, postState.nextPage, POSTS_PAGE_SIZE),
        new Promise((resolve) => window.setTimeout(resolve, MIN_LOAD_MORE_MS)),
      ]);
      ensureUsers(posts.map((post) => post.user_id));
      setPostState((current) => ({
        status: "ready",
        posts: mergePosts(current.posts, posts),
        error: null,
        nextPage: current.nextPage + 1,
        hasMore: posts.length === POSTS_PAGE_SIZE && current.posts.length + posts.length < POSTS_MAX_BUFFER,
        loadingMore: false,
      }));
    } catch (error) {
      setPostState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Failed to load more posts.",
        loadingMore: false,
      }));
    }
  };

  return (
    <section className="deck-column">
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2 title={selectedChannelLabel ?? (mode === "dm" ? "DM / Group" : "Channel Watch")}>
            {selectedChannelLabel ?? (mode === "dm" ? "DM / Group" : "Channel Watch")}
          </h2>
          <p
            title={
              selectedChannelLabel
                ? mode === "dm"
                  ? selectedChannelKindLabel ?? "Direct message"
                  : selectedTeamLabel ?? "Unknown team"
                : mode === "dm"
                  ? "Pick a direct message or group"
                  : "Pick a team and channel"
            }
          >
            {selectedChannelLabel
              ? mode === "dm"
                ? selectedChannelKindLabel ?? "Direct message"
                : selectedTeamLabel ?? "Unknown team"
              : mode === "dm"
                ? "Pick a direct message or group"
                : "Pick a team and channel"}
          </p>
        </div>
        <div className="deck-column-actions">
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            aria-label={showControls ? "Collapse channel controls" : "Expand channel controls"}
          >
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>

      {showControls && (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-inline-actions">
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              onClick={() => onMove(column.id, "left")}
              aria-label="Move column left"
              disabled={!canMoveLeft}
            >
              <ArrowIcon direction="left" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              onClick={() => onMove(column.id, "right")}
              aria-label="Move column right"
              disabled={!canMoveRight}
            >
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              onClick={() => {
                refreshStartedAtRef.current = Date.now();
                setIsRefreshing(true);
                setRefreshNonce((current) => current + 1);
              }}
              aria-label={mode === "dm" ? "Reload direct message column" : "Reload channel watch column"}
              disabled={isRefreshing}
            >
              <RefreshIcon spinning={isRefreshing} />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              onClick={() => onRemove(column.id)}
              aria-label={mode === "dm" ? "Remove direct message column" : "Remove channel watch column"}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="deck-controls">
            {mode === "channel" ? (
              <TeamSelect
                teams={teams}
                teamId={column.teamId}
                onChange={(teamId) => onUpdate(column.id, { teamId: teamId || undefined, channelId: undefined })}
              />
            ) : null}
            <label className="deck-field">
              <span>{mode === "dm" ? "DM / Group" : "Channel"}</span>
              <CustomSelect
                options={channelOptions}
                value={column.channelId ?? ""}
                disabled={(mode === "channel" && !column.teamId) || channelState.status === "loading"}
                placeholder={mode === "dm" ? "Select direct message" : "Select channel"}
                onChange={(channelId) => onUpdate(column.id, { channelId: channelId || undefined })}
              />
            </label>
          </div>

          {mode === "channel" && !column.teamId ? (
            <article className="deck-card">
              <strong>Select a team</strong>
              <p>This pane no longer follows the main page. Choose a fixed team first.</p>
            </article>
          ) : !column.channelId ? (
            <article className="deck-card">
              <strong>{mode === "dm" ? "Select a DM / Group" : "Select a channel"}</strong>
              <p>{channelState.error ?? (mode === "dm" ? "Choose which direct message this pane should watch." : "Choose which channel this pane should watch.")}</p>
            </article>
          ) : mode === "dm" ? (
            <article className="deck-card deck-card--muted">
              <strong>{selectedChannelLabel ?? "Pinned target"}</strong>
              <p>{selectedChannelKindLabel ?? "Direct message"}</p>
            </article>
          ) : selectedTeam ? (
            <article className="deck-card deck-card--muted">
              <strong>{selectedChannelLabel ?? "Pinned target"}</strong>
              <p>{selectedTeamLabel}</p>
            </article>
          ) : null}
        </div>
      )}

      {mode === "channel" && !column.teamId ? null : !column.channelId ? null : postState.status === "error" ? (
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
        <PostList
          posts={postState.posts}
          userDirectory={userDirectory}
          hasMore={postState.hasMore}
          loadingMore={postState.loadingMore}
          onLoadMore={handleLoadMore}
          onOpenPost={(post) => onOpenPost(post, selectedTeam?.name)}
        />
      )}
    </section>
  );
}

export function App({ routeKey }: AppProps): React.JSX.Element {
  const currentRoute = useMemo(() => readCurrentRoute(), [routeKey]);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [postedEvent, setPostedEvent] = useState<PostedEvent | null>(null);
  const [userDirectory, setUserDirectory] = useState<Record<string, MattermostUser>>({});
  const userDirectoryRef = useRef<Record<string, MattermostUser>>({});
  const [drawerOpen, setDrawerOpen] = useStoredBoolean(DRAWER_OPEN_STORAGE_KEY, true);
  const deckSettings = useDeckSettingsState();
  const text = useMemo(() => getAppText(deckSettings.language), [deckSettings.language]);
  const realtimeEnabled = deckSettings.wsPat.trim().length > 0;
  const state = useDeckState(routeKey, reconnectNonce, realtimeEnabled, deckSettings.pollingIntervalSeconds);
  const [columns, addColumn, removeColumn, updateColumn, moveColumn, replaceColumns] = useDeckLayout();
  const [recentTargets, rememberRecentTarget] = useRecentTargets();
  const [railWidth, setRailWidth] = useRailWidth(drawerOpen, deckSettings.preferredRailWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [isCompactHeader, setIsCompactHeader] = useState(false);
  const shellRef = useRef<HTMLElement | null>(null);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousColumnRectsRef = useRef<Record<string, DOMRect>>({});
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{ pointerId: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const wsStatus = useWebSocketStatus();
  const wsLogs = useWebSocketLogs();
  const mattermostThemeStyle = useMattermostThemeStyle(deckSettings.theme, routeKey);
  const apiHealthStatus = useApiHealth(state.status, deckSettings.healthCheckPath, deckSettings.pollingIntervalSeconds);
  const shellStyle = useMemo(
    () =>
      ({
        ...mattermostThemeStyle,
        ["--deck-font-scale"]: String(deckSettings.fontScalePercent / 100),
        ["--deck-column-width"]: `${normalisePreferredColumnWidth(deckSettings.preferredColumnWidth)}px`,
      }) as MattermostThemeStyle,
    [deckSettings.fontScalePercent, deckSettings.preferredColumnWidth, mattermostThemeStyle],
  );

  useEffect(() => {
    userDirectoryRef.current = userDirectory;
  }, [userDirectory]);

  useEffect(() => {
    if (!state.userId || !state.username) {
      return;
    }
    const userId = state.userId;
    const username = state.username;

    setUserDirectory((current) => {
      if (current[userId]) {
        return current;
      }

      return {
        ...current,
        [userId]: {
          id: userId,
          username,
        },
      };
    });
  }, [state.userId, state.username]);

  const ensureUsers = useCallback(
    async (userIds: string[]) => {
      const missing = Array.from(
        new Set(userIds.filter((userId) => userId && !userDirectoryRef.current[userId])),
      );
      if (missing.length === 0) {
        return;
      }

      try {
        const users = await getUsersByIds(missing);
        setUserDirectory((current) => {
          const next = { ...current };
          for (const user of users) {
            next[user.id] = user;
          }
          return next;
        });
      } catch {
        return;
      }
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

  const modeLabel = realtimeEnabled ? getWebSocketStatusLabel(wsStatus) : "Polling";
  const syncStatusLabel = `${getApiHealthLabel(apiHealthStatus)} / ${modeLabel}`;
  const handleOpenPost = useCallback(
    (post: MattermostPost, teamName?: string) => {
      const targetTeam = teamName ?? currentRoute.teamName;
      if (!targetTeam) {
        return;
      }
      openMattermostThread(targetTeam, post.id);
    },
    [currentRoute.teamName],
  );

  useEffect(() => {
    document.body.classList.toggle("mattermost-deck-resizing", isResizing);
    return () => {
      document.body.classList.remove("mattermost-deck-resizing");
    };
  }, [isResizing]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || isResizing) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? shell.clientWidth;
      setIsCompactHeader(width < 520);
    });

    observer.observe(shell);
    setIsCompactHeader(shell.clientWidth < 520);
    return () => {
      observer.disconnect();
    };
  }, [drawerOpen, isResizing]);

  useLayoutEffect(() => {
    const currentColumns = columns ?? [];
    const nextRects: Record<string, DOMRect> = {};
    const animated: HTMLDivElement[] = [];

    for (const column of currentColumns) {
      const element = columnRefs.current[column.id];
      if (!element) {
        continue;
      }

      const nextRect = element.getBoundingClientRect();
      nextRects[column.id] = nextRect;
      const previousRect = previousColumnRectsRef.current[column.id];
      if (!previousRect) {
        continue;
      }

      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        continue;
      }

      element.style.transition = "none";
      element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      animated.push(element);
    }

    previousColumnRectsRef.current = nextRects;

    if (animated.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      for (const element of animated) {
        element.style.transition = "transform 160ms ease, opacity 160ms ease";
        element.style.transform = "translate(0, 0)";
      }
    });

    const cleanupTimer = window.setTimeout(() => {
      for (const element of animated) {
        element.style.transition = "";
        element.style.transform = "";
      }
    }, 220);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(cleanupTimer);
    };
  }, [columns]);

  useEffect(() => {
    const hasAllMentionsColumn = (columns ?? []).some((column) => column.type === "mentions" && !column.teamId);
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
        if (event.mentionsUser && (hasAllMentionsColumn || (event.teamId && mentionTeamIds.has(event.teamId)))) {
          setReconnectNonce((current) => current + 1);
        }
      },
    });
  }, [columns, deckSettings.wsPat, realtimeEnabled, state.username]);

  useEffect(() => {
    if (!isResizing || !drawerOpen) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeStateRef.current || event.pointerId !== resizeStateRef.current.pointerId) {
        return;
      }

      pendingWidthRef.current = window.innerWidth - event.clientX;
      if (resizeFrameRef.current !== null) {
        return;
      }

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        if (pendingWidthRef.current !== null) {
          setRailWidth(pendingWidthRef.current);
          pendingWidthRef.current = null;
        }
      });
    };

    const finishResize = (event: PointerEvent) => {
      if (!resizeStateRef.current || event.pointerId !== resizeStateRef.current.pointerId) {
        return;
      }

      resizeStateRef.current = null;
      setIsResizing(false);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (pendingWidthRef.current !== null) {
        setRailWidth(pendingWidthRef.current);
        pendingWidthRef.current = null;
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      pendingWidthRef.current = null;
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

    if (chrome.runtime?.sendMessage) {
      void chrome.runtime.sendMessage({ type: "mattermost-deck:open-options" });
    }
  };

  const handleAddColumn = (
    type: DeckColumnType,
    defaults?: Partial<Pick<DeckColumn, "teamId" | "channelId">>,
  ) => {
    addColumn(type, defaults);
    setShowAddMenu(false);
    setShowActionsMenu(false);
  };

  return (
    <aside
      ref={shellRef}
      className={`deck-shell${drawerOpen ? "" : " deck-shell--collapsed"}`}
      aria-label="Mattermost Deck"
      data-theme={deckSettings.theme === "mattermost" ? "mattermost" : resolveTheme(deckSettings.theme)}
      style={shellStyle}
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
        <DrawerToggleIcon open={drawerOpen} />
      </button>

      {drawerOpen ? (
        <>
          <header className={`deck-topbar deck-topbar--compact${isCompactHeader ? " deck-topbar--collapsed" : ""}`}>
            <div className="deck-topbar-copy">
              <h1>
                <span>{text.title}</span>
                <span className="deck-version">v{APP_VERSION}</span>
              </h1>
              <p className="deck-meta deck-meta--compact">
                {state.username ? `${text.signedInAs} @${state.username}` : text.usingSession}
              </p>
            </div>
            <div className="deck-topbar-actions">
              <button
                type="button"
                className="deck-icon-button deck-icon-button--plain"
                onClick={handleOpenSettings}
                aria-label={text.settingsHint}
                title={text.settingsHint}
              >
                <SettingsIcon />
              </button>
              {realtimeEnabled ? (
                <div className={`deck-status-badge deck-status-badge--${apiHealthStatus}`}>
                  <span className="deck-status-badge-dot" />
                  <span>{syncStatusLabel}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className={`deck-status-badge deck-status-badge--${apiHealthStatus} deck-status-badge--action`}
                  onClick={handleOpenSettings}
                  title={text.settingsHint}
                >
                  <span className="deck-status-badge-dot" />
                  <span>{syncStatusLabel}</span>
                </button>
              )}
              <div className={`deck-status-inline${isCompactHeader ? " deck-status-inline--hidden" : ""}`}>
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
                  <PlusIcon />
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
                    <button
                      type="button"
                      className="deck-add-item"
                      onClick={() => {
                        addColumn("dmWatch");
                        setShowAddMenu(false);
                      }}
                    >
                      {text.addDmWatch}
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
              <div className="deck-add-wrap deck-actions-wrap" ref={actionsMenuRef}>
                <button
                  type="button"
                  className="deck-icon-button deck-icon-button--ghost deck-actions-button"
                  onClick={() => setShowActionsMenu((current) => !current)}
                  aria-label="Open menu"
                  disabled={columns === null || state.status === "loading"}
                >
                  <HamburgerIcon />
                </button>
                {showActionsMenu ? (
                  <div className="deck-add-menu deck-add-menu--compact">
                    <div className="deck-add-menu-title">{statusText}</div>
                    <button
                      type="button"
                      className="deck-add-item"
                      onClick={() => {
                        handleOpenSettings();
                        setShowActionsMenu(false);
                      }}
                    >
                      {text.settingsButton}
                    </button>
                    <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.choosePane}</div>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("mentions")}>
                      {text.addMentions}
                    </button>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("channelWatch")}>
                      {text.addChannelWatch}
                    </button>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("dmWatch")}>
                      {text.addDmWatch}
                    </button>
                    {recentTargets.length > 0 ? (
                      <>
                        <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.recentLabel}</div>
                        {recentTargets.map((target) => (
                          <button
                            key={`${target.teamId}:${target.channelId}`}
                            type="button"
                            className="deck-add-item deck-add-item--recent"
                            onClick={() =>
                              handleAddColumn("channelWatch", {
                                teamId: target.teamId,
                                channelId: target.channelId,
                              })
                            }
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
              style={{
                minWidth:
                  (columns?.length ?? 1) * (normalisePreferredColumnWidth(deckSettings.preferredColumnWidth) + 20) + 32,
              }}
            >
              {(columns ?? []).map((column, index, allColumns) => {
                const setColumnRef = (element: HTMLDivElement | null) => {
                  columnRefs.current[column.id] = element;
                };
                switch (column.type) {
                  case "mentions":
                    return (
                      <div key={column.id} ref={setColumnRef} className="deck-column-motion">
                        <MentionsColumn
                          column={column}
                          username={state.username}
                          realtimeEnabled={realtimeEnabled}
                          teams={state.teams}
                          unreads={state.unreads}
                          userDirectory={userDirectory}
                          ensureUsers={ensureUsers}
                          postedEvent={postedEvent}
                          reconnectNonce={reconnectNonce}
                          pollingIntervalSeconds={deckSettings.pollingIntervalSeconds}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onUpdate={updateColumn}
                          onRemove={removeColumn}
                          onOpenPost={handleOpenPost}
                        />
                      </div>
                    );
                  case "channelWatch":
                    return (
                      <div key={column.id} ref={setColumnRef} className="deck-column-motion">
                        <ChannelWatchColumn
                          column={column}
                          mode="channel"
                          currentUserId={state.userId}
                          realtimeEnabled={realtimeEnabled}
                          teams={state.teams}
                          userDirectory={userDirectory}
                          ensureUsers={ensureUsers}
                          postedEvent={postedEvent}
                          reconnectNonce={reconnectNonce}
                          pollingIntervalSeconds={deckSettings.pollingIntervalSeconds}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onRememberTarget={rememberRecentTarget}
                          onUpdate={updateColumn}
                          onRemove={removeColumn}
                          onOpenPost={handleOpenPost}
                        />
                      </div>
                    );
                  case "dmWatch":
                    return (
                      <div key={column.id} ref={setColumnRef} className="deck-column-motion">
                        <ChannelWatchColumn
                          column={column}
                          mode="dm"
                          currentUserId={state.userId}
                          realtimeEnabled={realtimeEnabled}
                          teams={state.teams}
                          userDirectory={userDirectory}
                          ensureUsers={ensureUsers}
                          postedEvent={postedEvent}
                          reconnectNonce={reconnectNonce}
                          pollingIntervalSeconds={deckSettings.pollingIntervalSeconds}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onRememberTarget={rememberRecentTarget}
                          onUpdate={updateColumn}
                          onRemove={removeColumn}
                          onOpenPost={handleOpenPost}
                        />
                      </div>
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
