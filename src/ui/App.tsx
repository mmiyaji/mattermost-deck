import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ShadowRootContext } from "./ShadowRootContext";
import i18n from "./i18n";
import {
  checkApiHealth,
  fetchPostFileInfos,
  getChannelByName,
  getChannelMembers,
  getChannelsByIds,
  getChannelMembersForCurrentUser,
  getChannelsForCurrentUser,
  getCurrentUser,
  getDirectChannelsForCurrentUser,
  getApiPerformanceSnapshot,
  getFlaggedPosts,
  getMattermostClientConfig,
  getMentionGroupsForUser,
  getPostsByIds,
  getPostThreadSince,
  getPostThreadSinceWithMetadata,
  getRecentPosts,
  getTeamUnread,
  getTeamsForCurrentUser,
  getUserPreferences,
  getUserThreads,
  getUsersByIds,
  invalidateMentionMetadataCaches,
  invalidatePostByIdCache,
  getMyChannelMember,
  getMattermostUrl,
  viewChannel,
  readCurrentRoute,
  scanPostsSincePages,
  searchPostsInTeam,
  type CurrentRoute,
  type MattermostChannel,
  type MattermostChannelMember,
  type MattermostFileInfo,
  type MattermostPost,
  type MattermostTeam,
  type MattermostUser,
  type MattermostUserThread,
  type TeamUnread,
} from "../mattermost/api";
import {
  appendPostedEvent,
  connectMattermostWebSocket,
  isChannelReadStateEvent,
  type PostedEvent,
  type WebSocketStatus,
} from "../mattermost/websocket";
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
  normaliseColumns,
  saveDeckLayout,
  saveStoredJson,
  saveStoredNumber,
} from "./storage";
import { getProfileStorageKey, loadCurrentDeckProfile, PROFILES_STORAGE_KEY } from "./profiles";
import { APP_VERSION } from "../version";
import { getDeckDiagnosticsSnapshot, recordRenderCommit, recordSpecialMentionScan } from "../diagnostics";
import { addTraceEntry } from "../traceLog";
import { CustomSelect, type CustomSelectOption } from "./CustomSelect";
import { useAppText } from "./appText";
import {
  DEFAULT_COLUMN_COLORS,
  DEFAULT_SETTINGS,
  loadDeckSettings,
  MAX_PREFERRED_RAIL_WIDTH,
  MIN_PREFERRED_RAIL_WIDTH,
  normalisePreferredColumnWidth,
  normalisePreferredRailWidth,
  resolveTheme,
  subscribeDeckSettings,
  type ColumnColorKey,
  type ColumnColorSettings,
  type DeckLanguage,
  type DeckTheme,
  type PostClickAction,
} from "./settings";
import {
  buildSearchSnippet,
  expandSearchQueryForApi,
  extractSearchTerms,
  formatPostTime,
  getCompactAuthorColor,
  getUserAvatarUrl,
  getUserLabel,
  mergePosts,
  renderHighlightedTextFromTerms,
  resolveHighlightTerms,
  summarisePost,
  uniqueTerms,
} from "./postHelpers";
import { shouldGroupAdjacentPosts } from "./postGrouping";
import {
  focusMattermostPost,
  getDeckRoutePath,
  resolveDeckCurrentRoute,
} from "./mattermostNavigation";
import { dedupeRecentTargets, type RecentChannelTarget } from "./recentTargets";
import { mapInBatches } from "./asyncBatch";
import { collectUnreadMentionThreads } from "./mentionThreadCollector";
import { useElementVisibility } from "./useElementVisibility";
import {
  calculateResponsiveRailWidth,
  calculateThreadAwareRailLayout,
  MIN_MANUAL_MATTERMOST_WIDTH,
  MIN_MATTERMOST_WIDTH,
  type MattermostHostLayout,
  type ResponsiveRailMode,
} from "./railLayout";
import { getLocalizedApiErrorMessage, isMattermostSessionExpiredError } from "./apiErrorMessage";
import { getMattermostApiErrorStatus } from "../mattermost/errors";
import {
  applyMentionReadMarkers,
  buildMentionReadState,
  buildMentionSearchTerms,
  compactMentionReadState,
  filterActiveMentionPosts,
  filterUnreadMentionPosts,
  getEffectiveTeamMentionCount,
  getMattermostMentionKeys,
  getUnreadPostsFromThread,
  hasMentionRelevantPostChanged,
  invalidateMentionReadMarkers,
  isCollapsedThreadsEnabled,
  mergeMentionReadMarkers,
  mergeMentionReadStates,
  postMatchesMentionCandidate,
  postMatchesRealtimeMentionCandidate,
  postMatchesImplicitMention,
  type MattermostMentionKey,
  type MentionReadMarkers,
  type MentionReadState,
} from "./mentionFeed";
import {
  buildMentionCacheEntryId,
  loadMentionCache,
  removeMentionCache,
  saveMentionCache,
  type MentionCacheContext,
} from "./mentionCache";
import { summariseMentionPresentationChanges } from "./mentionPresentation";
import {
  PendingPostMeta,
  postedEventNeedsChannelMetadata,
  postMatchesBoundedImplicitMention,
  shouldSafeStopDeckState,
  takeScopedMentionPostedEvents,
  withPostedEventChannelMetadata,
} from "./appBehavior";


interface AppProps {
  routeKey: string;
  shadowRoot: ShadowRoot | null;
}

interface AppState {
  status: "loading" | "ready" | "error";
  userId: string | null;
  username: string | null;
  currentUser: MattermostUser | null;
  teams: MattermostTeam[];
  unreads: TeamUnread[];
  currentTeamId: string | undefined;
  currentChannelId: string | undefined;
  currentTeamLabel: string | null;
  currentChannelLabel: string | null;
  error: string | null;
  sessionExpired: boolean;
}

type CurrentRouteContext = Pick<
  AppState,
  | "currentTeamId"
  | "currentChannelId"
  | "currentTeamLabel"
  | "currentChannelLabel"
>;

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

interface MentionLoadProgressState {
  runId: number;
  active: boolean;
  posts: MattermostPost[];
  readState: MentionReadState;
  completedTeams: number;
  totalTeams: number;
}

interface MentionCacheDisplayState {
  entryId: string | null;
  ownerUserId: string | null;
  scopeTeamId: string | null;
  active: boolean;
  posts: MattermostPost[];
  readState: MentionReadState;
  savedAt: number | null;
}

interface MentionDisplaySnapshot {
  runId: number;
  posts: MattermostPost[];
  deferredPostIds: string[];
}

type ChannelMentionLoadProgress =
  | {
      type: "context";
      members: MattermostChannelMember[];
      activeChannelIds: Record<string, true> | null;
    }
  | {
      type: "posts";
      posts: MattermostPost[];
    };

type ThreadMentionLoadProgress =
  | {
      type: "context";
      threads: MattermostUserThread[];
    }
  | {
      type: "posts";
      posts: MattermostPost[];
    };

type MentionLoadPipeline = "search" | "channel" | "thread";

interface MentionTeamLoadAccumulator {
  posts: MattermostPost[];
  channelContext: {
    members: MattermostChannelMember[];
    activeChannelIds: Record<string, true> | null;
  } | null;
  threadContext: MattermostUserThread[] | null;
  readState: MentionReadState | null;
  completedPipelines: Set<MentionLoadPipeline>;
}

interface MentionActiveChannelSnapshot {
  channels: MattermostChannel[] | null;
  activeChannelIds: Record<string, true> | null;
  channelDirectory: ReadonlyMap<string, MattermostChannel>;
}

interface WsLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

type SyncLogEntry = WsLogEntry;

interface DiagnosticsLogEntry extends SyncLogEntry {
  summary: string;
  count: number;
}

interface RuntimePerformanceSnapshot {
  domNodeCount: number;
  memoryUsedMb: number | null;
  memoryLimitMb: number | null;
  memoryUsageRatio: number | null;
  api: ReturnType<typeof getApiPerformanceSnapshot>;
  diagnostics: ReturnType<typeof getDeckDiagnosticsSnapshot>;
}

type ApiHealthStatus = "healthy" | "degraded" | "error";

function createEmptyMentionReadState(): MentionReadState {
  return {
    channelLastViewedAt: {},
    threadLastViewedAt: {},
    activeChannelIds: null,
  };
}

function createMentionLoadProgressState(
  runId: number,
  totalTeams = 0,
  active = false,
): MentionLoadProgressState {
  return {
    runId,
    active,
    posts: [],
    readState: createEmptyMentionReadState(),
    completedTeams: 0,
    totalTeams,
  };
}

function createMentionCacheDisplayState(
  entryId: string | null = null,
): MentionCacheDisplayState {
  return {
    entryId,
    ownerUserId: null,
    scopeTeamId: null,
    active: false,
    posts: [],
    readState: createEmptyMentionReadState(),
    savedAt: null,
  };
}

async function loadMentionActiveChannelSnapshot(): Promise<MentionActiveChannelSnapshot> {
  try {
    const channels = (await getDirectChannelsForCurrentUser()).filter(
      (channel) => (channel.delete_at ?? 0) === 0,
    );
    return {
      channels,
      activeChannelIds: Object.fromEntries(
        channels.map((channel) => [channel.id, true]),
      ),
      channelDirectory: new Map(
        channels.map((channel) => [channel.id, channel]),
      ),
    };
  } catch {
    return {
      channels: null,
      activeChannelIds: null,
      channelDirectory: new Map(),
    };
  }
}

const FALLBACK_SYNC_INTERVAL_WS_MS = 300_000;
const FALLBACK_SYNC_INTERVAL_HIDDEN_MS = 180_000;
const DRAWER_UNMOUNT_DELAY_MS = 5 * 60 * 1_000;
const DECK_ROOT_ID = "mattermost-deck-root";
const AVAILABLE_COLUMN_TYPES: DeckColumnType[] = ["mentions", "channelWatch", "dmWatch"];
const RAIL_WIDTH_STORAGE_KEY = "mattermostDeck.railWidth.v1";
const DRAWER_OPEN_STORAGE_KEY = "mattermostDeck.drawerOpen.v1";
const RECENT_TARGETS_STORAGE_KEY = "mattermostDeck.recentTargets.v1";
const SAVED_VIEWS_STORAGE_KEY = "mattermostDeck.savedViews.v1";
const VIEWPORT_RESIZING_CLASS = "mattermost-deck-viewport-resizing";
const RIGHT_PANE_LAYOUT_SYNC_CLASS = "mattermost-deck-right-pane-layout-sync";
const RIGHT_PANE_VIEWPORT_SYNC_CLASS =
  "mattermost-deck-right-pane-viewport-sync";
const VIEWPORT_RESIZE_SETTLE_MS = 120;
const MIN_RAIL_WIDTH = MIN_PREFERRED_RAIL_WIDTH;
const MAX_RAIL_WIDTH = MAX_PREFERRED_RAIL_WIDTH;
const DEFAULT_RAIL_WIDTH = 720;
const RAIL_RESIZE_DRAG_THRESHOLD_PX = 4;
const COLLAPSED_DRAWER_WIDTH = 52;
const MAX_RECENT_TARGETS = 6;
const POSTS_PAGE_SIZE = 20;
const POSTS_MAX_BUFFER = 100;
const MENTIONS_PAGE_SIZE = 100;
const MENTIONS_MAX_BUFFER = 500;
const MENTION_THREAD_POST_SCAN_LIMIT = 500;
const MENTION_UNREAD_THREAD_SCAN_LIMIT = 500;
const MENTION_FULL_THREAD_LOOKUP_LIMIT = 50;
const USER_DIRECTORY_MAX_ENTRIES = 2_000;
const MENTION_METADATA_DIRECTORY_MAX_ENTRIES = 2_000;
const MENTION_UNREAD_RECONCILE_CACHE_MAX_MS = 5_000;
const MENTION_HISTORY_RECONCILE_CACHE_MS = 5 * 60_000;
const THREADS_PAGE_SIZE = 200;
const POSTED_EVENT_BUFFER_SIZE = 100;
const MIN_MANUAL_REFRESH_MS = 350;
const MIN_LOAD_MORE_MS = 350;
const IDLE_AUTOSCROLL_MS = 8_000;
const SEARCH_SYNC_INTERVAL_FLOOR_MS = 120_000;
const MAX_SAVED_VIEWS = 8;
const DEBUG_FLAG_KEY = "mattermostDeck.debugLogs";
const MENTIONS_LAST_READ_AT_STORAGE_KEY = "mattermostDeck.mentionsLastReadAt.v1";
const COMPACT_HEADER_BREAKPOINT_PX = 620;
const HOST_LAYOUT_SETTLE_MS = 360;
const HOST_LAYOUT_JITTER_TOLERANCE_PX = 2;
const MAX_MATTERMOST_RHS_TARGETS = 4;
const DECK_CONTENT_ID = "mattermost-deck-content";
const VIEWS_MENU_ID = "mattermost-deck-views-menu";
const ADD_MENU_ID = "mattermost-deck-add-menu";
const ACTIONS_MENU_ID = "mattermost-deck-actions-menu";
const RAIL_ADD_MENU_ID = "mattermost-deck-rail-add-menu";
const MENTION_RECONCILE_DEBOUNCE_MS = 800;
const MENTION_RECONCILE_MAX_WAIT_MS = 2_500;
const MAX_IMPLICIT_MENTION_RECONCILES_IN_FLIGHT = 8;
const SPECIAL_MENTION_MEMBER_TTL_MS = 45_000;
const SPECIAL_MENTION_MEMBER_TTL_WS_MS = 180_000;
const SPECIAL_MENTION_MEMBER_CACHE_MAX_TEAMS = 12;
const TEAM_FANOUT_BATCH_SIZE = 2;
const TEAM_FANOUT_GAP_MS = 250;
const CHANNEL_FANOUT_BATCH_SIZE = 3;
const CHANNEL_FANOUT_GAP_MS = 150;
const MENTION_PROGRESS_FLUSH_MS = 150;
const ROUTE_EVENT = "mattermost-deck-route-change";

function getCurrentDateLocale(): string {
  return i18n.resolvedLanguage || i18n.language || "en";
}

function getPreferredScrollBehavior(): ScrollBehavior {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

function readDeckCurrentRoute(): CurrentRoute {
  return resolveDeckCurrentRoute(
    getDeckRoutePath(
      window.location.pathname,
      window.location.hash,
    ),
    readCurrentRoute(),
  );
}

declare global {
  interface Window {
    __mattermostDeckDebug?: {
      getState: () => {
        contentMounted: boolean;
        stateStatus: string;
        username: string | null;
        routeKey: string;
        currentTeamId?: string;
        currentChannelId?: string;
        currentTeamLabel: string | null;
        currentChannelLabel: string | null;
        wsStatus: WebSocketStatus;
        drawerOpen: boolean;
        effectiveDrawerOpen: boolean;
        railWidth: number;
        requestedRailWidth: number;
        autoAdjustThreadLayout: boolean;
        canResizeRail: boolean;
        threadLayoutMode: ResponsiveRailMode | "override";
        hostLayout: MattermostHostLayout;
        hostLayoutMeasurementCount: number;
        userTimingMeasureCount: number;
        horizontalScrollLeft: number;
        columns: Array<{
          id: string;
          type: DeckColumnType;
          teamId?: string;
          channelId?: string;
          query?: string;
          unreadOnly?: boolean;
        }>;
      };
      getThemeState: () => {
        initialSource: "cache" | "extract" | "none";
        activeTheme: DeckTheme;
        style: Record<string, string>;
        cacheKey: string | null;
        cachedStyle: Record<string, string> | null;
      };
      addColumn: (
        type: DeckColumnType,
        defaults?: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>,
      ) => string;
      updateColumn: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>) => void;
      moveColumn: (id: string, direction: "left" | "right") => void;
      removeColumn: (id: string) => void;
    };
    __mattermostDeckDebugColumnState?: Record<string, unknown>;
  }
}

function isDebugEnabled(): boolean {
  if (!__MATTERMOST_DECK_E2E_DEBUG__) {
    return false;
  }

  try {
    return window.localStorage.getItem(DEBUG_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function debugLog(event: string, payload?: Record<string, unknown>): void {
  if (!isDebugEnabled()) {
    return;
  }

  if (payload) {
    console.info(`[deck-debug] ${event}`, payload);
    addTraceEntry({ source: "app", level: "info", event, payload });
    return;
  }
  console.info(`[deck-debug] ${event}`);
  addTraceEntry({ source: "app", level: "info", event });
}

function useRefreshIndicator(): {
  isRefreshing: boolean;
  startRefresh: () => void;
  finishRefresh: () => void;
} {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshStopTimerRef = useRef<number | null>(null);

  const startRefresh = useCallback(() => {
    refreshStartedAtRef.current = Date.now();
    setIsRefreshing(true);
  }, []);

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

  return { isRefreshing, startRefresh, finishRefresh };
}

function useColumnPolling(
  run: (isCancelled: () => boolean) => Promise<void> | void,
  intervalMs: number,
  {
    dependencies,
    enabled = true,
    paused = false,
    onDisabled,
  }: {
    dependencies: React.DependencyList;
    enabled?: boolean;
    paused?: boolean;
    onDisabled?: () => void;
  },
): void {
  const runQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    if (paused) {
      return () => {
        cancelled = true;
      };
    }

    if (!enabled) {
      onDisabled?.();
      return () => {
        cancelled = true;
      };
    }

    let timer: number | null = null;
    let running = false;
    const schedule = () => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(() => {
        void execute();
      }, Math.max(1, intervalMs));
    };
    const execute = async () => {
      if (cancelled || running) {
        return;
      }
      running = true;
      try {
        const queuedRun = runQueueRef.current.then(async () => {
          if (cancelled) {
            return;
          }
          await run(isCancelled);
        });
        const settledRun = queuedRun.catch(() => undefined);
        runQueueRef.current = settledRun;
        await settledRun;
      } finally {
        running = false;
        schedule();
      }
    };

    void execute();
    const handleVisibility = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (!running) {
        schedule();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, dependencies);
}

interface OpenPostTarget {
  teamName?: string;
  channelName?: string;
}

interface OpenThreadTarget {
  postId: string;
  rootId?: string;
}

type PostListEntry =
  | {
      type: "separator";
      key: string;
      label: string;
    }
  | {
      type: "unread-separator";
      key: string;
    }
  | {
      type: "post";
      key: string;
      post: MattermostPost;
    };

interface SavedDeckView {
  id: string;
  name: string;
  columns: DeckColumn[];
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
    return i18n.t("deck.today", { defaultValue: "Today" });
  }

  return new Intl.DateTimeFormat(getCurrentDateLocale(), {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildPostListEntries(posts: MattermostPost[], lastViewedAt?: number | null): PostListEntry[] {
  const entries: PostListEntry[] = [];
  let unreadInserted = false;

  posts.forEach((post, index) => {
    const previous = posts[index - 1];
    if (previous && !isSameCalendarDay(previous.create_at, post.create_at)) {
      entries.push({
        type: "separator",
        key: `separator:${post.id}`,
        label: getPostDayLabel(previous.create_at),
      });
    }

    // Posts are sorted newest-first. Insert the unread separator before the
    // first post older than lastViewedAt. If the very first post is already
    // older than lastViewedAt, there are no unread posts left to separate.
    if (!unreadInserted && lastViewedAt != null && lastViewedAt > 0 && post.create_at <= lastViewedAt) {
      unreadInserted = true;
      if (index > 0) {
        entries.push({
          type: "unread-separator",
          key: "unread-separator",
        });
      }
    }

    entries.push({
      type: "post",
      key: post.id,
      post,
    });
  });

  return entries;
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
    return userId === currentUserId ? `${label} (${i18n.t("deck.currentUser")})` : label;
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
    return i18n.t("deck.directMessage");
  }

  if (channel.type === "G") {
    return i18n.t("deck.groupDirectMessage");
  }

  return null;
}

function getRecentTargetLabel(
  label: string,
  userDirectory: Record<string, MattermostUser>,
  currentUserId?: string | null,
): string {
  const parts = label
    .split("__")
    .map((part) => part.trim())
    .filter(Boolean);

  const looksLikeRawIds =
    parts.length > 0 &&
    parts.every((part) => /^[a-z0-9]{20,}$/i.test(part) || Boolean(userDirectory[part]));

  if (!looksLikeRawIds) {
    return label;
  }

  const visibleParts = parts.filter((part) => part !== currentUserId);
  const source = visibleParts.length > 0 ? visibleParts : parts;
  return source
    .map((userId) => {
      const resolved = getUserLabel(userDirectory[userId], userId);
      return source.length === 1 && userId === currentUserId ? `${resolved} (${i18n.t("deck.currentUser")})` : resolved;
    })
    .join(", ");
}

function getColumnColorKey(type: DeckColumnType): ColumnColorKey {
  switch (type) {
    case "mentions":
      return "mentions";
    case "channelWatch":
      return "channelWatch";
    case "dmWatch":
      return "dmWatch";
    case "keywordWatch":
      return "keywordWatch";
    case "search":
      return "search";
    case "saved":
      return "saved";
    case "diagnostics":
      return "diagnostics";
  }
}

function getColumnAccentStyle(type: DeckColumnType, columnColors: ColumnColorSettings): React.CSSProperties {
  const accent = columnColors[getColumnColorKey(type)] ?? DEFAULT_COLUMN_COLORS[getColumnColorKey(type)];
  return {
    "--deck-column-accent": accent,
  } as React.CSSProperties;
}

function SettingsMenuLabel({ label }: { label: string }): React.JSX.Element {
  return (
    <span className="deck-menu-label">
      <span className="deck-menu-inline-icon" aria-hidden="true">
        <SettingsIcon />
      </span>
      <span>{label}</span>
    </span>
  );
}

function stopDeckInputPropagation(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

function getApiHealthLabel(status: ApiHealthStatus): string {
  switch (status) {
    case "healthy":
      return i18n.t("deck.diagnosticsStatusHealthy");
    case "degraded":
      return i18n.t("deck.diagnosticsStatusDegraded");
    default:
      return i18n.t("deck.diagnosticsStatusError");
  }
}

function openMattermostThread(teamName: string, target: OpenThreadTarget, channelName?: string | null): void {
  const isReply = Boolean(target.rootId?.trim());
  const nextPath = !isReply && channelName
    ? `/${teamName}/channels/${channelName}/${target.postId}`
    : `/${teamName}/pl/${target.postId}`;
  debugLog("app.open-thread", {
    currentPath: window.location.pathname,
    nextPath,
    postId: target.postId,
    rootId: target.rootId ?? null,
  });
  if (window.location.pathname === nextPath) {
    window.dispatchEvent(new PopStateEvent("popstate"));
    void focusMattermostPost(target.postId, 5000, target.rootId);
    return;
  }

  debugLog("app.open-thread.push-state", { nextPath });
  window.history.pushState({}, "", nextPath);
  window.dispatchEvent(new PopStateEvent("popstate"));
  void focusMattermostPost(target.postId, 5000, target.rootId);
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

function FocusIcon({ active }: { active: boolean }): React.JSX.Element {
  return active ? (
    <svg className="deck-focus-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.8 4V1.8H4" />
      <path d="M8 1.8h2.2V4" />
      <path d="M10.2 8V10.2H8" />
      <path d="M4 10.2H1.8V8" />
      <path d="M4.2 4.2L7.8 7.8" />
      <path d="M7.8 4.2L4.2 7.8" />
    </svg>
  ) : (
    <svg className="deck-focus-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4.5 1.8H1.8V4.5" />
      <path d="M7.5 1.8h2.7V4.5" />
      <path d="M10.2 7.5v2.7H7.5" />
      <path d="M4.5 10.2H1.8V7.5" />
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

function StatusModeIcon({ realtimeEnabled }: { realtimeEnabled: boolean }): React.JSX.Element {
  return realtimeEnabled ? (
    <svg className="deck-status-mode-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.8 5.6a6.2 6.2 0 0 1 8.4 0" />
      <path d="M3.5 7.4a3.8 3.8 0 0 1 5 0" />
      <path d="M5.1 9a1.8 1.8 0 0 1 1.8 0" />
      <circle cx="6" cy="10.1" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  ) : (
    <svg className="deck-status-mode-icon" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.2" />
      <path d="M6 3.5v2.8l1.8 1" />
    </svg>
  );
}

function HealthStatusIcon({ status }: { status: ApiHealthStatus }): React.JSX.Element {
  if (status === "healthy") {
    return (
      <svg className="deck-health-status-icon deck-health-status-icon--healthy" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.5" />
        <path d="M3.9 6.1l1.4 1.4 2.8-3" />
      </svg>
    );
  }

  if (status === "degraded") {
    return (
      <svg className="deck-health-status-icon deck-health-status-icon--degraded" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.5" />
        <path d="M6 3.2v3.1" />
        <circle cx="6" cy="8.9" r="0.55" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg className="deck-health-status-icon deck-health-status-icon--error" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4.1 4.1l3.8 3.8" />
      <path d="M7.9 4.1L4.1 7.9" />
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

function ViewsIcon(): React.JSX.Element {
  return (
    <svg className="deck-views-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.2" y="2.2" width="4.2" height="4.2" rx="1" />
      <rect x="9.6" y="2.2" width="4.2" height="4.2" rx="1" />
      <rect x="2.2" y="9.6" width="4.2" height="4.2" rx="1" />
      <rect x="9.6" y="9.6" width="4.2" height="4.2" rx="1" />
    </svg>
  );
}

function getColumnGlyph(type: DeckColumnType): string {
  switch (type) {
    case "mentions":
      return "mentions";
    case "channelWatch":
      return "channel";
    case "dmWatch":
      return "dm";
    case "keywordWatch":
    case "search":
      return "search";
    case "saved":
      return "saved";
    case "diagnostics":
      return "diagnostics";
  }
}

function formatMetricNumber(value: number): string {
  if (value >= 1000) {
    return value.toLocaleString();
  }
  if (value % 1 === 0) {
    return String(value);
  }
  return value.toFixed(1);
}

function formatLatency(value: number): string {
  return `${Math.round(value)} ms`;
}

function formatMemoryValue(value: number | null): string {
  if (value == null) {
    return "n/a";
  }
  return `${value.toFixed(1)} MB`;
}

function formatMemoryUsage(value: number | null): string {
  if (value == null) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Sparkline({
  values,
  ariaLabel,
  formatValue = (v) => v.toFixed(1),
}: {
  values: number[];
  ariaLabel: string;
  formatValue?: (v: number) => string;
}): React.JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 160;
  const height = 36;
  const safeValues = values.length > 0 ? values : [0];
  const maxValue = Math.max(...safeValues, 1);

  const coords = safeValues.map((value, index) => {
    const x = safeValues.length === 1 ? width / 2 : (index / (safeValues.length - 1)) * width;
    const y = height - (value / maxValue) * (height - 4) - 2;
    return { x, y, value };
  });

  const points = coords.map(({ x, y }) => `${x},${y}`).join(" ");

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = ((event.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let nearestDist = Infinity;
    coords.forEach(({ x }, i) => {
      const dist = Math.abs(x - mouseX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };

  const hovered = hoverIndex !== null ? coords[hoverIndex] : null;

  return (
    <svg
      className="deck-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIndex(null)}
    >
      <polyline className="deck-sparkline-line" points={points} />
      {hovered ? (
        <>
          <line className="deck-sparkline-hover-line" x1={hovered.x} y1={0} x2={hovered.x} y2={height} />
          <circle className="deck-sparkline-hover-dot" cx={hovered.x} cy={hovered.y} r={3} />
          <text
            className="deck-sparkline-hover-label"
            x={Math.min(Math.max(hovered.x, 18), width - 18)}
            y={Math.max(hovered.y - 6, 9)}
            textAnchor="middle"
          >
            {formatValue(hovered.value)}
          </text>
        </>
      ) : null}
    </svg>
  );
}

function ColumnTypeIcon({ type }: { type: DeckColumnType }): React.JSX.Element {
  switch (type) {
    case "mentions":
      return (
        <span className="deck-type-glyph" aria-hidden="true">
          @
        </span>
      );
    case "channelWatch":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.1 2.5L3.9 13.5" />
          <path d="M10.5 2.5L9.3 13.5" />
          <path d="M2.3 6.1H12.9" />
          <path d="M1.7 9.9H12.3" />
        </svg>
      );
    case "dmWatch":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="6" cy="5.2" r="2.1" />
          <path d="M2.9 11.9C3.4 9.9 5 8.8 6 8.8s2.6 1.1 3.1 3.1" />
          <circle cx="11.2" cy="6.3" r="1.5" />
          <path d="M9.5 11.4C9.8 10.2 10.8 9.4 11.5 9.4c.7 0 1.7.8 2 2" />
        </svg>
      );
    case "keywordWatch":
    case "search":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.2" />
          <path d="M10.2 10.2L13.4 13.4" />
        </svg>
      );
    case "saved":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 2.7h8a1 1 0 0 1 1 1v9.6l-5-2.6-5 2.6V3.7a1 1 0 0 1 1-1Z" />
        </svg>
      );
    case "diagnostics":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.7 11.8h10.6" />
          <path d="M4.2 10.3V7.8" />
          <path d="M7.1 10.3V5.7" />
          <path d="M10 10.3V3.8" />
          <path d="M12.9 10.3V6.6" />
        </svg>
      );
  }
}

function ColumnViewTarget({ type, title, subtitle }: { type: DeckColumnType; title: string; subtitle?: string }): React.JSX.Element {
  return (
    <span className="deck-view-target">
      <span className={`deck-view-target-glyph deck-view-target-glyph--${getColumnGlyph(type)}`}>
        <ColumnTypeIcon type={type} />
      </span>
      <span className="deck-view-target-copy">
        <span>{title}</span>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
    </span>
  );
}

function ColumnTypeBadge({ type }: { type: DeckColumnType }): React.JSX.Element {
  return (
    <span className={`deck-title-type-glyph deck-title-type-glyph--${getColumnGlyph(type)}`}>
      <ColumnTypeIcon type={type} />
    </span>
  );
}

function ColumnMenuLabel({ type, label }: { type: DeckColumnType; label: string }): React.JSX.Element {
  return (
    <span className="deck-menu-label">
      <ColumnTypeBadge type={type} />
      <span>{label}</span>
    </span>
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

function PauseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" stroke="none" />
      <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PlayIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="5,3 13,8 5,13" fill="currentColor" stroke="none" />
    </svg>
  );
}

function JumpToLatestIcon({ reversed = false }: { reversed?: boolean }): React.JSX.Element {
  return (
    <svg className={`deck-jump-latest-icon${reversed ? " deck-jump-latest-icon--reversed" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.5v9" />
      <path d="M4.8 6.7 8 3.5l3.2 3.2" />
    </svg>
  );
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
  ["--deck-accent-text"]?: string;
  ["--deck-button-bg"]?: string;
  ["--deck-button-text"]?: string;
  ["--deck-badge-bg"]?: string;
  ["--deck-badge-text"]?: string;
  ["--deck-highlight-bg"]?: string;
  ["--deck-highlight-text"]?: string;
  ["--deck-success"]?: string;
  ["--deck-warn"]?: string;
  ["--deck-danger"]?: string;
};

function toDeckDebugStyleRecord(style: MattermostThemeStyle | null | undefined): Record<string, string> | null {
  if (!style) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(style).filter(
      ([key, value]) => key.startsWith("--deck-") && typeof value === "string" && value.length > 0,
    ),
  );
}

const MATTERMOST_THEME_CACHE_KEY = "mattermostDeck.themeCache.v1";

function getMattermostThemeCacheStorageKey(): string {
  return `${MATTERMOST_THEME_CACHE_KEY}:${window.location.origin}`;
}
function serialiseMattermostThemeStyle(style: MattermostThemeStyle | undefined): string {
  return JSON.stringify(style ?? {});
}

function loadCachedMattermostThemeStyle(): MattermostThemeStyle | undefined {
  try {
    const raw = window.localStorage.getItem(getMattermostThemeCacheStorageKey());
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("--deck-") && typeof value === "string" && value.length > 0) {
        next[key] = value;
      }
    }
    return Object.keys(next).length > 0 ? (next as MattermostThemeStyle) : undefined;
  } catch {
    return undefined;
  }
}

function saveCachedMattermostThemeStyle(style: MattermostThemeStyle): void {
  try {
    const next = serialiseMattermostThemeStyle(style);
    if (window.localStorage.getItem(getMattermostThemeCacheStorageKey()) === next) {
      return;
    }
    window.localStorage.setItem(getMattermostThemeCacheStorageKey(), next);
  } catch {
    return;
  }
}

function queryFirst(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

function readElementTextColor(selectors: string[]): string | undefined {
  const element = queryFirst(selectors);
  if (!element) {
    return undefined;
  }
  const color = window.getComputedStyle(element).color.trim();
  return color.length > 0 ? color : undefined;
}

function readElementBackgroundColor(selectors: string[]): string | undefined {
  const element = queryFirst(selectors);
  if (!element) {
    return undefined;
  }
  const backgroundColor = window.getComputedStyle(element).backgroundColor.trim();
  if (!backgroundColor || backgroundColor === "rgba(0, 0, 0, 0)" || backgroundColor === "transparent") {
    return undefined;
  }
  return backgroundColor;
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

function parseCssColor(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  const rgbMatch = trimmed.match(/\d+(?:\.\d+)?/g);
  if (rgbMatch && rgbMatch.length >= 3) {
    return [Number(rgbMatch[0]), Number(rgbMatch[1]), Number(rgbMatch[2])];
  }

  const hex = trimmed.replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }

  return null;
}

function relativeLuminance(color: string): number {
  const rgb = parseCssColor(color);
  if (!rgb) {
    return 0;
  }

  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(left: string, right: string): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function pickBestAccent(background: string, candidates: Array<string | undefined>, fallback: string): string {
  const usable = candidates.filter((candidate): candidate is string => {
    if (!candidate || !candidate.trim()) return false;
    // Reject transparent colors because parseCssColor ignores alpha.
    // would produce a spuriously high contrast ratio (21) and beat every real accent color.
    const alphaMatch = candidate.match(/rgba\([^)]+,\s*([\d.]+)\s*\)/i);
    if (alphaMatch && parseFloat(alphaMatch[1]) < 0.05) return false;
    return true;
  });
  if (usable.length === 0) {
    return fallback;
  }

  return usable
    .map((candidate) => ({ candidate, score: contrastRatio(candidate, background) }))
    .sort((left, right) => right.score - left.score)[0]?.candidate ?? fallback;
}

function pickReadableForeground(background: string, candidates: Array<string | undefined>, fallback: string): string {
  return pickBestAccent(background, candidates, fallback);
}

function colorMixFallback(primary: string, secondary: string, ratio = 0.32): string {
  const left = parseCssColor(primary);
  const right = parseCssColor(secondary);
  if (!left || !right) {
    return primary;
  }

  const mix = (a: number, b: number) => Math.round(a * ratio + b * (1 - ratio));
  return `rgb(${mix(left[0], right[0])}, ${mix(left[1], right[1])}, ${mix(left[2], right[2])})`;
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

function readCssVar(style: CSSStyleDeclaration, name: string): string | undefined {
  const value = style.getPropertyValue(name).trim();
  return value.length > 0 ? value : undefined;
}

function readMattermostThemeValue(
  rootStyle: CSSStyleDeclaration,
  names: readonly string[],
  fallback?: string,
): string {
  for (const name of names) {
    const value = readCssVar(rootStyle, name);
    if (value) {
      return value;
    }
  }
  return fallback ?? "";
}

function extractMattermostThemeStyle(): MattermostThemeStyle {
  const rootElement = document.documentElement;
  const sidebar = queryFirst(["#SidebarContainer", ".SidebarContainer", ".sidebar-left-container"]);
  const sidebarTeamButton = queryFirst(["#sidebarTeamMenuButton"]);
  const appBody = queryFirst([".app__body", ".app__body-center-channel", ".app__content"]);
  const channelHeader = queryFirst([".channel-header", ".channel-header--info", ".center-channel__header"]);
  const postArea = queryFirst([".post-list", ".center-channel", ".app__content"]);
  const button = queryFirst(["button.btn.btn-primary", ".btn.btn-primary", "button[color='primary']"]);
  const link = queryFirst(["a", ".link", ".style--none"]);

  const rootStyle = getComputedStyle(rootElement);
  const sidebarStyle = sidebar ? getComputedStyle(sidebar) : rootStyle;
  const sidebarTeamButtonStyle = sidebarTeamButton ? getComputedStyle(sidebarTeamButton) : sidebarStyle;
  const appBodyStyle = appBody ? getComputedStyle(appBody) : rootStyle;
  const channelHeaderStyle = channelHeader ? getComputedStyle(channelHeader) : rootStyle;
  const postAreaStyle = postArea ? getComputedStyle(postArea) : rootStyle;
  const buttonStyle = button ? getComputedStyle(button) : rootStyle;
  const linkStyle = link ? getComputedStyle(link) : rootStyle;

  const sidebarBg = readMattermostThemeValue(
    rootStyle,
    ["--sidebar-bg", "--sidebar-header-bg", "--sidebar-bg-rgb"],
    sidebarStyle.backgroundColor || "rgb(20, 93, 191)",
  );
  const sidebarHeaderBg = readMattermostThemeValue(
    rootStyle,
    ["--sidebar-header-bg", "--sidebar-bg"],
    channelHeaderStyle.backgroundColor || sidebarBg,
  );
  // CSS variable is preferred over computed element color.
  // In Mattermost 9.5, the sidebar container's computed `color` reflects the
  // inherited center-channel text (dark grey), not the sidebar text (white).
  // Reading --sidebar-text first avoids picking up the wrong fallback color.
  const sidebarText =
    readMattermostThemeValue(rootStyle, ["--sidebar-text", "--sidebar-header-text-color"]) ||
    sidebarTeamButtonStyle.color ||
    sidebarStyle.color ||
    "rgb(255, 255, 255)";
  const sidebarTextSoft =
    readMattermostThemeValue(rootStyle, ["--sidebar-text-80", "--sidebar-header-text-color-80"]) ||
    (sidebarTeamButtonStyle.color ? rgbaFromRgb(sidebarTeamButtonStyle.color, 0.8) : undefined) ||
    rgbaFromRgb(sidebarText, 0.8);
  // --sidebar-teambar-bg is the Global Header background (added in later 9.x).
  // Prefer it over --sidebar-header-bg so the deck topbar matches the
  // Mattermost Global Header rather than the sidebar channel-list header.
  const shellBg = readMattermostThemeValue(
    rootStyle,
    ["--sidebar-teambar-bg", "--sidebar-header-bg", "--sidebar-bg"],
    appBodyStyle.backgroundColor || sidebarHeaderBg,
  );
  const shellBgSoft = readMattermostThemeValue(
    rootStyle,
    ["--sidebar-text-08", "--center-channel-bg-08"],
    lightenRgb(shellBg, 0.03),
  );
  const centerBg = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-bg", "--center-channel-bg-88"],
    postAreaStyle.backgroundColor || "rgb(255, 255, 255)",
  );
  const centerText = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color", "--center-channel-text", "--center-channel-color-88"],
    postAreaStyle.color || "rgb(61, 60, 64)",
  );
  const centerTextSoft = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color-72", "--center-channel-color-64"],
    rgbaFromRgb(centerText, 0.72),
  );
  const centerTextFaint = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color-56", "--center-channel-color-48"],
    rgbaFromRgb(centerText, 0.58),
  );
  const border = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color-16", "--center-channel-color-24"],
    rgbaFromRgb(centerText, 0.12),
  );
  const borderStrong = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color-24", "--center-channel-color-32"],
    rgbaFromRgb(centerText, 0.18),
  );
  const accent = pickBestAccent(
    centerBg,
    [
      readMattermostThemeValue(rootStyle, ["--button-bg"]),
      readMattermostThemeValue(rootStyle, ["--link-color"]),
      readMattermostThemeValue(rootStyle, ["--sidebar-text-active-border"]),
      readMattermostThemeValue(rootStyle, ["--mention-highlight-link"]),
      buttonStyle.backgroundColor,
      linkStyle.color,
    ],
    buttonStyle.backgroundColor || linkStyle.color || "rgb(22, 109, 224)",
  );
  const accentSoft = rgbaFromRgb(accent, 0.14);
  const accentText = pickReadableForeground(
    accent,
    [
      readMattermostThemeValue(rootStyle, ["--button-color"]),
      centerText,
      "rgb(255, 255, 255)",
      "rgb(27, 29, 34)",
    ],
    "rgb(255, 255, 255)",
  );
  const buttonBg = readMattermostThemeValue(rootStyle, ["--button-bg"], accent);
  const buttonText = readMattermostThemeValue(
    rootStyle,
    ["--button-color"],
    pickReadableForeground(buttonBg, ["rgb(255, 255, 255)", centerText], "rgb(255, 255, 255)"),
  );
  const badgeBg = readMattermostThemeValue(rootStyle, ["--mention-bg"], accent);
  const badgeText = readMattermostThemeValue(
    rootStyle,
    ["--mention-color"],
    pickReadableForeground(badgeBg, [centerText, "rgb(255, 255, 255)", "rgb(27, 29, 34)"], centerText),
  );
  const highlightBg = readElementBackgroundColor([
    ".post-message__text .mention--highlight",
    ".post__content .mention--highlight",
    ".mention--highlight",
  ]) ?? readMattermostThemeValue(
    rootStyle,
    ["--mention-highlight-bg"],
    colorMixFallback(accent, "#ffe082"),
  );
  const highlightText = readElementTextColor([
    ".post-message__text .mention--highlight .mention-link",
    ".post__content .mention--highlight .mention-link",
    ".mention--highlight .mention-link",
    ".post-message__text .mention--highlight",
    ".post__content .mention--highlight",
    ".mention--highlight",
  ]) ?? readMattermostThemeValue(
    rootStyle,
    ["--mention-highlight-link", "--mention-color"],
    pickReadableForeground(
      highlightBg,
      [centerText, "rgb(27, 29, 34)", "rgb(255, 255, 255)"],
      "rgb(27, 29, 34)",
    ),
  );
  const warn = readMattermostThemeValue(rootStyle, ["--away-indicator"], "rgb(255, 188, 66)");
  const success = readMattermostThemeValue(rootStyle, ["--online-indicator"], "rgb(6, 214, 160)");
  const danger = readMattermostThemeValue(rootStyle, ["--error-text", "--error-text-color"], "rgb(247, 67, 67)");

  return {
    "--deck-bg": shellBg,
    "--deck-bg-elevated": shellBg,
    "--deck-bg-soft": shellBgSoft,
    "--deck-panel": centerBg,
    "--deck-panel-2": centerBg,
    "--deck-card": colorMixFallback(centerText, centerBg, 0.04),
    "--deck-card-soft": centerBg,
    "--deck-border": border,
    "--deck-border-strong": borderStrong,
    "--deck-text": centerText,
    "--deck-text-soft": centerTextSoft,
    "--deck-text-faint": centerTextFaint,
    "--deck-topbar-text": sidebarText,
    "--deck-topbar-text-soft": sidebarTextSoft,
    "--deck-accent": accent,
    "--deck-accent-strong": darkenRgb(accent, 0.08),
    "--deck-accent-soft": accentSoft,
    "--deck-accent-text": accentText,
    "--deck-button-bg": buttonBg,
    "--deck-button-text": buttonText,
    "--deck-badge-bg": badgeBg,
    "--deck-badge-text": badgeText,
    "--deck-highlight-bg": highlightBg,
    "--deck-highlight-text": highlightText,
    "--deck-success": success,
    "--deck-warn": warn,
    "--deck-danger": danger,
  };
}

function useMattermostThemeStyle(theme: DeckTheme): {
  initialSource: "cache" | "extract" | "none";
  style: MattermostThemeStyle | undefined;
} {
  const initialSourceRef = useRef<"cache" | "extract" | "none">("none");
  const [style, setStyle] = useState<MattermostThemeStyle | undefined>(() => {
    if (theme !== "mattermost") {
      initialSourceRef.current = "none";
      return undefined;
    }

    const cached = loadCachedMattermostThemeStyle();
    if (cached) {
      initialSourceRef.current = "cache";
      return cached;
    }

    initialSourceRef.current = "extract";
    return extractMattermostThemeStyle();
  });
  const serialisedStyleRef = useRef(serialiseMattermostThemeStyle(style));

  useEffect(() => {
    serialisedStyleRef.current = serialiseMattermostThemeStyle(style);
  }, [style]);

  useEffect(() => {
    if (theme !== "mattermost" || !style) {
      return;
    }
    saveCachedMattermostThemeStyle(style);
  }, [style, theme]);

  useEffect(() => {
    if (theme !== "mattermost") {
      initialSourceRef.current = "none";
      serialisedStyleRef.current = serialiseMattermostThemeStyle(undefined);
      setStyle(undefined);
      return;
    }

    let frameId: number | null = null;

    const apply = () => {
      frameId = null;
      const next = extractMattermostThemeStyle();
      const serialisedNext = serialiseMattermostThemeStyle(next);
      if (serialisedNext === serialisedStyleRef.current) {
        return;
      }

      serialisedStyleRef.current = serialisedNext;
      setStyle(next);
      saveCachedMattermostThemeStyle(next);
    };

    const scheduleApply = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(apply);
    };

    apply();
    const themeAttributeTargets = [
      document.documentElement,
      document.body,
      document.getElementById("root"),
      document.getElementById("app"),
    ].filter((target): target is HTMLElement => target instanceof HTMLElement);
    const observer = new MutationObserver((mutations) => {
      const themeSourceChanged = mutations.some((mutation) => {
        if (mutation.type === "attributes") {
          return (
            themeAttributeTargets.includes(mutation.target as HTMLElement) ||
            mutation.target instanceof HTMLStyleElement ||
            (
              mutation.target instanceof HTMLLinkElement &&
              mutation.target.rel === "stylesheet"
            )
          );
        }

        if (
          mutation.target instanceof HTMLStyleElement ||
          mutation.target.parentElement instanceof HTMLStyleElement
        ) {
          return true;
        }

        return [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) =>
            node instanceof HTMLStyleElement ||
            (
              node instanceof HTMLLinkElement &&
              node.rel === "stylesheet"
            ) ||
            (
              node instanceof Element &&
              Boolean(node.querySelector("style, link[rel='stylesheet']"))
            ),
        );
      });
      if (themeSourceChanged) {
        scheduleApply();
      }
    });
    observer.observe(document.documentElement, {
      subtree: false,
      childList: false,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    if (document.head) {
      observer.observe(document.head, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["href", "media", "disabled"],
      });
    }
    observer.observe(document.body, {
      subtree: false,
      childList: false,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    for (const target of themeAttributeTargets) {
      if (target === document.documentElement || target === document.body) {
        continue;
      }
      observer.observe(target, {
        subtree: false,
        childList: false,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [theme]);

  return {
    initialSource: initialSourceRef.current,
    style,
  };
}

function getSyncInterval(
  realtimeEnabled: boolean,
  pollingIntervalSeconds: number,
  paneVisible = true,
): number {
  if (document.hidden) {
    return Math.max(FALLBACK_SYNC_INTERVAL_HIDDEN_MS, pollingIntervalSeconds * 4_000);
  }

  if (!paneVisible) {
    return Math.max(FALLBACK_SYNC_INTERVAL_HIDDEN_MS, pollingIntervalSeconds * 2_000);
  }

  return realtimeEnabled ? FALLBACK_SYNC_INTERVAL_WS_MS : pollingIntervalSeconds * 1_000;
}

function isLikelyDirectChannelRouteName(channelName: string | null): boolean {
  if (!channelName) {
    return false;
  }

  return channelName.startsWith("@") || channelName.includes("__");
}

function parseDmChannelUserIds(channel: MattermostChannel): string[] {
  if (channel.type !== "D") {
    return [];
  }
  const parts = channel.name.split("__");
  return parts.length === 2 ? parts.filter(Boolean) : [];
}

interface LoadedAppState {
  data: Omit<AppState, "status" | "error">;
  routeIdentity: string;
}

async function loadAppState(): Promise<LoadedAppState> {
  const baseUser = await getCurrentUser();

  const [teams, unreads, mentionGroups, preferences, clientConfig] = await Promise.all([
    getTeamsForCurrentUser(),
    getTeamUnread(baseUser.id),
    getMentionGroupsForUser(baseUser.id).catch(() => []),
    getUserPreferences(baseUser.id).catch(() => []),
    getMattermostClientConfig().catch(() => ({ CollapsedThreads: undefined })),
  ]);
  const collapsedThreadsPreference = preferences.find(
    (preference) =>
      preference.category === "display_settings" &&
      preference.name === "collapsed_reply_threads",
  )?.value;
  const user: MattermostUser = {
    ...baseUser,
    mention_group_names: mentionGroups
      .map((group) => group.name?.trim())
      .filter((name): name is string => Boolean(name)),
    collapsed_reply_threads: isCollapsedThreadsEnabled(
      clientConfig.CollapsedThreads,
      collapsedThreadsPreference,
    ),
  };

  const route = readDeckCurrentRoute();
  const routeContext = await loadCurrentRouteContext(teams, route);

  return {
    data: {
      userId: user.id,
      username: user.username,
      currentUser: user,
      teams,
      unreads,
      ...routeContext,
      sessionExpired: false,
    },
    routeIdentity: getRouteIdentity(route),
  };
}

function getRouteIdentity(route: CurrentRoute): string {
  return `${route.teamName ?? ""}\n${route.channelName ?? ""}`;
}

function getCurrentRouteIdentity(): string {
  return getRouteIdentity(readDeckCurrentRoute());
}

async function loadCurrentRouteContext(
  teams: MattermostTeam[],
  route = readDeckCurrentRoute(),
): Promise<CurrentRouteContext> {
  const routeTeam = route.teamName
    ? teams.find((team) => team.name === route.teamName) ?? null
    : null;
  const routeChannel =
    routeTeam && route.channelName && !isLikelyDirectChannelRouteName(route.channelName)
      ? await getChannelByName(routeTeam.id, route.channelName).catch((error: unknown) => {
          if (getMattermostApiErrorStatus(error) === 404) {
            return null;
          }
          throw error;
        })
      : null;

  return {
    currentTeamId: routeTeam?.id,
    currentChannelId: routeChannel?.id,
    currentTeamLabel: routeTeam?.display_name ?? routeTeam?.name ?? route.teamName,
    currentChannelLabel: routeChannel?.display_name ?? routeChannel?.name ?? route.channelName,
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
    currentUser: null,
    teams: [],
    unreads: [],
    currentTeamId: undefined,
    currentChannelId: undefined,
    currentTeamLabel: null,
    currentChannelLabel: null,
    error: null,
    sessionExpired: false,
  });
  const routeIdentityRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (state.sessionExpired) {
      return;
    }

    let cancelled = false;

    const run = async (showLoading: boolean) => {
      debugLog("app.deck-state.run", {
        showLoading,
        refreshNonce,
        realtimeEnabled,
        pollingIntervalSeconds,
        path: window.location.pathname,
      });
      if (showLoading) {
        setState((current) => ({
          ...current,
          status: current.status === "ready" ? "ready" : "loading",
          error: null,
        }));
      }

      try {
        const loaded = await loadAppState();
        if (!cancelled) {
          const routeChangedWhileLoading =
            loaded.routeIdentity !== getCurrentRouteIdentity();
          debugLog("app.deck-state.ready", {
            currentTeamId: loaded.data.currentTeamId ?? null,
            currentChannelId: loaded.data.currentChannelId ?? null,
            routeContextPreserved: routeChangedWhileLoading,
            path: window.location.pathname,
          });
          setState((current) => ({
            status: "ready",
            error: null,
            ...loaded.data,
            ...(routeChangedWhileLoading
              ? {
                  currentTeamId: current.currentTeamId,
                  currentChannelId: current.currentChannelId,
                  currentTeamLabel: current.currentTeamLabel,
                  currentChannelLabel: current.currentChannelLabel,
                }
              : {}),
          }));
          if (!routeChangedWhileLoading) {
            routeIdentityRef.current = loaded.routeIdentity;
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message = getLocalizedApiErrorMessage(error, i18n.t("deck.failedToLoad"));
          const sessionExpired = isMattermostSessionExpiredError(error);
          debugLog("app.deck-state.error", {
            message,
            path: window.location.pathname,
          });
          setState((current) => sessionExpired
            ? {
                ...current,
                status: "error",
                userId: null,
                username: null,
                currentUser: null,
                teams: [],
                unreads: [],
                currentTeamId: undefined,
                currentChannelId: undefined,
                currentTeamLabel: null,
                currentChannelLabel: null,
                error: message,
                sessionExpired: true,
              }
            : {
                ...current,
                status: "error",
                error: message,
                sessionExpired: false,
              });
        }
      }
    };

    let timer: number | null = null;
    let running = false;
    const schedule = () => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(() => {
        void execute(false);
      }, getSyncInterval(realtimeEnabled, pollingIntervalSeconds));
    };
    const execute = async (showLoading: boolean) => {
      if (cancelled || running) {
        return;
      }
      running = true;
      try {
        await run(showLoading);
      } finally {
        running = false;
        schedule();
      }
    };

    void execute(true);
    const handleVisibility = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (!running) {
        schedule();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pollingIntervalSeconds, realtimeEnabled, refreshNonce, state.sessionExpired]);

  const teamsSignature = state.teams
    .map((team) => `${team.id}:${team.name}`)
    .sort()
    .join(",");

  useEffect(() => {
    if (state.sessionExpired) {
      return;
    }

    if (state.teams.length === 0 && state.status === "loading") {
      return;
    }

    const nextRouteIdentity = getCurrentRouteIdentity();
    if (nextRouteIdentity === routeIdentityRef.current) {
      debugLog("app.deck-state.route-context-skip", {
        routeKey,
        reason: "same-team-and-channel",
        path: window.location.pathname,
      });
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    const run = async (attempt = 0) => {
      debugLog("app.deck-state.route-context", {
        routeKey,
        path: window.location.pathname,
      });

      try {
        const data = await loadCurrentRouteContext(stateRef.current.teams);
        if (cancelled) {
          return;
        }
        if (nextRouteIdentity !== getCurrentRouteIdentity()) {
          return;
        }
        setState((current) => ({
          ...current,
          ...data,
        }));
        routeIdentityRef.current = nextRouteIdentity;
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isMattermostSessionExpiredError(error)) {
          const message = getLocalizedApiErrorMessage(error, i18n.t("deck.failedToLoad"));
          setState((current) => ({
            ...current,
            status: "error",
            error: message,
            sessionExpired: true,
          }));
        } else if (
          attempt < 2 &&
          nextRouteIdentity === getCurrentRouteIdentity()
        ) {
          const retryDelayMs = 1_000 * (2 ** attempt);
          debugLog("app.deck-state.route-context-retry", {
            routeKey,
            attempt: attempt + 1,
            retryDelayMs,
            path: window.location.pathname,
          });
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void run(attempt + 1);
          }, retryDelayMs);
        }
        debugLog("app.deck-state.route-context-error", {
          routeKey,
          message: error instanceof Error ? error.message : String(error),
          path: window.location.pathname,
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [routeKey, state.sessionExpired, state.status, teamsSignature]);

  return state;
}

function useCurrentRouteKey(initialRouteKey: string): string {
  const [routeKey, setRouteKey] = useState(initialRouteKey);

  useEffect(() => {
    const handleRouteChange = (event: Event) => {
      const detail = (event as CustomEvent<{ routeKey?: string }>).detail;
      if (detail?.routeKey) {
        setRouteKey(detail.routeKey);
      }
    };

    window.addEventListener(ROUTE_EVENT, handleRouteChange as EventListener);
    return () => {
      window.removeEventListener(ROUTE_EVENT, handleRouteChange as EventListener);
    };
  }, []);

  return routeKey;
}

async function loadMentionsLastReadAt(): Promise<number | null> {
  const profile = await loadCurrentDeckProfile();
  return await loadStoredNumber(getProfileStorageKey(profile.id, MENTIONS_LAST_READ_AT_STORAGE_KEY));
}

async function saveMentionsLastReadAt(value: number | null): Promise<void> {
  const profile = await loadCurrentDeckProfile();
  const storageKey = getProfileStorageKey(profile.id, MENTIONS_LAST_READ_AT_STORAGE_KEY);
  await saveStoredNumber(storageKey, value ?? 0);
}

function useMentionsLastReadAt(): [number | null, (value: number | null) => void] {
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadVersion = 0;
    const load = () => {
      const version = ++loadVersion;
      void loadMentionsLastReadAt().then((value) => {
        if (!cancelled && version === loadVersion) {
          setLastReadAt(value && value > 0 ? value : null);
        }
      }).catch(() => undefined);
    };

    load();
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      if (
        PROFILES_STORAGE_KEY in changes ||
        Object.keys(changes).some((key) => key.startsWith(`${MENTIONS_LAST_READ_AT_STORAGE_KEY}.profile.`))
      ) {
        load();
      }
    };
    chrome.storage?.onChanged?.addListener(handleStorageChange);
    return () => {
      cancelled = true;
      chrome.storage?.onChanged?.removeListener(handleStorageChange);
    };
  }, []);

  const updateLastReadAt = useCallback((value: number | null) => {
    setLastReadAt(value && value > 0 ? value : null);
    void saveMentionsLastReadAt(value && value > 0 ? value : null);
  }, []);

  return [lastReadAt, updateLastReadAt];
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

function useSyncLogs(): SyncLogEntry[] {
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);

  useEffect(() => {
    const pushEntry = (entry: SyncLogEntry) => {
      setLogs((current) => [entry, ...current].slice(0, 20));
    };
    const handleWsLog = (event: Event) => {
      pushEntry((event as CustomEvent<SyncLogEntry>).detail);
    };
    const handleApiLog = (event: Event) => {
      pushEntry((event as CustomEvent<SyncLogEntry>).detail);
    };

    window.addEventListener("mattermost-deck-ws-log", handleWsLog as EventListener);
    window.addEventListener("mattermost-deck-api-log", handleApiLog as EventListener);
    return () => {
      window.removeEventListener("mattermost-deck-ws-log", handleWsLog as EventListener);
      window.removeEventListener("mattermost-deck-api-log", handleApiLog as EventListener);
    };
  }, []);

  return logs;
}

function summariseSyncLogMessage(message: string): string {
  if (/^WS reconnect scheduled in \d+ms$/.test(message)) {
    return "WS reconnect scheduled";
  }
  if (/^WS closed code=/.test(message)) {
    return message.replace(/ reason=.*/, "");
  }
  if (/^[A-Za-z ].+ \| (GET|POST) \d+ \d+ms /.test(message)) {
    const match = message.match(/^(.+?) \| (GET|POST) (\d+) (\d+)ms /);
    if (match) {
      const [, purpose, method, status, duration] = match;
      return `${purpose} ${method} ${status} ${duration}ms`;
    }
  }
  if (/^[A-Za-z ].+ \| (GET|POST) failed \d+ms /.test(message)) {
    const match = message.match(/^(.+?) \| (GET|POST) failed (\d+)ms /);
    if (match) {
      const [, purpose, method, duration] = match;
      return `${purpose} ${method} failed ${duration}ms`;
    }
  }
  if (/^(GET|POST) rate-limit \d+ms$/.test(message)) {
    return message.replace(/ \d+ms$/, " wait");
  }
  return message;
}

function buildDiagnosticsLogEntries(logs: SyncLogEntry[], limit = 5): DiagnosticsLogEntry[] {
  const entries: DiagnosticsLogEntry[] = [];

  for (const entry of logs) {
    const summary = summariseSyncLogMessage(entry.message);
    const previous = entries[entries.length - 1];
    if (previous && previous.level === entry.level && previous.summary === summary) {
      previous.count += 1;
      previous.timestamp = Math.max(previous.timestamp, entry.timestamp);
      continue;
    }
    entries.push({ ...entry, summary, count: 1 });
    if (entries.length >= limit) {
      break;
    }
  }

  return entries;
}

function useDeckLayout(): [
  DeckColumn[] | null,
  (type: DeckColumnType, defaults?: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>) => string,
  (id: string) => void,
  (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>) => void,
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
      defaults: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">> = {},
    ): string => {
      const nextColumn = createColumn(type, defaults);
      persistFromCurrent((current) => [...current, nextColumn]);
      return nextColumn.id;
    },
    [persistFromCurrent],
  );

  const removeColumn = useCallback((id: string): void => {
    persistFromCurrent((current) => {
      const nextColumns = current.filter((column) => column.id !== id);
      return nextColumns.length > 0 ? nextColumns : [createColumn("mentions")];
    });
  }, [persistFromCurrent]);

  const updateColumn = useCallback((id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>): void => {
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
        const filtered = Array.isArray(stored)
          ? stored.filter(
              (entry) =>
                Boolean(entry) &&
                (entry.type === "channelWatch" || entry.type === "dmWatch") &&
                typeof entry.teamId === "string" &&
                typeof entry.teamLabel === "string" &&
                typeof entry.channelId === "string" &&
                typeof entry.channelLabel === "string",
            )
          : [];
        const deduped = dedupeRecentTargets(filtered);
        setTargets(deduped);
        if (filtered.length !== deduped.length) {
          void saveStoredJson(RECENT_TARGETS_STORAGE_KEY, deduped);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const remember = useCallback((target: RecentChannelTarget) => {
    setTargets((current) => {
      const next = dedupeRecentTargets([
        target,
        ...current,
      ]);
      void saveStoredJson(RECENT_TARGETS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  return [targets, remember];
}

function isSavedView(value: unknown): value is SavedDeckView {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SavedDeckView>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && Array.isArray(candidate.columns);
}

function useSavedViews(): [
  SavedDeckView[],
  (name: string, columns: DeckColumn[]) => void,
  (id: string) => void,
  (id: string) => SavedDeckView | undefined,
] {
  const [views, setViews] = useState<SavedDeckView[]>([]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredJson<SavedDeckView[]>(SAVED_VIEWS_STORAGE_KEY, []);
      if (!cancelled) {
        setViews(Array.isArray(stored) ? stored.filter(isSavedView).slice(0, MAX_SAVED_VIEWS) : []);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveView = useCallback((name: string, columns: DeckColumn[]) => {
    const normalized = name.trim();
    if (!normalized) {
      return;
    }

    setViews((current) => {
      const existing = current.find((entry) => entry.name.toLowerCase() === normalized.toLowerCase());
      const nextEntry: SavedDeckView = existing
        ? { ...existing, columns }
        : { id: crypto.randomUUID(), name: normalized, columns };
      const next = [nextEntry, ...current.filter((entry) => entry.id !== nextEntry.id)].slice(0, MAX_SAVED_VIEWS);
      void saveStoredJson(SAVED_VIEWS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const removeView = useCallback((id: string) => {
    setViews((current) => {
      const next = current.filter((entry) => entry.id !== id);
      void saveStoredJson(SAVED_VIEWS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const getView = useCallback((id: string) => views.find((entry) => entry.id === id), [views]);

  return [views, saveView, removeView, getView];
}

function clampRailWidth(nextWidth: number): number {
  return Math.min(Math.max(nextWidth, MIN_RAIL_WIDTH), MAX_RAIL_WIDTH);
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
  autoAdjustThreadLayout: boolean;
  preferredColumnWidth: number;
  healthCheckPath: string;
  compactMode: boolean;
  columnColorEnabled: boolean;
  postClickAction: PostClickAction;
  highlightKeywords: string;
  columnColors: ColumnColorSettings;
  showImagePreviews: boolean;
  reversedPostOrder: boolean;
} {
  const [settings, setSettings] = useState<{
    loaded: boolean;
    wsPat: string;
    theme: DeckTheme;
    language: DeckLanguage;
    pollingIntervalSeconds: number;
    fontScalePercent: number;
    preferredRailWidth: number;
    autoAdjustThreadLayout: boolean;
    preferredColumnWidth: number;
    healthCheckPath: string;
    compactMode: boolean;
    columnColorEnabled: boolean;
    postClickAction: PostClickAction;
    highlightKeywords: string;
    columnColors: ColumnColorSettings;
    showImagePreviews: boolean;
    reversedPostOrder: boolean;
  }>({
    loaded: false,
    wsPat: "",
    theme: "mattermost",
    language: "ja",
    pollingIntervalSeconds: 45,
    fontScalePercent: DEFAULT_SETTINGS.fontScalePercent,
    preferredRailWidth: DEFAULT_SETTINGS.preferredRailWidth,
    autoAdjustThreadLayout: DEFAULT_SETTINGS.autoAdjustThreadLayout,
    preferredColumnWidth: DEFAULT_SETTINGS.preferredColumnWidth,
    healthCheckPath: DEFAULT_SETTINGS.healthCheckPath,
    compactMode: DEFAULT_SETTINGS.compactMode,
    columnColorEnabled: DEFAULT_SETTINGS.columnColorEnabled,
    postClickAction: DEFAULT_SETTINGS.postClickAction,
    highlightKeywords: DEFAULT_SETTINGS.highlightKeywords,
    columnColors: DEFAULT_COLUMN_COLORS,
    showImagePreviews: DEFAULT_SETTINGS.showImagePreviews,
    reversedPostOrder: DEFAULT_SETTINGS.reversedPostOrder,
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

const MATTERMOST_RHS_SELECTOR = [
  "#sidebar-right",
  ".rhs-root[role='complementary']",
].join(", ");
const MATTERMOST_CENTER_TARGET_SELECTORS = [
  ".app__content",
  "#channel_view",
  ".product-wrapper",
] as const;

function getHorizontalIntersectionWidth(left: DOMRect, right: DOMRect): number {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
}

interface RenderedHostElement {
  element: HTMLElement;
  rect: DOMRect;
}

function readRenderedHostElement(element: HTMLElement): RenderedHostElement | null {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  if (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 1 &&
    rect.height > 1
  ) {
    return { element, rect };
  }
  return null;
}

function findLargestRenderedHostElement(
  candidates: readonly HTMLElement[],
): RenderedHostElement | null {
  let largest: RenderedHostElement | null = null;
  for (const candidate of candidates) {
    const rendered = readRenderedHostElement(candidate);
    if (rendered && (!largest || rendered.rect.width > largest.rect.width)) {
      largest = rendered;
    }
  }
  return largest;
}

function findMattermostRightSidebars(root: HTMLElement): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  for (const candidate of root.querySelectorAll<HTMLElement>(MATTERMOST_RHS_SELECTOR)) {
    if (!candidate.classList.contains("sidebar--right--width-holder")) {
      candidates.push(candidate);
      if (candidates.length >= MAX_MATTERMOST_RHS_TARGETS) {
        break;
      }
    }
  }
  return candidates;
}

function findMattermostCenterTargets(root: HTMLElement): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  for (const selector of MATTERMOST_CENTER_TARGET_SELECTORS) {
    const candidate = root.querySelector<HTMLElement>(selector);
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

let hostLayoutMeasurementCount = 0;

function readMattermostHostLayout(): MattermostHostLayout {
  if (__MATTERMOST_DECK_E2E_DEBUG__) {
    hostLayoutMeasurementCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      hostLayoutMeasurementCount + 1,
    );
  }
  const mattermostRoot = document.querySelector<HTMLElement>("#root");
  if (!mattermostRoot) {
    return {
      mattermostWidth: 0,
      centerWidth: 0,
      rightSidebarWidth: 0,
      rightSidebarOpen: false,
      rootReportsRightSidebarOpen: false,
    };
  }

  const mattermostRect = mattermostRoot.getBoundingClientRect();
  const rootReportsRhsOpen = mattermostRoot.classList.contains("rhs-open");
  let rightSidebarWidth = 0;
  let rightSidebarOpen = rootReportsRhsOpen;

  for (const rightSidebar of findMattermostRightSidebars(mattermostRoot)) {
    const renderedRightSidebar = readRenderedHostElement(rightSidebar);
    if (!renderedRightSidebar) {
      continue;
    }
    const { element: candidate, rect } = renderedRightSidebar;
    const explicitlyOpen =
      rootReportsRhsOpen ||
      candidate.matches(".is-open, .move--left, [data-expanded='true']");
    rightSidebarOpen ||= explicitlyOpen;
    const intersectionWidth = getHorizontalIntersectionWidth(rect, mattermostRect);
    if (
      explicitlyOpen &&
      (
        rootReportsRhsOpen ||
        intersectionWidth >= 1
      )
    ) {
      rightSidebarWidth = Math.max(
        rightSidebarWidth,
        // The RHS enters with a horizontal transform in Mattermost. Its box
        // width is already final while only part of it intersects #root.
        // Intersection width is therefore useful for visibility, but using it
        // as the sizing input makes Deck chase the opening animation.
        Math.min(rect.width, mattermostRect.width),
      );
    }
  }

  const renderedCenter = findLargestRenderedHostElement(
    findMattermostCenterTargets(mattermostRoot),
  );

  return {
    mattermostWidth: Math.max(0, Math.round(mattermostRect.width)),
    centerWidth: Math.max(0, Math.round(renderedCenter?.rect.width ?? 0)),
    rightSidebarWidth: Math.max(0, Math.round(rightSidebarWidth)),
    rightSidebarOpen,
    rootReportsRightSidebarOpen: rootReportsRhsOpen,
  };
}

const EMPTY_MATTERMOST_HOST_LAYOUT: MattermostHostLayout = {
  mattermostWidth: 0,
  centerWidth: 0,
  rightSidebarWidth: 0,
  rightSidebarOpen: false,
  rootReportsRightSidebarOpen: false,
};

function hostLayoutsAreEquivalent(
  current: MattermostHostLayout,
  next: MattermostHostLayout,
): boolean {
  const currentRhsOpen = current.rightSidebarOpen ?? current.rightSidebarWidth > 0;
  const nextRhsOpen = next.rightSidebarOpen ?? next.rightSidebarWidth > 0;
  if (currentRhsOpen !== nextRhsOpen) {
    return false;
  }
  if (!currentRhsOpen) {
    // Mattermost navigation and channel changes may resize its internal
    // content. None of those measurements affect Deck while the RHS is closed.
    return true;
  }
  // Automatic width is derived only from the RHS natural box. Center and
  // chrome measurements remain diagnostic values and must never feed layout
  // reflow back into Deck sizing.
  return Math.abs(current.rightSidebarWidth - next.rightSidebarWidth) <=
    HOST_LAYOUT_JITTER_TOLERANCE_PX;
}

function useMattermostHostLayout(enabled: boolean): MattermostHostLayout {
  const stableBaseChromeWidthRef = useRef<number | null>(null);
  const stableRightSidebarWidthRef = useRef<number | null>(null);
  const rootRhsStateSeenRef = useRef(false);
  const stabiliseMeasurement = (
    raw: MattermostHostLayout,
    settled: boolean,
  ): MattermostHostLayout => {
    if (raw.rootReportsRightSidebarOpen === true) {
      rootRhsStateSeenRef.current = true;
    }
    const rightSidebarOpen = rootRhsStateSeenRef.current
      ? raw.rootReportsRightSidebarOpen === true
      : raw.rightSidebarOpen ?? raw.rightSidebarWidth > 0;
    const naturalRightSidebarWidth = rightSidebarOpen
      ? raw.rightSidebarWidth
      : 0;
    if (!rightSidebarOpen) {
      if (
        settled &&
        raw.mattermostWidth > 0 &&
        raw.centerWidth > 0
      ) {
        stableBaseChromeWidthRef.current = Math.max(
          0,
          raw.mattermostWidth - raw.centerWidth,
        );
      }
      if (settled) {
        stableRightSidebarWidthRef.current = null;
      }
    } else {
      if (
        naturalRightSidebarWidth > 0 &&
        (
          stableRightSidebarWidthRef.current === null ||
          settled
        )
      ) {
        stableRightSidebarWidthRef.current = naturalRightSidebarWidth;
      }
      if (
        settled &&
        naturalRightSidebarWidth > 0 &&
        raw.mattermostWidth > 0 &&
        raw.centerWidth > 0
      ) {
        // A viewport breakpoint can change both Mattermost chrome and its RHS
        // width while the pane remains open. Promote those values only after
        // the existing settled window; normal opening still uses the closed
        // baseline immediately and therefore never chases transitional boxes.
        stableRightSidebarWidthRef.current = naturalRightSidebarWidth;
        stableBaseChromeWidthRef.current = Math.max(
          0,
          raw.mattermostWidth -
            raw.centerWidth -
            naturalRightSidebarWidth,
        );
      }
    }

    return {
      ...raw,
      rightSidebarWidth: rightSidebarOpen
        ? stableRightSidebarWidthRef.current ?? naturalRightSidebarWidth
        : 0,
      baseChromeWidth: stableBaseChromeWidthRef.current ?? undefined,
      rightSidebarOpen,
    };
  };
  const [layout, setLayout] = useState<MattermostHostLayout>(() => {
    if (!enabled) {
      return EMPTY_MATTERMOST_HOST_LAYOUT;
    }
    const initial = readMattermostHostLayout();
    const initiallyOpen = initial.rightSidebarOpen ?? initial.rightSidebarWidth > 0;
    return stabiliseMeasurement(initial, !initiallyOpen);
  });

  useEffect(() => {
    if (!enabled) {
      stableBaseChromeWidthRef.current = null;
      stableRightSidebarWidthRef.current = null;
      setLayout((current) => (
        current.mattermostWidth === 0 &&
        current.centerWidth === 0 &&
        current.rightSidebarWidth === 0
          ? current
          : EMPTY_MATTERMOST_HOST_LAYOUT
      ));
      return;
    }

    let frame: number | null = null;
    let settleTimer: number | null = null;
    let frameIncludesSettledMeasurement = false;
    let observationTargetsDirty = true;
    let observedRootRhsOpen = (
      document.querySelector<HTMLElement>("#root")
        ?.classList.contains("rhs-open") ?? false
    );
    const observedResizeTargets = new Set<HTMLElement>();

    const commitMeasurement = () => {
      frame = null;
      if (observationTargetsDirty) {
        observationTargetsDirty = false;
        syncObservationTargets();
      }
      const settled = frameIncludesSettledMeasurement;
      frameIncludesSettledMeasurement = false;
      const next = stabiliseMeasurement(
        readMattermostHostLayout(),
        settled,
      );
      setLayout((current) => (
        hostLayoutsAreEquivalent(current, next)
          ? current
          : next
      ));
    };

    const requestMeasurement = (settled = false) => {
      frameIncludesSettledMeasurement ||= settled;
      if (frame === null) {
        frame = window.requestAnimationFrame(commitMeasurement);
      }
    };

    const commitRootStateMeasurement = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      frameIncludesSettledMeasurement = false;
      const next = stabiliseMeasurement(
        readMattermostHostLayout(),
        false,
      );
      // The RHS starts its transform as soon as #root.rhs-open changes.
      // Commit Deck's matching target before that mutation is painted so
      // Mattermost does not visibly cover the center first and resize later.
      flushSync(() => {
        setLayout((current) => (
          hostLayoutsAreEquivalent(current, next)
            ? current
            : next
        ));
      });
    };

    const scheduleSettledMeasurement = () => {
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        requestMeasurement(true);
      }, HOST_LAYOUT_SETTLE_MS);
    };

    const scheduleMeasurement = () => {
      requestMeasurement();
      scheduleSettledMeasurement();
    };

    const resizeObserver = new ResizeObserver(scheduleSettledMeasurement);
    const attributeObserver = new MutationObserver((records) => {
      const rootClassChanged = records.some((record) => (
        record.attributeName === "class" &&
        record.target instanceof HTMLElement &&
        record.target.id === "root"
      ));
      const nextRootRhsOpen = rootClassChanged
        ? (
            document.querySelector<HTMLElement>("#root")
              ?.classList.contains("rhs-open") ?? false
          )
        : observedRootRhsOpen;
      const rootRhsStateChanged = (
        rootClassChanged &&
        nextRootRhsOpen !== observedRootRhsOpen
      );
      observedRootRhsOpen = nextRootRhsOpen;
      if (rootRhsStateChanged) {
        commitRootStateMeasurement();
        scheduleSettledMeasurement();
        return;
      }
      scheduleMeasurement();
    });
    const structureObserver = new MutationObserver(() => {
      observationTargetsDirty = true;
      scheduleMeasurement();
    });

    const syncObservationTargets = () => {
      const mattermostRoot = document.querySelector<HTMLElement>("#root");
      const rightSidebars = mattermostRoot
        ? findMattermostRightSidebars(mattermostRoot)
        : [];
      observedRootRhsOpen =
        mattermostRoot?.classList.contains("rhs-open") ?? false;
      const nextResizeTargets = new Set<HTMLElement>();
      if (mattermostRoot) {
        nextResizeTargets.add(mattermostRoot);
      }
      for (const rightSidebar of rightSidebars) {
        nextResizeTargets.add(rightSidebar);
      }

      for (const target of observedResizeTargets) {
        if (!nextResizeTargets.has(target)) {
          resizeObserver.unobserve(target);
          observedResizeTargets.delete(target);
        }
      }
      for (const target of nextResizeTargets) {
        if (!observedResizeTargets.has(target)) {
          resizeObserver.observe(target);
          observedResizeTargets.add(target);
        }
      }

      attributeObserver.disconnect();
      const options: MutationObserverInit = {
        attributes: true,
        attributeFilter: ["class", "aria-hidden", "data-expanded"],
      };
      if (mattermostRoot) {
        attributeObserver.observe(mattermostRoot, options);
      }
      for (const rightSidebar of rightSidebars) {
        attributeObserver.observe(rightSidebar, options);
      }

      // Watch only direct child lists along the layout boundary paths.
      // The RHS itself is deliberately excluded, so loading search results or
      // thread posts cannot create observer work or retained target sets.
      const structureTargets = new Set<HTMLElement>();
      if (document.body) {
        structureTargets.add(document.body);
      }
      const addAncestorPath = (target: HTMLElement | null) => {
        let ancestor = target?.parentElement ?? null;
        while (ancestor) {
          structureTargets.add(ancestor);
          if (ancestor === document.body) {
            break;
          }
          ancestor = ancestor.parentElement;
        }
      };
      addAncestorPath(mattermostRoot);
      for (const rightSidebar of rightSidebars) {
        addAncestorPath(rightSidebar);
      }
      structureObserver.disconnect();
      for (const target of structureTargets) {
        structureObserver.observe(target, { childList: true });
      }
    };

    syncObservationTargets();
    observationTargetsDirty = false;
    scheduleMeasurement();
    window.addEventListener("resize", scheduleMeasurement);

    return () => {
      window.removeEventListener("resize", scheduleMeasurement);
      structureObserver.disconnect();
      attributeObserver.disconnect();
      resizeObserver.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
    };
  }, [enabled]);

  return layout;
}

function useRailWidth(
  drawerOpen: boolean,
  preferredRailWidth: number,
  hostLayout: MattermostHostLayout,
  suppressThreadAdjustment: boolean,
): [
  number,
  (nextWidth: number) => void,
  (nextWidth?: number) => void,
  ResponsiveRailMode,
  number,
  number,
] {
  const normalizedPreferredRailWidth = clampRailWidth(normalisePreferredRailWidth(preferredRailWidth));
  const [requestedRailWidth, setRequestedRailWidth] = useState<number>(normalizedPreferredRailWidth);
  const [hasManualOverride, setHasManualOverride] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [viewportResizeOverride, setViewportResizeOverride] = useState<{
    width: number;
    mode: ResponsiveRailMode;
  } | null>(null);
  const requestedRailWidthRef = useRef(normalizedPreferredRailWidth);
  const preferredRailWidthRef = useRef(normalizedPreferredRailWidth);
  const hasManualOverrideRef = useRef(false);
  const viewportResizeTimerRef = useRef<number | null>(null);
  const rightPaneLayoutSyncFrameRef = useRef<number | null>(null);
  const previousThreadLayoutTargetRef = useRef<{
    width: number;
    mode: ResponsiveRailMode;
  }>({
    width: Number.NaN,
    mode: "normal",
  });
  const minimumMattermostWidth = hasManualOverride
    ? MIN_MANUAL_MATTERMOST_WIDTH
    : MIN_MATTERMOST_WIDTH;
  const threadLayout = useMemo(
    () => calculateThreadAwareRailLayout(
      requestedRailWidth,
      viewportWidth,
      hostLayout,
      minimumMattermostWidth,
    ),
    [
      hostLayout.rightSidebarWidth,
      minimumMattermostWidth,
      requestedRailWidth,
      viewportWidth,
    ],
  );
  const calculatedRailWidth = suppressThreadAdjustment
    ? calculateResponsiveRailWidth(
        requestedRailWidth,
        viewportWidth,
        minimumMattermostWidth,
      )
    : threadLayout.width;
  const calculatedThreadLayoutMode = suppressThreadAdjustment
    ? "normal"
    : threadLayout.mode;
  const railWidth = viewportResizeOverride?.width ?? calculatedRailWidth;
  const threadLayoutMode =
    viewportResizeOverride?.mode ?? calculatedThreadLayoutMode;
  const interactiveMaximumRailWidth = calculateResponsiveRailWidth(
    MAX_RAIL_WIDTH,
    viewportWidth,
    MIN_MANUAL_MATTERMOST_WIDTH,
  );
  const resizeInputsRef = useRef({
    drawerOpen,
    hostLayout,
    minimumMattermostWidth,
    railWidth,
    requestedRailWidth,
    suppressThreadAdjustment,
    threadLayoutMode,
  });
  resizeInputsRef.current = {
    drawerOpen,
    hostLayout,
    minimumMattermostWidth,
    railWidth,
    requestedRailWidth,
    suppressThreadAdjustment,
    threadLayoutMode,
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredNumber(RAIL_WIDTH_STORAGE_KEY);
      if (cancelled || hasManualOverrideRef.current) {
        return;
      }

      if (stored !== null) {
        hasManualOverrideRef.current = true;
        setHasManualOverride(true);
        const normalizedStoredWidth = clampRailWidth(stored);
        requestedRailWidthRef.current = normalizedStoredWidth;
        setRequestedRailWidth(normalizedStoredWidth);
      } else {
        setHasManualOverride(false);
        requestedRailWidthRef.current = preferredRailWidthRef.current;
        setRequestedRailWidth(preferredRailWidthRef.current);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    preferredRailWidthRef.current = normalizedPreferredRailWidth;
    if (!hasManualOverrideRef.current) {
      requestedRailWidthRef.current = normalizedPreferredRailWidth;
      setRequestedRailWidth(normalizedPreferredRailWidth);
    }
  }, [normalizedPreferredRailWidth]);

  useLayoutEffect(() => {
    const previousTarget = previousThreadLayoutTargetRef.current;
    const targetChanged = (
      previousTarget.width !== railWidth ||
      previousTarget.mode !== threadLayoutMode
    );
    const isAutomaticRightPaneTransition = (
      targetChanged &&
      (
        previousTarget.mode !== "normal" ||
        threadLayoutMode !== "normal"
      )
    );
    if (isAutomaticRightPaneTransition) {
      // Mattermost starts moving the native RHS in this frame. Disable our
      // width animation for the matching geometry transfer so the main
      // content is never temporarily covered while Deck yields that space.
      document.body.classList.add(RIGHT_PANE_LAYOUT_SYNC_CLASS);
    }

    document.documentElement.style.setProperty("--mattermost-deck-rail-width", `${railWidth}px`);
    document.documentElement.style.setProperty(
      "--mattermost-deck-offset-width",
      drawerOpen ? `${railWidth}px` : `${COLLAPSED_DRAWER_WIDTH}px`,
    );
    previousThreadLayoutTargetRef.current = {
      width: railWidth,
      mode: threadLayoutMode,
    };

    if (isAutomaticRightPaneTransition) {
      if (rightPaneLayoutSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(rightPaneLayoutSyncFrameRef.current);
      }
      rightPaneLayoutSyncFrameRef.current = window.requestAnimationFrame(() => {
        rightPaneLayoutSyncFrameRef.current = window.requestAnimationFrame(() => {
          rightPaneLayoutSyncFrameRef.current = null;
          document.body.classList.remove(RIGHT_PANE_LAYOUT_SYNC_CLASS);
        });
      });
    }
  }, [drawerOpen, railWidth, threadLayoutMode]);

  useEffect(() => () => {
    if (rightPaneLayoutSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(rightPaneLayoutSyncFrameRef.current);
      rightPaneLayoutSyncFrameRef.current = null;
    }
    document.body.classList.remove(RIGHT_PANE_LAYOUT_SYNC_CLASS);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const nextViewportWidth = window.innerWidth;
      const resizeInputs = resizeInputsRef.current;
      const syncOpenRightPane = (
        !resizeInputs.suppressThreadAdjustment &&
        resizeInputs.hostLayout.rightSidebarWidth > 0
      );
      document.body.classList.add(VIEWPORT_RESIZING_CLASS);
      document.body.classList.toggle(
        RIGHT_PANE_VIEWPORT_SYNC_CLASS,
        syncOpenRightPane,
      );

      // Mattermost animates its RHS width across responsive breakpoints.
      // RIGHT_PANE_VIEWPORT_SYNC_CLASS temporarily removes that transition;
      // this forced read therefore returns the final breakpoint width now,
      // allowing Deck and Mattermost to move to one shared final geometry.
      const liveHostLayout = syncOpenRightPane
        ? readMattermostHostLayout()
        : resizeInputs.hostLayout;
      const nextThreadLayout = calculateThreadAwareRailLayout(
        resizeInputs.requestedRailWidth,
        nextViewportWidth,
        liveHostLayout,
        resizeInputs.minimumMattermostWidth,
      );
      const nextRailWidth = resizeInputs.suppressThreadAdjustment
        ? calculateResponsiveRailWidth(
            resizeInputs.requestedRailWidth,
            nextViewportWidth,
            resizeInputs.minimumMattermostWidth,
          )
        : nextThreadLayout.width;
      const nextThreadLayoutMode = resizeInputs.suppressThreadAdjustment
        ? "normal"
        : nextThreadLayout.mode;
      setViewportResizeOverride(
        syncOpenRightPane
          ? {
              width: nextRailWidth,
              mode: nextThreadLayoutMode,
            }
          : null,
      );
      document.documentElement.style.setProperty(
        "--mattermost-deck-rail-width",
        `${nextRailWidth}px`,
      );
      document.documentElement.style.setProperty(
        "--mattermost-deck-offset-width",
        resizeInputs.drawerOpen
          ? `${nextRailWidth}px`
          : `${COLLAPSED_DRAWER_WIDTH}px`,
      );
      setViewportWidth(nextViewportWidth);

      if (viewportResizeTimerRef.current !== null) {
        window.clearTimeout(viewportResizeTimerRef.current);
      }
      viewportResizeTimerRef.current = window.setTimeout(() => {
        viewportResizeTimerRef.current = null;
        flushSync(() => {
          setViewportResizeOverride(null);
        });
        window.requestAnimationFrame(() => {
          document.body.classList.remove(
            VIEWPORT_RESIZING_CLASS,
            RIGHT_PANE_VIEWPORT_SYNC_CLASS,
          );
        });
      }, syncOpenRightPane
        ? HOST_LAYOUT_SETTLE_MS + VIEWPORT_RESIZE_SETTLE_MS
        : VIEWPORT_RESIZE_SETTLE_MS);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (viewportResizeTimerRef.current !== null) {
        window.clearTimeout(viewportResizeTimerRef.current);
        viewportResizeTimerRef.current = null;
      }
      document.body.classList.remove(
        VIEWPORT_RESIZING_CLASS,
        RIGHT_PANE_VIEWPORT_SYNC_CLASS,
      );
    };
  }, []);

  const clampInteractiveRailWidth = useCallback((nextWidth: number) => {
    const normalizedWidth = clampRailWidth(nextWidth);
    const maximumWidth = calculateResponsiveRailWidth(
      MAX_RAIL_WIDTH,
      window.innerWidth,
      MIN_MANUAL_MATTERMOST_WIDTH,
    );
    return maximumWidth < MIN_RAIL_WIDTH
      ? MIN_RAIL_WIDTH
      : Math.min(normalizedWidth, maximumWidth);
  }, []);

  const updateRailWidth = useCallback((nextWidth: number) => {
    const normalizedWidth = clampInteractiveRailWidth(nextWidth);
    hasManualOverrideRef.current = true;
    setHasManualOverride(true);
    // A pointer drag is more recent than a pending viewport-settle snapshot.
    // Release that temporary target immediately so the Deck follows the
    // pointer instead of appearing capped until the settle timer expires.
    setViewportResizeOverride(null);
    requestedRailWidthRef.current = normalizedWidth;
    setRequestedRailWidth(normalizedWidth);
  }, [clampInteractiveRailWidth]);

  const persistRailWidth = useCallback((nextWidth?: number) => {
    const normalizedWidth = nextWidth === undefined
      ? requestedRailWidthRef.current
      : clampInteractiveRailWidth(nextWidth);
    hasManualOverrideRef.current = true;
    setHasManualOverride(true);
    requestedRailWidthRef.current = normalizedWidth;
    setRequestedRailWidth(normalizedWidth);
    void saveStoredNumber(RAIL_WIDTH_STORAGE_KEY, normalizedWidth);
  }, [clampInteractiveRailWidth]);

  return [
    railWidth,
    updateRailWidth,
    persistRailWidth,
    threadLayoutMode,
    requestedRailWidth,
    interactiveMaximumRailWidth,
  ];
}

function TeamSelect({
  teams,
  teamId,
  onChange,
  language = "ja",
}: {
  teams: MattermostTeam[];
  teamId?: string;
  onChange: (teamId: string) => void;
  language?: DeckLanguage;
}): React.JSX.Element {
  const t = useAppText();
  const options = teams.map((team) => ({
    value: team.id,
    label: team.display_name || team.name,
  })) satisfies CustomSelectOption[];

  return (
    <label className="deck-field">
      <span>{t.teamLabel}</span>
      <CustomSelect
        options={options}
        value={teamId ?? ""}
        placeholder={t.selectTeam}
        onChange={onChange}
      />
    </label>
  );
}

const SAVED_SEARCHES_KEY = "mattermostDeck.savedSearches.v1";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// File-type SVG icons
function IconFileGeneric(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
function IconFileText(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9" x2="11" y2="9" />
    </svg>
  );
}
function IconFilePdf(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 13h2a1.5 1.5 0 0 1 0 3H8v-3z" />
      <path d="M14 13h1.5a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H14v-3z" />
    </svg>
  );
}
function IconFileArchive(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="10" y1="2" x2="10" y2="8" />
      <line x1="10" y1="12" x2="10" y2="12.01" />
      <line x1="10" y1="16" x2="10" y2="16.01" />
      <rect x="8.5" y="10" width="3" height="8" rx="1" />
    </svg>
  );
}
function IconFileSpreadsheet(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <rect x="7" y="12" width="10" height="7" rx="0.5" />
      <line x1="7" y1="15.5" x2="17" y2="15.5" />
      <line x1="12" y1="12" x2="12" y2="19" />
    </svg>
  );
}
function IconFileVideo(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <polygon points="9,12 9,18 16,15" />
    </svg>
  );
}
function IconFileAudio(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <circle cx="9.5" cy="17.5" r="1.5" />
      <path d="M11 17.5V12l5-1v4.5" />
    </svg>
  );
}
function IconFileCode(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <polyline points="9,13 7,15 9,17" />
      <polyline points="15,13 17,15 15,17" />
    </svg>
  );
}

function FileTypeIcon({ mimeType, extension }: { mimeType: string; extension: string }): React.JSX.Element {
  const ext = extension.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("video/")) return <IconFileVideo />;
  if (mime.startsWith("audio/")) return <IconFileAudio />;
  if (mime === "application/pdf" || ext === "pdf") return <IconFilePdf />;
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("tar") || mime.includes("7z") ||
      ext === "zip" || ext === "rar" || ext === "gz" || ext === "tar" || ext === "7z") return <IconFileArchive />;
  if (mime.includes("spreadsheet") || mime.includes("excel") || ext === "xls" || ext === "xlsx" || ext === "csv") return <IconFileSpreadsheet />;
  if (mime.includes("word") || mime.includes("wordprocessing") || ext === "doc" || ext === "docx" || ext === "odt") return <IconFileText />;
  if (mime.includes("powerpoint") || mime.includes("presentation") || ext === "ppt" || ext === "pptx" || ext === "odp") return <IconFileGeneric />;
  if (mime.startsWith("text/") || ext === "txt" || ext === "md" || ext === "log") return <IconFileText />;
  if (["js", "ts", "jsx", "tsx", "py", "java", "go", "rb", "php", "css", "html", "json", "xml", "sh", "yaml", "yml"].includes(ext)) return <IconFileCode />;
  return <IconFileGeneric />;
}

// Lightbox SVG icons (Feather-style, stroke-based)
function IconExternalLink(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3.5" />
      <path d="M11 3h6v6" />
      <line x1="17" y1="3" x2="10" y2="10" />
    </svg>
  );
}
function IconDownload(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="10" y1="3" x2="10" y2="13" />
      <polyline points="6,9 10,13 14,9" />
      <line x1="4" y1="16" x2="16" y2="16" />
    </svg>
  );
}
function IconClose(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="4" x2="16" y2="16" />
      <line x1="16" y1="4" x2="4" y2="16" />
    </svg>
  );
}
function IconZoomOut(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" />
      <line x1="17" y1="17" x2="13" y2="13" />
      <line x1="6" y1="8.5" x2="11" y2="8.5" />
    </svg>
  );
}
function IconZoomIn(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" />
      <line x1="17" y1="17" x2="13" y2="13" />
      <line x1="8.5" y1="6" x2="8.5" y2="11" />
      <line x1="6" y1="8.5" x2="11" y2="8.5" />
    </svg>
  );
}
function IconFitScreen(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3,8 3,3 8,3" />
      <polyline points="17,8 17,3 12,3" />
      <polyline points="3,12 3,17 8,17" />
      <polyline points="17,12 17,17 12,17" />
    </svg>
  );
}
function IconMaximize(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3,8 3,3 8,3" />
      <polyline points="17,8 17,3 12,3" />
      <polyline points="3,12 3,17 8,17" />
      <polyline points="17,12 17,17 12,17" />
      <line x1="3" y1="3" x2="7.5" y2="7.5" />
      <line x1="17" y1="3" x2="12.5" y2="7.5" />
      <line x1="3" y1="17" x2="7.5" y2="12.5" />
      <line x1="17" y1="17" x2="12.5" y2="12.5" />
    </svg>
  );
}

const ZOOM_STEP = 1.3;
const MAX_SCALE = 16;
const MIN_SCALE = 0.02;

function ImageLightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }): React.JSX.Element | null {
  const text = useAppText();
  const shadowRoot = useContext(ShadowRootContext);
  const [scale, setScale] = useState<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const fitScaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const hasDragged = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => { posRef.current = pos; }, [pos]);

  useEffect(() => {
    const previousFocus =
      shadowRoot?.activeElement instanceof HTMLElement
        ? shadowRoot.activeElement
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    previouslyFocusedRef.current = previousFocus;
    const focusFrame = window.requestAnimationFrame(() => {
      const firstControl = dialogRef.current?.querySelector<HTMLElement>(
        "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      );
      firstControl?.focus();
    });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => element.offsetParent !== null);
      if (controls.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const current = shadowRoot?.activeElement ?? document.activeElement;
      const currentIndex = controls.indexOf(current as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex === controls.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      controls[nextIndex]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey, true);
      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [onClose, shadowRoot]);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min((s ?? fitScaleRef.current) * ZOOM_STEP, MAX_SCALE));
  }, []);
  const zoomOut = useCallback(() => {
    setScale((s) => Math.max((s ?? fitScaleRef.current) / ZOOM_STEP, MIN_SCALE));
  }, []);
  const fitScreen = useCallback(() => { setScale(fitScaleRef.current); setPos({ x: 0, y: 0 }); }, []);
  const fillScreen = useCallback(() => {
    if (!naturalSize || !stageRef.current) return;
    const { width: sw, height: sh } = stageRef.current.getBoundingClientRect();
    setScale(Math.max(sw / naturalSize.w, sh / naturalSize.h));
    setPos({ x: 0, y: 0 });
  }, [naturalSize]);
  // Track drag with window-level mousemove/mouseup handlers.
  const onStageMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    hasDragged.current = false;
    dragRef.current = { mx: e.clientX, my: e.clientY, px: posRef.current.x, py: posRef.current.y };
    setGrabbing(true);

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.mx;
      const dy = ev.clientY - dragRef.current.my;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true;
      setPos({ x: dragRef.current.px + dx, y: dragRef.current.py + dy });
    };
    const onUp = () => {
      dragRef.current = null;
      setGrabbing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const onStageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasDragged.current && e.target === e.currentTarget) onClose();
  };

  // Click the image to zoom in when it was not dragged.
  const onImgClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasDragged.current) zoomIn();
  };

  // Recompute fit scale once the image finishes loading.
  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const natW = Math.max(img.naturalWidth, 1);
    const natH = Math.max(img.naturalHeight, 1);
    setNaturalSize({ w: natW, h: natH });
    if (stageRef.current) {
      const { width: sw, height: sh } = stageRef.current.getBoundingClientRect();
      const fs = Math.min(sw / natW, sh / natH, 1);
      fitScaleRef.current = fs;
      setScale(fs);
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = src;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!shadowRoot) return null;

  const currentScale = scale ?? 0.001;
  const scaleLabel = `${Math.round(currentScale * 100)}%`;

  return createPortal(
    <div
      ref={dialogRef}
      className="deck-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      tabIndex={-1}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 24;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setPos((current) => ({ ...current, x: current.x - step }));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          setPos((current) => ({ ...current, x: current.x + step }));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setPos((current) => ({ ...current, y: current.y - step }));
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setPos((current) => ({ ...current, y: current.y + step }));
        } else if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          zoomIn();
        } else if (event.key === "-") {
          event.preventDefault();
          zoomOut();
        } else if (event.key === "0") {
          event.preventDefault();
          fitScreen();
        }
      }}
    >
      {/* Toolbar */}
      <div className="deck-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="deck-lightbox-btn"
          title={text.openInNewTab}
          aria-label={text.openInNewTab}
          onClick={(e) => {
            e.stopPropagation();
            void chrome.runtime.sendMessage({ type: "mattermost-deck:open-tab", url: src });
          }}
        >
          <IconExternalLink />
        </button>
        <button type="button" className="deck-lightbox-btn" title={text.downloadImage} aria-label={text.downloadImage} onClick={handleDownload}>
          <IconDownload />
        </button>
        <button type="button" className="deck-lightbox-btn deck-lightbox-btn--close" title={text.close} aria-label={text.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>

      {/* Image stage */}
      <div
        ref={stageRef}
        className={`deck-lightbox-stage${grabbing ? " deck-lightbox-stage--grabbing" : ""}`}
        onMouseDown={onStageMouseDown}
        onClick={onStageClick}
      >
        <img
          className="deck-lightbox-img"
          src={src}
          alt={name}
          draggable={false}
          onLoad={onImgLoad}
          onClick={onImgClick}
          style={{
            opacity: scale !== null ? 1 : 0,
            transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(${currentScale})`,
          }}
        />
      </div>

      {/* Bottom controls */}
      <div className="deck-lightbox-controls" onClick={(e) => e.stopPropagation()}>
        <span className="deck-lightbox-filename" title={name}>{name}</span>
        <div className="deck-lightbox-zoom-group">
          <button type="button" className="deck-lightbox-ctrl" title={text.zoomOut} aria-label={text.zoomOut} onClick={zoomOut}><IconZoomOut /></button>
          <button type="button" className="deck-lightbox-ctrl deck-lightbox-ctrl--scale" title={text.fitToScreen} aria-label={`${text.fitToScreen} (${scaleLabel})`} onClick={fitScreen}>
            {scaleLabel}
          </button>
          <button type="button" className="deck-lightbox-ctrl" title={text.zoomIn} aria-label={text.zoomIn} onClick={zoomIn}><IconZoomIn /></button>
          <button type="button" className="deck-lightbox-ctrl" title={text.fillScreen} aria-label={text.fillScreen} onClick={fillScreen}><IconMaximize /></button>
        </div>
      </div>
    </div>,
    shadowRoot,
  );
}

function ImageThumb({
  info,
  placeholder,
  previewSrc,
  fullSrc,
  onOpen,
  viewport,
}: {
  info: MattermostFileInfo;
  placeholder: string | null;
  previewSrc: string;
  fullSrc: string;
  onOpen: () => void;
  viewport: HTMLDivElement | null;
}): React.JSX.Element {
  const [src, setSrc] = useState<string>(placeholder ?? previewSrc);
  const [node, setNode] = useState<HTMLButtonElement | null>(null);
  const isVisible = useElementVisibility(node, { root: viewport, rootMargin: "240px 0px", defaultVisible: true });

  useEffect(() => {
    setSrc(placeholder ?? previewSrc);
  }, [placeholder, previewSrc]);

  useEffect(() => {
    if (!placeholder || !isVisible) return;
    const img = new Image();
    img.onload = () => setSrc(previewSrc);
    img.onerror = () => setSrc(fullSrc);
    img.src = previewSrc;
  }, [placeholder, previewSrc, fullSrc, isVisible]);

  return (
    <button
      ref={setNode}
      type="button"
      className="deck-file-thumb-wrap"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      aria-label={i18n.t("deck.openImage", { name: info.name })}
    >
      <img
        className="deck-file-thumb"
        src={src}
        alt={info.name}
        loading="lazy"
        onError={(e) => { (e.currentTarget as HTMLImageElement).src = fullSrc; }}
      />
    </button>
  );
}

function PostFileAttachments({
  fileIds,
  postId,
  showImagePreviews = true,
  viewport,
}: {
  fileIds: string[];
  postId: string;
  showImagePreviews?: boolean;
  viewport: HTMLDivElement | null;
}): React.JSX.Element | null {
  const [fileInfos, setFileInfos] = useState<MattermostFileInfo[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; name: string } | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const isVisible = useElementVisibility(node, { root: viewport, rootMargin: "320px 0px", defaultVisible: false });

  useEffect(() => {
    if (!isVisible) {
      setFileInfos((current) => (current.length > 0 ? [] : current));
      return;
    }
    let cancelled = false;
    void fetchPostFileInfos(postId).then((next) => {
      if (!cancelled) {
        setFileInfos(next);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isVisible, postId]);

  if (fileIds.length === 0) return null;


  const getPlaceholderSrc = (info: MattermostFileInfo): string | null => {
    if (info.mini_preview) {
      return `data:${info.mime_type};base64,${info.mini_preview}`;
    }
    return null;
  };

  const getPreviewSrc = (info: MattermostFileInfo): string => {
    if (info.has_preview_image) {
      return getMattermostUrl(`/api/v4/files/${info.id}/preview`);
    }
    return getMattermostUrl(`/api/v4/files/${info.id}`);
  };

  const getFullSrc = (info: MattermostFileInfo): string => {
    return getMattermostUrl(`/api/v4/files/${info.id}`);
  };

  return (
    <>
      <div ref={setNode} className="deck-post-files">
        {fileInfos.map((info) => {
          const isImage = info.mime_type.startsWith("image/");
          return isImage && showImagePreviews ? (
            <ImageThumb
              key={info.id}
              info={info}
              placeholder={getPlaceholderSrc(info)}
              previewSrc={getPreviewSrc(info)}
              fullSrc={getFullSrc(info)}
              onOpen={() => setLightboxSrc({ src: getFullSrc(info), name: info.name })}
              viewport={viewport}
            />
          ) : (
            <button
              key={info.id}
              type="button"
              className="deck-file-card"
              onClick={(e) => {
                e.stopPropagation();
                void chrome.runtime.sendMessage({ type: "mattermost-deck:open-tab", url: getMattermostUrl(`/api/v4/files/${info.id}`) });
              }}
            >
              <span className="deck-file-icon">
                <FileTypeIcon mimeType={info.mime_type} extension={info.extension ?? ""} />
              </span>
              <span className="deck-file-name" title={info.name}>{info.name}</span>
              <span className="deck-file-size">{formatFileSize(info.size)}</span>
            </button>
          );
        })}
      </div>
      {lightboxSrc !== null && showImagePreviews ? (
        <ImageLightbox
          src={lightboxSrc.src}
          name={lightboxSrc.name}
          onClose={() => setLightboxSrc(null)}
        />
      ) : null}
    </>
  );
}

function PostListItem({
  entry,
  entryIndex,
  displayEntries,
  userDirectory,
  compactMode,
  renderMeta,
  renderBody,
  onOpenPost,
  postClickAction,
  showImagePreviews,
  highlightTerms,
  currentUserId,
  deferRemoteContent,
  viewport,
}: {
  entry: Extract<PostListEntry, { type: "post" }>;
  entryIndex: number;
  displayEntries: PostListEntry[];
  userDirectory: Record<string, MattermostUser>;
  compactMode: boolean;
  renderMeta?: (post: MattermostPost) => React.ReactNode;
  renderBody?: (post: MattermostPost, options: { isVisible: boolean }) => React.ReactNode;
  onOpenPost?: (post: MattermostPost) => void;
  postClickAction: PostClickAction;
  showImagePreviews: boolean;
  highlightTerms: string[];
  currentUserId?: string | null;
  deferRemoteContent: boolean;
  viewport: HTMLDivElement | null;
}): React.JSX.Element {
  const [node, setNode] = useState<HTMLLIElement | null>(null);
  const isVisible = useElementVisibility(node, { root: viewport, rootMargin: "320px 0px", defaultVisible: true });
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragDetectedRef = useRef(false);
  const { post } = entry;
  const previousEntry = displayEntries[entryIndex - 1];
  const groupedWithPrevious = !compactMode && previousEntry?.type === "post" && shouldGroupAdjacentPosts(previousEntry.post, post);
  const isReplyPost = Boolean(post.root_id?.trim());
  const hasFiles = (post.file_ids?.length ?? 0) > 0;
  const body = renderBody
    ? renderBody(post, { isVisible })
    : (isVisible ? renderHighlightedTextFromTerms(summarisePost(post.message), highlightTerms) : summarisePost(post.message));
  const isEmpty = !renderBody && !post.message.trim();
  const canOpenPost = Boolean(onOpenPost && postClickAction !== "none");
  const activatePost = () => {
    if (!onOpenPost || postClickAction === "none") return;
    if (postClickAction === "ask" && !window.confirm(i18n.t("deck.openPostConfirm"))) {
      return;
    }
    onOpenPost(post);
  };

  return (
    <li
      ref={setNode}
      key={entry.key}
      role={canOpenPost ? "button" : undefined}
      tabIndex={canOpenPost ? 0 : undefined}
      className={`deck-card deck-card--post${compactMode ? " deck-card--post-compact" : ""}${groupedWithPrevious ? " deck-card--post-grouped" : ""}${isReplyPost ? " deck-card--reply" : ""}${onOpenPost && postClickAction !== "none" ? " deck-card--clickable" : ""}`}
      onPointerDown={
        onOpenPost && postClickAction !== "none"
          ? (event) => {
              pointerStartRef.current = { x: event.clientX, y: event.clientY };
              dragDetectedRef.current = false;
            }
          : undefined
      }
      onPointerMove={
        onOpenPost && postClickAction !== "none"
          ? (event) => {
              const start = pointerStartRef.current;
              if (!start || dragDetectedRef.current) {
                return;
              }
              if (Math.abs(event.clientX - start.x) > 6 || Math.abs(event.clientY - start.y) > 6) {
                dragDetectedRef.current = true;
              }
            }
          : undefined
      }
      onPointerUp={
        onOpenPost && postClickAction !== "none"
          ? () => {
              pointerStartRef.current = null;
            }
          : undefined
      }
      onClick={
        onOpenPost && postClickAction !== "none"
          ? () => {
              const selectionText = window.getSelection?.()?.toString().trim() ?? "";
              if (dragDetectedRef.current || selectionText.length > 0) {
                dragDetectedRef.current = false;
                return;
              }
              activatePost();
            }
          : undefined
      }
      onKeyDown={
        canOpenPost
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              activatePost();
            }
          : undefined
      }
    >
      {!compactMode && !groupedWithPrevious ? (
        <div className="deck-card-header">
          <strong>{formatPostTime(post.create_at)}</strong>
          <span className="deck-card-author">
            {deferRemoteContent ? (
              <span
                className="deck-card-avatar deck-card-avatar--placeholder"
                aria-hidden="true"
              />
            ) : (
              <img
                className="deck-card-avatar"
                src={getUserAvatarUrl(post.user_id)}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="deck-card-author-label">
              {deferRemoteContent && !userDirectory[post.user_id]
                ? "…"
                : getUserLabel(userDirectory[post.user_id], post.user_id)}
            </span>
          </span>
        </div>
      ) : null}
      {renderMeta ? <div className="deck-card-meta">{renderMeta(post)}</div> : null}
      {(!isEmpty || !hasFiles) ? (
        compactMode ? (
          <p className="deck-post-compact-line">
            <span className="deck-post-compact-time">{formatPostTime(post.create_at)}</span>
            <span className="deck-post-compact-author" style={{ color: getCompactAuthorColor(post.user_id, currentUserId) }}>
              {getUserLabel(userDirectory[post.user_id], post.user_id)}:
            </span>
            <span className="deck-post-compact-body">{body}</span>
          </p>
        ) : (
          <p>{body}</p>
        )
      ) : null}
      {!deferRemoteContent && post.file_ids && post.file_ids.length > 0 ? (
        <PostFileAttachments fileIds={post.file_ids} postId={post.id} showImagePreviews={showImagePreviews} viewport={viewport} />
      ) : null}
    </li>
  );
}

function PostList({
  posts,
  userDirectory,
  compactMode = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  renderMeta,
  renderBody,
  onOpenPost,
  postClickAction,
  showImagePreviews = true,
  language = "ja",
  reversedPostOrder = false,
  highlightTerms = [],
  currentUserId,
  lastViewedAt,
  onMarkRead,
  unreadSeparatorLabel,
  markReadLabel,
  jumpToLatestLabel,
  newPostsLabel,
  suppressEndState = false,
  suppressNewPostNotifications = false,
  deferredPostIds,
  busy = false,
  listId,
}: {
  posts: MattermostPost[];
  userDirectory: Record<string, MattermostUser>;
  compactMode?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  renderMeta?: (post: MattermostPost) => React.ReactNode;
  renderBody?: (post: MattermostPost, options: { isVisible: boolean }) => React.ReactNode;
  onOpenPost?: (post: MattermostPost) => void;
  postClickAction: PostClickAction;
  showImagePreviews?: boolean;
  language?: DeckLanguage;
  reversedPostOrder?: boolean;
  highlightTerms?: string[];
  currentUserId?: string | null;
  lastViewedAt?: number | null;
  onMarkRead?: () => void;
  unreadSeparatorLabel?: string;
  markReadLabel?: string;
  jumpToLatestLabel?: string;
  newPostsLabel?: (count: number) => string;
  suppressEndState?: boolean;
  suppressNewPostNotifications?: boolean;
  deferredPostIds?: ReadonlySet<string>;
  busy?: boolean;
  listId?: string;
}): React.JSX.Element {
  const text = useAppText();
  const resolvedUnreadSeparatorLabel =
    unreadSeparatorLabel ?? text.unreadSeparatorLabel;
  const resolvedMarkReadLabel = markReadLabel ?? text.markRead;
  const resolvedJumpToLatestLabel =
    jumpToLatestLabel ?? text.jumpToLatest;
  const resolvedNewPostsLabel = newPostsLabel ?? text.newPosts;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [newPostCount, setNewPostCount] = useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const lastInteractionAtRef = useRef(Date.now());
  const previousTopPostIdRef = useRef<string | null>(posts[0]?.id ?? null);
  const previousPostCountRef = useRef(posts.length);
  const entries = useMemo(() => buildPostListEntries(posts, lastViewedAt), [posts, lastViewedAt]);
  const displayEntries = useMemo(
    () => reversedPostOrder ? [...entries].reverse() : entries,
    [entries, reversedPostOrder],
  );
  const reversedPostOrderRef = useRef(reversedPostOrder);
  reversedPostOrderRef.current = reversedPostOrder;
  const hasInitialScrolledRef = useRef(false);

  const markInteraction = useCallback(() => {
    lastInteractionAtRef.current = Date.now();
  }, []);

  const scrollToLatest = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    if (reversedPostOrderRef.current) {
      const target = viewport.scrollHeight - viewport.clientHeight;
      viewport.scrollTo({
        top: target,
        behavior: getPreferredScrollBehavior(),
      });
    } else {
      viewport.scrollTo({
        top: 0,
        behavior: getPreferredScrollBehavior(),
      });
    }
    setNewPostCount(0);
    setShowJumpToLatest(false);
    markInteraction();
  }, [markInteraction]);

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
  }, [posts]);

  useEffect(() => {
    if (!reversedPostOrder || hasInitialScrolledRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport || viewportHeight === 0) return;
    const target = viewport.scrollHeight - viewport.clientHeight;
    if (target <= 0) return;
    viewport.scrollTop = target;
    hasInitialScrolledRef.current = true;
  }, [reversedPostOrder, viewportHeight]);

  useEffect(() => {
    const nextTopPostId = posts[0]?.id ?? null;
    const previousTopPostId = previousTopPostIdRef.current;
    const previousCount = previousPostCountRef.current;
    previousTopPostIdRef.current = nextTopPostId;
    previousPostCountRef.current = posts.length;

    if (suppressNewPostNotifications) {
      setNewPostCount(0);
      setShowJumpToLatest(false);
      return;
    }

    if (!nextTopPostId || !previousTopPostId || nextTopPostId === previousTopPostId) {
      return;
    }

    const viewport = viewportRef.current;

    if (reversedPostOrderRef.current) {
      const isNearBottom = !viewport ||
        (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight) < 24;

      if (Date.now() - lastInteractionAtRef.current < IDLE_AUTOSCROLL_MS && !isNearBottom) {
        setNewPostCount((current) => current + Math.max(1, posts.length - previousCount));
        setShowJumpToLatest(true);
        return;
      }
      if (!viewport) return;
      const target = viewport.scrollHeight - viewport.clientHeight;
      viewport.scrollTo({
        top: target,
        behavior: getPreferredScrollBehavior(),
      });
      setNewPostCount(0);
      setShowJumpToLatest(false);
    } else {
      const isNearTop = !viewport || viewport.scrollTop < 24;

      if (Date.now() - lastInteractionAtRef.current < IDLE_AUTOSCROLL_MS && !isNearTop) {
        setNewPostCount((current) => current + Math.max(1, posts.length - previousCount));
        setShowJumpToLatest(true);
        return;
      }
      if (!viewport) return;
      viewport.scrollTo({
        top: 0,
        behavior: getPreferredScrollBehavior(),
      });
      setNewPostCount(0);
      setShowJumpToLatest(false);
    }
  }, [posts, suppressNewPostNotifications]);

  const renderEntry = (entry: PostListEntry, entryIndex: number): React.ReactNode => {
    if (entry.type === "separator") {
      return (
        <li key={entry.key} className="deck-list-separator" aria-hidden="true">
          <span>{entry.label}</span>
        </li>
      );
    }

    if (entry.type === "unread-separator") {
      return (
        <li key={entry.key} className="deck-list-separator deck-list-separator--unread">
          {onMarkRead ? (
            <button
              type="button"
              className="deck-unread-mark-read-toggle"
              onClick={(event) => {
                event.stopPropagation();
                onMarkRead();
              }}
              aria-label={resolvedMarkReadLabel}
              title={resolvedMarkReadLabel}
            >
              <span className="deck-unread-mark-read-toggle-label deck-unread-mark-read-toggle-label--idle">
                {resolvedUnreadSeparatorLabel}
              </span>
              <span className="deck-unread-mark-read-toggle-label deck-unread-mark-read-toggle-label--action">
                {resolvedMarkReadLabel}
              </span>
            </button>
          ) : (
            <span>{resolvedUnreadSeparatorLabel}</span>
          )}
        </li>
      );
    }

    const deferRemoteContent =
      deferredPostIds?.has(entry.post.id) ?? false;
    return (
      <PostListItem
        key={entry.key}
        entry={entry}
        entryIndex={entryIndex}
        displayEntries={displayEntries}
        userDirectory={userDirectory}
        compactMode={compactMode}
        renderMeta={renderMeta}
        renderBody={renderBody}
        onOpenPost={deferRemoteContent ? undefined : onOpenPost}
        postClickAction={postClickAction}
        showImagePreviews={showImagePreviews}
        highlightTerms={highlightTerms}
        currentUserId={currentUserId}
        deferRemoteContent={deferRemoteContent}
        viewport={viewportRef.current}
      />
    );
  };

  const footerNode = suppressEndState ? null : hasMore || loadingMore ? (
    <div className="deck-list-footer">
      <button
        type="button"
        className="deck-load-more"
        onClick={() => onLoadMore?.()}
        disabled={!hasMore || loadingMore}
      >
        <RefreshIcon spinning={loadingMore} />
        {loadingMore ? text.loadingMore : text.loadMore}
      </button>
    </div>
  ) : posts.length > 0 ? (
    <div className="deck-list-end">
      {text.allPostsLoaded}
    </div>
  ) : null;

  return (
    <div
      className="deck-post-list"
      aria-busy={busy || undefined}
    >
      {newPostCount > 0 || showJumpToLatest ? (
        <div className="deck-list-floating-action">
          <button
            type="button"
            className="deck-new-posts-button"
            data-new-post-count={newPostCount}
            onClick={scrollToLatest}
            title={newPostCount > 0 ? resolvedNewPostsLabel(newPostCount) : resolvedJumpToLatestLabel}
            aria-label={newPostCount > 0 ? resolvedNewPostsLabel(newPostCount) : resolvedJumpToLatestLabel}
          >
            <JumpToLatestIcon reversed={reversedPostOrder} />
          </button>
        </div>
      ) : null}
      <div
        ref={viewportRef}
        className="deck-list-viewport"
        tabIndex={listId ? -1 : undefined}
        onScroll={(event) => {
          const el = event.currentTarget;
          const nearEdge = reversedPostOrder
            ? el.scrollHeight - el.scrollTop - el.clientHeight < 24
            : el.scrollTop < 24;
          if (nearEdge) {
            setNewPostCount(0);
            setShowJumpToLatest(false);
          } else {
            setShowJumpToLatest(true);
          }
          markInteraction();
        }}
        onWheel={markInteraction}
        onPointerDown={markInteraction}
      >
        {reversedPostOrder && footerNode}
        <ul
          id={listId}
          className={`deck-list${compactMode ? " deck-list--post-compact" : ""}`}
        >
          {displayEntries.map((entry, index) => renderEntry(entry, index))}
        </ul>
        {!reversedPostOrder && footerNode}
      </div>
    </div>
  );
}

function MentionsColumn({
  column,
  username,
  currentUser,
  currentUserId,
  mentionsLastReadAt,
  onSetMentionsLastReadAt,
  currentTeamId,
  currentChannelId,
  realtimeEnabled,
  teams,
  unreads,
  userDirectory,
  ensureUsers,
  postedEvents,
  deletedPostIds,
  deletedPostIdsRef,
  reconnectNonce,
  mentionReconcileNonce,
  mentionMetadataNonce,
  readRefreshNonce,
  realtimeReadMarkers,
  pollingIntervalSeconds,
  canMoveLeft,
  canMoveRight,
  onMove,
  onUpdate,
  onRemove,
  onOpenPost,
  postClickAction,
  compactMode,
  columnColors,
  showImagePreviews,
  language,
  reversedPostOrder,
  highlightKeywords,
  isFocusedPane,
  onToggleFocus,
}: {
  column: DeckColumn;
  username: string | null;
  currentUser: MattermostUser | null;
  currentUserId?: string | null;
  mentionsLastReadAt: number | null;
  onSetMentionsLastReadAt: (value: number | null) => void;
  currentTeamId?: string;
  currentChannelId?: string;
  realtimeEnabled: boolean;
  teams: MattermostTeam[];
  unreads: TeamUnread[];
  userDirectory: Record<string, MattermostUser>;
  ensureUsers: (userIds: string[]) => Promise<void>;
  postedEvents: PostedEvent[];
  deletedPostIds: string[];
  deletedPostIdsRef: React.RefObject<Set<string>>;
  reconnectNonce: number;
  mentionReconcileNonce: number;
  mentionMetadataNonce: number;
  readRefreshNonce: number;
  realtimeReadMarkers: MentionReadMarkers;
  pollingIntervalSeconds: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (id: string, direction: "left" | "right") => void;
  onUpdate: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>) => void;
  onRemove: (id: string) => void;
  onOpenPost: (post: MattermostPost, target?: OpenPostTarget) => void;
  postClickAction: PostClickAction;
  compactMode: boolean;
  columnColors: ColumnColorSettings;
  showImagePreviews: boolean;
  language: DeckLanguage;
  reversedPostOrder: boolean;
  highlightKeywords: string;
  isFocusedPane: boolean;
  onToggleFocus: (id: string) => void;
}): React.JSX.Element {
  const availableTeamIdsSignature = teams.map((team) => team.id).join(",");
  const teamIds = useMemo(
    () =>
      column.teamId
        ? [column.teamId]
        : availableTeamIdsSignature.split(",").filter(Boolean),
    [availableTeamIdsSignature, column.teamId],
  );
  const text = useAppText();
  const highlightTerms = useMemo(() => resolveHighlightTerms(highlightKeywords, username), [highlightKeywords, username]);
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
  const { isRefreshing, startRefresh, finishRefresh } = useRefreshIndicator();
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sectionNode, setSectionNode] = useState<HTMLElement | null>(null);
  const specialMentionMembersCacheRef = useRef<Record<string, { expiresAt: number; members: MattermostChannelMember[] }>>({});
  const mentionPostsRef = useRef<MattermostPost[]>([]);
  const mentionLoadRunIdRef = useRef(0);
  const mentionCacheHydratedEntryIdRef = useRef<string | null>(null);
  const mentionCacheSaveEntryIdRef = useRef<string | null>(null);
  const mentionCacheStoredPostIdsRef = useRef<Set<string>>(new Set());
  const processedMentionDeletionKeyRef = useRef("");
  const postedEventsRef = useRef(postedEvents);
  // The refresh flow hydrates the current feed. Only WebSocket events that
  // arrive after this column mounts should be applied as realtime additions.
  const processedMentionPostedEventsRef =
    useRef<WeakSet<PostedEvent> | undefined>(undefined);
  if (!processedMentionPostedEventsRef.current) {
    processedMentionPostedEventsRef.current =
      new WeakSet<PostedEvent>(postedEvents);
  }
  const currentRouteRef = useRef({
    teamId: currentTeamId,
    channelId: currentChannelId,
  });
  postedEventsRef.current = postedEvents;
  currentRouteRef.current = {
    teamId: currentTeamId,
    channelId: currentChannelId,
  };
  const [mentionReadState, setMentionReadState] = useState<MentionReadState>({
    channelLastViewedAt: {},
    threadLastViewedAt: {},
    activeChannelIds: null,
  });
  const [mentionLoadProgress, setMentionLoadProgress] =
    useState<MentionLoadProgressState>(() =>
      createMentionLoadProgressState(mentionLoadRunIdRef.current),
    );
  const [mentionCacheState, setMentionCacheState] =
    useState<MentionCacheDisplayState>(() =>
      createMentionCacheDisplayState(),
    );
  const [mentionDisplaySnapshot, setMentionDisplaySnapshot] =
    useState<MentionDisplaySnapshot | null>(null);
  const [
    suppressAppliedMentionNotifications,
    setSuppressAppliedMentionNotifications,
  ] = useState(false);
  const [mentionCacheSaveVersion, setMentionCacheSaveVersion] =
    useState(0);
  const [mentionCacheLastSavedAt, setMentionCacheLastSavedAt] =
    useState<number | null>(null);
  const mentionCacheActiveForContext =
    mentionCacheState.active &&
    mentionCacheState.ownerUserId === currentUserId &&
    mentionCacheState.scopeTeamId === (column.teamId ?? null);
  const displayedMentionReadState = useMemo(
    () =>
      mentionLoadProgress.active
        ? mergeMentionReadStates([
            mentionReadState,
            mentionLoadProgress.readState,
          ])
        : mentionReadState,
    [mentionLoadProgress.active, mentionLoadProgress.readState, mentionReadState],
  );
  const effectiveMentionReadState = useMemo(
    () => applyMentionReadMarkers(displayedMentionReadState, realtimeReadMarkers),
    [displayedMentionReadState, realtimeReadMarkers],
  );
  const effectiveCachedMentionReadState = useMemo(
    () =>
      applyMentionReadMarkers(
        mentionCacheState.readState,
        realtimeReadMarkers,
      ),
    [mentionCacheState.readState, realtimeReadMarkers],
  );
  // Background scans stay in mentionLoadProgress until the complete result is
  // ready. Feeding partial scan results into PostList makes existing rows move
  // whenever another team's posts arrive and can look like a realtime post.
  const liveDisplayedPosts = postState.posts;
  const displayedPosts = useMemo(
    () =>
      mentionCacheActiveForContext
        ? mergePosts(
            liveDisplayedPosts,
            mentionCacheState.posts,
            MENTIONS_MAX_BUFFER,
          )
        : liveDisplayedPosts,
    [
      liveDisplayedPosts,
      mentionCacheActiveForContext,
      mentionCacheState.posts,
    ],
  );
  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const activePosts = useMemo(
    () =>
      mergePosts(
        filterActiveMentionPosts(
          liveDisplayedPosts,
          effectiveMentionReadState,
        ),
        mentionCacheActiveForContext
          ? filterActiveMentionPosts(
              mentionCacheState.posts,
              effectiveCachedMentionReadState,
            )
          : [],
        MENTIONS_MAX_BUFFER,
      ),
    [
      effectiveCachedMentionReadState,
      effectiveMentionReadState,
      liveDisplayedPosts,
      mentionCacheActiveForContext,
      mentionCacheState.posts,
    ],
  );
  const unreadPosts = useMemo(
    () =>
      mergePosts(
        filterUnreadMentionPosts(
          filterActiveMentionPosts(
            liveDisplayedPosts,
            effectiveMentionReadState,
          ),
          effectiveMentionReadState,
        ),
        mentionCacheActiveForContext
          ? filterUnreadMentionPosts(
              filterActiveMentionPosts(
                mentionCacheState.posts,
                effectiveCachedMentionReadState,
              ),
              effectiveCachedMentionReadState,
            )
          : [],
        MENTIONS_MAX_BUFFER,
      ),
    [
      effectiveCachedMentionReadState,
      effectiveMentionReadState,
      liveDisplayedPosts,
      mentionCacheActiveForContext,
      mentionCacheState.posts,
    ],
  );
  const mentionCount = useMemo(
    () => {
      const serverCount = column.teamId
        ? getEffectiveTeamMentionCount(
            unreads.find((entry) => entry.team_id === column.teamId) ?? {
              team_id: column.teamId,
              msg_count: 0,
              mention_count: 0,
            },
            currentUser?.collapsed_reply_threads === true,
          )
        : unreads.reduce(
            (total, entry) =>
              total +
              getEffectiveTeamMentionCount(
                entry,
                currentUser?.collapsed_reply_threads === true,
            ),
            0,
          );
      // Once loading completes, show the actionable count represented by the
      // feed itself. TeamUnread omits DM/GM and can retain deleted-channel CRT
      // counters, so it is only a useful provisional value during loading.
      return postState.status === "ready"
        ? unreadPosts.length
        : Math.max(serverCount, unreadPosts.length);
    },
    [column.teamId, currentUser?.collapsed_reply_threads, postState.status, unreadPosts.length, unreads],
  );
  const resolvedVisiblePosts = useMemo(
    () => (column.unreadOnly ? unreadPosts : activePosts),
    [activePosts, column.unreadOnly, unreadPosts],
  );
  const provisionalPostIds = useMemo(() => {
    if (!mentionLoadProgress.active || mentionLoadProgress.posts.length === 0) {
      return new Set<string>();
    }
    const authoritativePostIds = new Set(
      postState.posts.map((post) => post.id),
    );
    return new Set(
      mentionLoadProgress.posts
        .filter((post) => !authoritativePostIds.has(post.id))
        .map((post) => post.id),
    );
  }, [
    mentionLoadProgress.active,
    mentionLoadProgress.posts,
    postState.posts,
  ]);
  const cachedPostIds = useMemo(
    () =>
      mentionCacheActiveForContext
        ? new Set(mentionCacheState.posts.map((post) => post.id))
        : new Set<string>(),
    [mentionCacheActiveForContext, mentionCacheState.posts],
  );
  const deferredMentionPostIds = useMemo(
    () => new Set([...provisionalPostIds, ...cachedPostIds]),
    [cachedPostIds, provisionalPostIds],
  );
  const snapshotPosts = useMemo(
    () =>
      mentionDisplaySnapshot?.posts.filter(
        (post) => !deletedPostIdsRef.current?.has(post.id),
      ) ?? null,
    [deletedPostIds, deletedPostIdsRef, mentionDisplaySnapshot],
  );
  const visiblePosts = snapshotPosts ?? resolvedVisiblePosts;
  const visibleDeferredMentionPostIds = useMemo(
    () =>
      mentionDisplaySnapshot
        ? new Set(mentionDisplaySnapshot.deferredPostIds)
        : deferredMentionPostIds,
    [deferredMentionPostIds, mentionDisplaySnapshot],
  );
  const pendingMentionChanges = useMemo(
    () =>
      snapshotPosts
        ? summariseMentionPresentationChanges(
            snapshotPosts,
            resolvedVisiblePosts,
          )
        : {
            count: 0,
            hasAdditionsOrUpdates: false,
          },
    [resolvedVisiblePosts, snapshotPosts],
  );
  const pendingMentionUpdateCount = pendingMentionChanges.count;
  const pendingMentionHasAdditionsOrUpdates =
    pendingMentionChanges.hasAdditionsOrUpdates;
  const mentionPostListId = `mattermost-deck-mentions-${column.id}`;

  useEffect(() => {
    mentionPostsRef.current = postState.posts;
  }, [postState.posts]);

  useEffect(() => {
    if (
      !mentionLoadProgress.active ||
      mentionDisplaySnapshot ||
      resolvedVisiblePosts.length === 0
    ) {
      return;
    }

    const visiblePostIds = new Set(
      resolvedVisiblePosts.map((post) => post.id),
    );
    setMentionDisplaySnapshot({
      runId: mentionLoadProgress.runId,
      posts: resolvedVisiblePosts.slice(0, MENTIONS_MAX_BUFFER),
      deferredPostIds: Array.from(deferredMentionPostIds).filter(
        (postId) => visiblePostIds.has(postId),
      ),
    });
  }, [
    deferredMentionPostIds,
    mentionDisplaySnapshot,
    mentionLoadProgress.active,
    mentionLoadProgress.runId,
    resolvedVisiblePosts,
  ]);

  useEffect(() => {
    if (
      mentionDisplaySnapshot &&
      !mentionLoadProgress.active &&
      hasCompletedInitialLoad &&
      (
        pendingMentionUpdateCount === 0 ||
        !pendingMentionHasAdditionsOrUpdates
      )
    ) {
      setSuppressAppliedMentionNotifications(true);
      setMentionDisplaySnapshot(null);
    }
  }, [
    hasCompletedInitialLoad,
    mentionDisplaySnapshot,
    mentionLoadProgress.active,
    pendingMentionHasAdditionsOrUpdates,
    pendingMentionUpdateCount,
  ]);

  useEffect(() => {
    setMentionDisplaySnapshot(null);
  }, [column.unreadOnly]);

  // Read markers are user-driven state, not background discoveries. Apply
  // them to the held snapshot immediately so marking a channel or thread read
  // still removes unread rows without also revealing buffered scan additions.
  useEffect(() => {
    if (!mentionDisplaySnapshot) {
      return;
    }
    const activeSnapshotPosts = filterActiveMentionPosts(
      mentionDisplaySnapshot.posts,
      effectiveMentionReadState,
    );
    const posts = column.unreadOnly
      ? filterUnreadMentionPosts(
          activeSnapshotPosts,
          effectiveMentionReadState,
        )
      : activeSnapshotPosts;
    if (
      posts.length === mentionDisplaySnapshot.posts.length &&
      posts.every(
        (post, index) =>
          post.id === mentionDisplaySnapshot.posts[index]?.id,
      )
    ) {
      return;
    }
    const postIds = new Set(posts.map((post) => post.id));
    setSuppressAppliedMentionNotifications(true);
    setMentionDisplaySnapshot({
      ...mentionDisplaySnapshot,
      posts,
      deferredPostIds:
        mentionDisplaySnapshot.deferredPostIds.filter(
          (postId) => postIds.has(postId),
        ),
    });
  }, [mentionReadState, realtimeReadMarkers]);

  useEffect(() => {
    if (!suppressAppliedMentionNotifications) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setSuppressAppliedMentionNotifications(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [suppressAppliedMentionNotifications]);

  const handleApplyMentionUpdates = useCallback(() => {
    const focusTarget = sectionNode?.querySelector(
      "[data-deck-mention-apply-focus='true']",
    );
    const fallbackFocusTarget = sectionNode?.querySelector(
      ".deck-list-viewport",
    );
    setSuppressAppliedMentionNotifications(true);
    setMentionDisplaySnapshot(null);
    window.requestAnimationFrame(() => {
      if (
        focusTarget instanceof HTMLElement &&
        focusTarget.isConnected
      ) {
        focusTarget.focus({ preventScroll: true });
      } else if (fallbackFocusTarget instanceof HTMLElement) {
        fallbackFocusTarget.focus({ preventScroll: true });
      }
    });
  }, [sectionNode]);

  const teamOptions = useMemo<CustomSelectOption[]>(
    () => [{ value: "", label: text.allTeams }, ...teams.map((team) => ({ value: team.id, label: team.display_name || team.name }))],
    [teams, text.allTeams],
  );
  const mentionKeySignature = currentUser
    ? JSON.stringify({
        username: currentUser.username,
        firstName: currentUser.first_name ?? "",
        notifyProps: currentUser.notify_props ?? {},
        groupNames: currentUser.mention_group_names ?? [],
      })
    : "";
  const mentionKeys = useMemo<MattermostMentionKey[]>(
    () => (currentUser ? getMattermostMentionKeys(currentUser) : []),
    [mentionKeySignature],
  );
  const mentionSearchTerms = useMemo(
    () => (currentUser ? buildMentionSearchTerms(currentUser) : ""),
    [mentionKeySignature],
  );
  const collapsedReplyThreads = currentUser?.collapsed_reply_threads === true;
  const commentsNotify = currentUser?.notify_props?.comments;
  const mentionCacheSignature = useMemo(
    () =>
      JSON.stringify({
        mentionKeySignature,
        collapsedReplyThreads,
        commentsNotify: commentsNotify ?? "",
        groupNames: [
          ...(currentUser?.mention_group_names ?? []),
        ].sort(),
      }),
    [
      collapsedReplyThreads,
      commentsNotify,
      currentUser?.mention_group_names,
      mentionKeySignature,
    ],
  );
  const mentionCacheServerScope = getMattermostUrl("/");
  const mentionCacheContext = useMemo<MentionCacheContext | null>(
    () =>
      currentUserId
        ? {
            serverScope: mentionCacheServerScope,
            userId: currentUserId,
            scopeTeamId: column.teamId ?? null,
            teamIds,
            mentionSignature: mentionCacheSignature,
          }
        : null,
    [
      column.teamId,
      currentUserId,
      mentionCacheServerScope,
      mentionCacheSignature,
      teamIds,
    ],
  );
  const mentionCacheEntryId = useMemo(
    () =>
      mentionCacheContext
        ? buildMentionCacheEntryId(mentionCacheContext)
        : null,
    [mentionCacheContext],
  );
  const shouldShowLoadingState =
    visiblePosts.length === 0 &&
    (
      mentionLoadProgress.active ||
      postState.status === "idle" ||
      postState.status === "loading"
    ) &&
    teamIds.length > 0 &&
    Boolean(username) &&
    !hasCompletedInitialLoad;
  const suppressMentionNewPostNotifications =
    (
      (mentionLoadProgress.active || mentionCacheActiveForContext) &&
      !hasCompletedInitialLoad
    ) ||
    suppressAppliedMentionNotifications;
  const isPaneVisible = useElementVisibility(sectionNode, { rootMargin: "600px 0px", defaultVisible: true });
  const specialMentionMemberTtlMs = realtimeEnabled
    ? SPECIAL_MENTION_MEMBER_TTL_WS_MS
    : Math.min(
        SPECIAL_MENTION_MEMBER_TTL_MS,
        Math.max(1_000, pollingIntervalSeconds * 1_000),
      );
  const handleMarkRead = useCallback(() => {
    const latestVisiblePostAt = visiblePosts.reduce((latest, post) => Math.max(latest, post.create_at), 0);
    const nextReadAt = latestVisiblePostAt > 0 ? latestVisiblePostAt : Date.now();
    onSetMentionsLastReadAt(nextReadAt);
  }, [onSetMentionsLastReadAt, visiblePosts]);

  useEffect(() => {
    mentionLoadRunIdRef.current += 1;
    mentionPostsRef.current = [];
    mentionCacheHydratedEntryIdRef.current = null;
    mentionCacheSaveEntryIdRef.current = null;
    mentionCacheStoredPostIdsRef.current = new Set();
    setHasCompletedInitialLoad(false);
    setMentionCacheSaveVersion(0);
    setMentionCacheLastSavedAt(null);
    setPostState({
      status: "idle",
      posts: [],
      error: null,
      nextPage: 1,
      hasMore: false,
      loadingMore: false,
    });
    setMentionReadState({
      channelLastViewedAt: {},
      threadLastViewedAt: {},
      activeChannelIds: null,
    });
    setMentionLoadProgress(
      createMentionLoadProgressState(mentionLoadRunIdRef.current),
    );
    setMentionCacheState(
      createMentionCacheDisplayState(mentionCacheEntryId),
    );
    setMentionDisplaySnapshot(null);
    setSuppressAppliedMentionNotifications(false);
  }, [mentionCacheEntryId]);

  useEffect(() => {
    specialMentionMembersCacheRef.current = {};
  }, [
    currentUserId,
    mentionMetadataNonce,
    reconnectNonce,
    refreshNonce,
  ]);

  useEffect(() => {
    if (isFocusedPane) {
      setShowControls(false);
    }
  }, [isFocusedPane]);

  useEffect(() => {
    if (!paused) {
      return;
    }
    mentionLoadRunIdRef.current += 1;
    setMentionLoadProgress(
      createMentionLoadProgressState(mentionLoadRunIdRef.current),
    );
  }, [paused]);

  const loadUnreadChannelMentionPosts = useCallback(
    async (
      teamId: string,
      onProgress?: (progress: ChannelMentionLoadProgress) => void,
      isCancelled?: () => boolean,
      activeChannelSnapshotPromise?: Promise<MentionActiveChannelSnapshot>,
    ) => {
      const shouldCancel = () => isCancelled?.() ?? false;
      if (!currentUserId || mentionKeys.length === 0 || shouldCancel()) {
        onProgress?.({
          type: "context",
          members: [],
          activeChannelIds: null,
        });
        return {
          posts: [] as MattermostPost[],
          members: [] as MattermostChannelMember[],
          activeChannelIds: null as Record<string, true> | null,
        };
      }

      const {
        teamId: activeTeamId,
        channelId: activeChannelId,
      } = currentRouteRef.current;
      const now = Date.now();
      const memberCache = specialMentionMembersCacheRef.current;
      for (const [cachedTeamId, cachedEntry] of Object.entries(memberCache)) {
        if (cachedEntry.expiresAt <= now) {
          delete memberCache[cachedTeamId];
        }
      }
      const cachedMembers = memberCache[teamId];
      let members: MattermostChannelMember[];
      if (cachedMembers && cachedMembers.expiresAt > now) {
        members = cachedMembers.members;
        delete memberCache[teamId];
        memberCache[teamId] = cachedMembers;
      } else {
        members = await getChannelMembersForCurrentUser(teamId);
        if (shouldCancel()) {
          return {
            posts: [] as MattermostPost[],
            members: [] as MattermostChannelMember[],
            activeChannelIds: null as Record<string, true> | null,
          };
        }
        memberCache[teamId] = {
          expiresAt: Date.now() + specialMentionMemberTtlMs,
          members,
        };
      }
      const cachedTeamIds = Object.keys(memberCache);
      while (cachedTeamIds.length > SPECIAL_MENTION_MEMBER_CACHE_MAX_TEAMS) {
        const oldestTeamId = cachedTeamIds.shift();
        if (oldestTeamId) {
          delete memberCache[oldestTeamId];
        }
      }

      const serverCountedMembers = members.filter(
        (member) =>
          (member.mention_count ?? 0) > 0 ||
          (member.mention_count_root ?? 0) > 0,
      );
      const serverCountedChannelIds = new Set(
        serverCountedMembers.map((member) => member.channel_id),
      );
      const candidateMembersByChannel = new Map(
        serverCountedMembers.map((member) => [member.channel_id, member]),
      );
      if (activeTeamId === teamId && activeChannelId) {
        const currentMember = members.find((member) => member.channel_id === activeChannelId);
        if (currentMember) {
          // Mattermost does not count a user's own @here/@channel post as an
          // unread mention, but it is still part of their recent-mentions
          // search. Scanning the open channel also bridges search-index delay.
          candidateMembersByChannel.set(activeChannelId, currentMember);
        }
      }
      const candidateMembers = Array.from(candidateMembersByChannel.values());

      const activeChannelSnapshot = await (
        activeChannelSnapshotPromise ?? loadMentionActiveChannelSnapshot()
      );
      if (shouldCancel()) {
        return {
          posts: [] as MattermostPost[],
          members: [] as MattermostChannelMember[],
          activeChannelIds: null as Record<string, true> | null,
        };
      }
      const {
        channels: activeChannels,
        activeChannelIds,
        channelDirectory: candidateChannelDirectory,
      } = activeChannelSnapshot;
      onProgress?.({
        type: "context",
        members,
        activeChannelIds,
      });
      if (candidateMembers.length === 0) {
        recordSpecialMentionScan({ hits: 0, channelsScanned: 0 });
        return { posts: [] as MattermostPost[], members, activeChannelIds };
      }

      const scannableCandidateMembers = activeChannels
        ? candidateMembers.filter(
            (member) =>
              candidateChannelDirectory.has(member.channel_id),
          )
        : candidateMembers;
      let posts: MattermostPost[] = [];
      await mapInBatches(
        scannableCandidateMembers,
        CHANNEL_FANOUT_BATCH_SIZE,
        async (member) => {
          if (shouldCancel()) {
            return;
          }
          try {
            const isCurrentChannel =
              activeTeamId === teamId &&
              activeChannelId === member.channel_id;
            const recentPosts = isCurrentChannel
              ? await getRecentPosts(
                  member.channel_id,
                  0,
                  POSTS_PAGE_SIZE,
                )
              : [];
            if (shouldCancel()) {
              return;
            }
            const readMarker = member.last_viewed_at ?? 0;
            const candidateChannel =
              candidateChannelDirectory.get(
                member.channel_id,
              );
            const channelType = candidateChannel?.type;
            const serverCountedChannel = serverCountedChannelIds.has(
              member.channel_id,
            );
            const fullThreadParticipationCache = new Map<
              string,
              Promise<{
                firstCurrentUserPostAt: number | null;
                truncated: boolean;
              }>
            >();
            let memberPosts: MattermostPost[] = [];
            const filterAndPublishBatch = async (
              batchContextPosts: MattermostPost[],
              batchOrderedPosts: MattermostPost[],
              extraPosts: MattermostPost[] = [],
            ) => {
              const contextById = new Map(
                batchContextPosts.map(
                  (post) => [post.id, post],
                ),
              );
              const threadContextByRoot =
                new Map<string, MattermostPost[]>();
              for (const contextPost of batchContextPosts) {
                if (!contextPost.root_id) {
                  continue;
                }
                const current =
                  threadContextByRoot.get(
                    contextPost.root_id,
                  );
                if (current) {
                  current.push(contextPost);
                } else {
                  threadContextByRoot.set(
                    contextPost.root_id,
                    [contextPost],
                  );
                }
              }
              // Filter before applying the 500-row display bound. Capping raw
              // channel posts first could hide a mention behind ordinary
              // traffic even within the initial 1,000-post scan.
              const candidatePosts = mergePosts(
                batchOrderedPosts.filter(
                  (post) => post.create_at > readMarker,
                ),
                extraPosts,
                batchOrderedPosts.length +
                  extraPosts.length,
              );
              const filteredPosts: MattermostPost[] = [];

              for (const post of candidatePosts) {
                if (shouldCancel()) {
                  break;
                }
                const isUnread =
                  post.create_at > readMarker;
                if (
                  postMatchesMentionCandidate(
                    post,
                    channelType,
                    currentUserId,
                    mentionKeys,
                    {
                      channelMetadataAvailable:
                        activeChannels !== null,
                      serverCountedChannel:
                        serverCountedChannel &&
                        isUnread,
                    },
                  )
                ) {
                  filteredPosts.push(post);
                  continue;
                }
                if (!isUnread) {
                  continue;
                }

                const rootPost = post.root_id
                  ? contextById.get(post.root_id)
                  : undefined;
                const threadContext = post.root_id
                  ? threadContextByRoot.get(
                      post.root_id,
                    ) ?? []
                  : [];
                const implicitSettings = {
                  currentUserId,
                  collapsedReplyThreads,
                  commentsNotify,
                };
                if (
                  postMatchesImplicitMention(
                    post,
                    rootPost,
                    threadContext,
                    implicitSettings,
                  )
                ) {
                  filteredPosts.push(post);
                  continue;
                }

                if (
                  !collapsedReplyThreads &&
                  post.root_id &&
                  commentsNotify === "root" &&
                  !rootPost &&
                  serverCountedChannel &&
                  post.user_id !== currentUserId
                ) {
                  filteredPosts.push(post);
                  continue;
                }

                const mayNeedFullThread =
                  !collapsedReplyThreads &&
                  Boolean(post.root_id) &&
                  commentsNotify === "any";
                if (
                  !mayNeedFullThread ||
                  !post.root_id
                ) {
                  continue;
                }

                try {
                  let participation =
                    fullThreadParticipationCache.get(
                      post.root_id,
                    );
                  if (!participation) {
                    if (
                      fullThreadParticipationCache.size >=
                      MENTION_FULL_THREAD_LOOKUP_LIMIT
                    ) {
                      if (
                        serverCountedChannel &&
                        post.user_id !== currentUserId
                      ) {
                        filteredPosts.push(post);
                      }
                      continue;
                    }
                    participation =
                      getPostThreadSinceWithMetadata(
                        post.root_id,
                        0,
                        200,
                        MENTION_THREAD_POST_SCAN_LIMIT,
                      ).then(
                        ({
                          posts: threadPosts,
                          truncated,
                        }) => {
                          let firstCurrentUserPostAt:
                            | number
                            | null = null;
                          for (const threadPost of threadPosts) {
                            if (
                              threadPost.user_id !==
                              currentUserId
                            ) {
                              continue;
                            }
                            firstCurrentUserPostAt =
                              firstCurrentUserPostAt ===
                              null
                                ? threadPost.create_at
                                : Math.min(
                                    firstCurrentUserPostAt,
                                    threadPost.create_at,
                                  );
                          }
                          return {
                            firstCurrentUserPostAt,
                            truncated,
                          };
                        },
                      );
                    fullThreadParticipationCache.set(
                      post.root_id,
                      participation,
                    );
                  }
                  const {
                    firstCurrentUserPostAt,
                    truncated,
                  } = await participation;
                  if (
                    firstCurrentUserPostAt !== null &&
                    firstCurrentUserPostAt <
                      post.create_at
                  ) {
                    filteredPosts.push(post);
                  } else if (
                    (truncated || !rootPost) &&
                    serverCountedChannel &&
                    post.user_id !== currentUserId
                  ) {
                    filteredPosts.push(post);
                  }
                } catch {
                  if (
                    serverCountedChannel &&
                    post.user_id !== currentUserId
                  ) {
                    filteredPosts.push(post);
                  }
                }
              }

              if (
                shouldCancel() ||
                filteredPosts.length === 0
              ) {
                return;
              }
              memberPosts = mergePosts(
                filteredPosts,
                memberPosts,
                MENTIONS_MAX_BUFFER,
              );
              posts = mergePosts(
                filteredPosts,
                posts,
                MENTIONS_MAX_BUFFER,
              );
              onProgress?.({ type: "posts", posts: filteredPosts });
            };

            let isFirstPage = true;
            // Scan ordinary posts in bounded 200-post pages until the read
            // marker. Filtering and publishing each page before fetching the
            // next keeps memory flat, while continuing past 1,000 posts when
            // CRT/Threads APIs are unavailable.
            await scanPostsSincePages(
              member.channel_id,
              readMarker,
              0,
              async ({
                posts: pageContextPosts,
                orderedPosts: pageOrderedPosts,
              }) => {
                const pageExtraPosts =
                  isFirstPage ? recentPosts : [];
                isFirstPage = false;
                await filterAndPublishBatch(
                  pageContextPosts,
                  pageOrderedPosts,
                  pageExtraPosts,
                );
              },
              () =>
                shouldCancel() ||
                memberPosts.length >=
                  MENTIONS_MAX_BUFFER,
            );
          } catch {
            // One inaccessible or archived channel must not discard the other
            // channels in the mentions feed.
            return;
          }
        },
        scannableCandidateMembers.length > CHANNEL_FANOUT_BATCH_SIZE ? CHANNEL_FANOUT_GAP_MS : 0,
        shouldCancel,
      );

      recordSpecialMentionScan({
        hits: posts.length,
        channelsScanned: scannableCandidateMembers.length,
        cacheHits: cachedMembers && cachedMembers.expiresAt > now ? 1 : 0,
        cacheMisses: cachedMembers && cachedMembers.expiresAt > now ? 0 : 1,
      });
      return { posts, members, activeChannelIds };
    },
    [
      currentUserId,
      collapsedReplyThreads,
      commentsNotify,
      mentionKeys,
      specialMentionMemberTtlMs,
    ],
  );

  const loadUnreadThreadMentionPosts = useCallback(
    async (
      teamId: string,
      onProgress?: (progress: ThreadMentionLoadProgress) => void,
      isCancelled?: () => boolean,
      activeChannelSnapshotPromise?: Promise<MentionActiveChannelSnapshot>,
    ) => {
      const shouldCancel = () => isCancelled?.() ?? false;
      if (!currentUserId || shouldCancel()) {
        onProgress?.({ type: "context", threads: [] });
        return { posts: [] as MattermostPost[], threads: [] as MattermostUserThread[] };
      }

      let hasReportedContext = false;
      try {
        const [recentPage, firstUnreadPage] = await Promise.all([
          getUserThreads(currentUserId, teamId, {
            unread: false,
            perPage: THREADS_PAGE_SIZE,
          }),
          getUserThreads(currentUserId, teamId, {
            unread: true,
            perPage: THREADS_PAGE_SIZE,
          }),
        ]);
        if (shouldCancel()) {
          return {
            posts: [] as MattermostPost[],
            threads: [] as MattermostUserThread[],
          };
        }
        const serverMentionThreads =
          await collectUnreadMentionThreads(
            firstUnreadPage,
            async (before) =>
              await getUserThreads(currentUserId, teamId, {
                unread: true,
                perPage: THREADS_PAGE_SIZE,
                before,
              }),
            {
              perPage: THREADS_PAGE_SIZE,
              maxMentionThreads:
                MENTION_UNREAD_THREAD_SCAN_LIMIT,
              shouldCancel,
            },
        );
        const activeChannelSnapshot = await (
          activeChannelSnapshotPromise ?? loadMentionActiveChannelSnapshot()
        );
        if (shouldCancel()) {
          return {
            posts: [] as MattermostPost[],
            threads: [] as MattermostUserThread[],
          };
        }
        const {
          channels: candidateChannels,
          channelDirectory: candidateChannelDirectory,
        } = activeChannelSnapshot;
        const candidateThreads = candidateChannels
          ? serverMentionThreads.filter(
              (thread) =>
                candidateChannelDirectory.has(thread.post.channel_id),
            )
          : serverMentionThreads;
        const readStateThreadDirectory = new Map(
          recentPage.threads.map((thread) => [thread.id, thread]),
        );
        for (const thread of serverMentionThreads) {
          readStateThreadDirectory.set(thread.id, thread);
        }
        const readStateThreads = Array.from(
          readStateThreadDirectory.values(),
        );
        onProgress?.({ type: "context", threads: readStateThreads });
        hasReportedContext = true;

        let posts: MattermostPost[] = [];
        await mapInBatches(
          candidateThreads,
          CHANNEL_FANOUT_BATCH_SIZE,
          async (thread) => {
            if (shouldCancel()) {
              return;
            }
            try {
              const threadPosts = await getPostThreadSince(
                thread.id,
                thread.last_viewed_at ?? 0,
                200,
                MENTION_THREAD_POST_SCAN_LIMIT,
              );
              if (shouldCancel()) {
                return;
              }
              const unreadPosts = getUnreadPostsFromThread(
                thread,
                threadPosts,
                currentUserId,
                candidateChannels ? mentionKeys : undefined,
                candidateChannelDirectory.get(thread.post.channel_id)?.type,
              );
              posts = mergePosts(
                unreadPosts,
                posts,
                MENTIONS_MAX_BUFFER,
              );
              onProgress?.({ type: "posts", posts: unreadPosts });
            } catch {
              return;
            }
          },
          candidateThreads.length > CHANNEL_FANOUT_BATCH_SIZE ? CHANNEL_FANOUT_GAP_MS : 0,
          shouldCancel,
        );

        return {
          posts,
          threads: readStateThreads,
        };
      } catch {
        // Threads were introduced after the first supported Mattermost
        // versions. Falling back to channel read markers keeps compatibility
        // with older or CRT-disabled servers.
        if (!hasReportedContext && !shouldCancel()) {
          onProgress?.({ type: "context", threads: [] });
        }
        return { posts: [] as MattermostPost[], threads: [] as MattermostUserThread[] };
      }
    },
    [currentUserId, mentionKeys],
  );

  const mentionPollingIntervalMs = useMemo(
    () => {
      const syncInterval = getSyncInterval(realtimeEnabled, pollingIntervalSeconds, isPaneVisible);
      if (column.teamId || !realtimeEnabled) {
        return syncInterval;
      }
      return Math.max(syncInterval, 120_000);
    },
    [column.teamId, isPaneVisible, pollingIntervalSeconds, realtimeEnabled],
  );

  useColumnPolling(
    async (isCancelled) => {
      if (!currentUserId) {
        return;
      }
      const resolvedCurrentUserId = currentUserId;
      const runId = mentionLoadRunIdRef.current + 1;
      mentionLoadRunIdRef.current = runId;
      const activeChannelSnapshotPromise =
        loadMentionActiveChannelSnapshot();
      let successfulSearchCount = 0;
      let firstSearchError: unknown = null;
      let searchHasMore = false;
      let searchPosts: MattermostPost[] = [];
      let unreadChannelPosts: MattermostPost[] = [];
      let unreadThreadPosts: MattermostPost[] = [];
      let completedMentionReadState = createEmptyMentionReadState();
      const teamProgressById = new Map<string, MentionTeamLoadAccumulator>(
        teamIds.map((teamId) => [
          teamId,
          {
            posts: [],
            channelContext: null,
            threadContext: null,
            readState: null,
            completedPipelines: new Set<MentionLoadPipeline>(),
          },
        ]),
      );
      const completedTeamIds = new Set<string>();
      const pendingTeamProgressIds = new Set<string>();
      let progressFlushTimer: number | null = null;
      const canPublishProgress = () =>
        !isCancelled() && mentionLoadRunIdRef.current === runId;
      const publishTeamProgress = (teamId: string) => {
        if (!canPublishProgress()) {
          return;
        }
        const teamProgress = teamProgressById.get(teamId);
        const teamReadState = teamProgress?.readState;
        if (!teamProgress || !teamReadState) {
          return;
        }
        // Root posts can be classified as soon as channel read markers arrive.
        // Replies wait for thread markers so unread-only mode never flashes a
        // reply that the user has already read in collapsed-thread mode.
        const contextSafePosts =
          teamProgress.threadContext === null
            ? teamProgress.posts.filter((post) => !post.root_id)
            : teamProgress.posts;
        const publishablePosts = filterActiveMentionPosts(
          contextSafePosts.filter(
            (post) => !deletedPostIdsRef.current?.has(post.id),
          ),
          teamReadState,
        );
        teamProgress.posts =
          teamProgress.threadContext === null
            ? teamProgress.posts.filter((post) => Boolean(post.root_id))
            : [];
        setMentionLoadProgress((current) => {
          if (current.runId !== runId || !current.active) {
            return current;
          }
          const retainedProgressPosts = current.posts.filter(
            (post) => !deletedPostIdsRef.current?.has(post.id),
          );
          const nextPosts = mergePosts(
            publishablePosts,
            retainedProgressPosts,
            MENTIONS_MAX_BUFFER,
          );
          return {
            ...current,
            posts: nextPosts,
            readState: compactMentionReadState(
              mergeMentionReadStates([
                current.readState,
                teamReadState,
              ]),
              nextPosts,
              { preserveActiveChannelIds: true },
            ),
            completedTeams: completedTeamIds.size,
          };
        });
      };
      const flushTeamProgress = () => {
        progressFlushTimer = null;
        const teamIdsToPublish = Array.from(pendingTeamProgressIds);
        pendingTeamProgressIds.clear();
        for (const teamId of teamIdsToPublish) {
          publishTeamProgress(teamId);
        }
      };
      const scheduleTeamProgress = (teamId: string) => {
        if (!canPublishProgress()) {
          return;
        }
        pendingTeamProgressIds.add(teamId);
        if (progressFlushTimer !== null) {
          return;
        }
        progressFlushTimer = window.setTimeout(
          flushTeamProgress,
          MENTION_PROGRESS_FLUSH_MS,
        );
      };
      const cancelTeamProgressFlush = () => {
        if (progressFlushTimer !== null) {
          window.clearTimeout(progressFlushTimer);
          progressFlushTimer = null;
        }
        pendingTeamProgressIds.clear();
      };
      const appendTeamProgressPosts = (
        teamId: string,
        posts: MattermostPost[],
      ) => {
        if (!canPublishProgress() || posts.length === 0) {
          return;
        }
        const teamProgress = teamProgressById.get(teamId);
        if (!teamProgress) {
          return;
        }
        teamProgress.posts = mergePosts(
          posts,
          teamProgress.posts,
          MENTIONS_MAX_BUFFER,
        );
        scheduleTeamProgress(teamId);
      };
      const setTeamChannelContext = (
        teamId: string,
        members: MattermostChannelMember[],
        activeChannelIds: Record<string, true> | null,
      ) => {
        if (!canPublishProgress()) {
          return;
        }
        const teamProgress = teamProgressById.get(teamId);
        if (!teamProgress) {
          return;
        }
        teamProgress.channelContext = { members, activeChannelIds };
        teamProgress.readState = buildMentionReadState(
          members,
          teamProgress.threadContext ?? [],
          activeChannelIds,
        );
        scheduleTeamProgress(teamId);
      };
      const setTeamThreadContext = (
        teamId: string,
        threads: MattermostUserThread[],
      ) => {
        if (!canPublishProgress()) {
          return;
        }
        const teamProgress = teamProgressById.get(teamId);
        if (!teamProgress) {
          return;
        }
        teamProgress.threadContext = threads;
        if (teamProgress.channelContext) {
          teamProgress.readState = buildMentionReadState(
            teamProgress.channelContext.members,
            threads,
            teamProgress.channelContext.activeChannelIds,
          );
        }
        scheduleTeamProgress(teamId);
      };
      const completeTeamPipeline = (
        teamId: string,
        pipeline: MentionLoadPipeline,
      ) => {
        if (!canPublishProgress()) {
          return;
        }
        const teamProgress = teamProgressById.get(teamId);
        if (!teamProgress) {
          return;
        }
        teamProgress.completedPipelines.add(pipeline);
        if (teamProgress.completedPipelines.size === 3) {
          completedTeamIds.add(teamId);
          if (teamProgress.readState) {
            Object.assign(
              completedMentionReadState.channelLastViewedAt,
              teamProgress.readState.channelLastViewedAt,
            );
            Object.assign(
              completedMentionReadState.threadLastViewedAt,
              teamProgress.readState.threadLastViewedAt,
            );
            if (teamProgress.readState.activeChannelIds !== null) {
              if (
                completedMentionReadState.activeChannelIds === null
              ) {
                completedMentionReadState.activeChannelIds =
                  teamProgress.readState.activeChannelIds;
              } else if (
                completedMentionReadState.activeChannelIds !==
                teamProgress.readState.activeChannelIds
              ) {
                completedMentionReadState.activeChannelIds = {
                  ...completedMentionReadState.activeChannelIds,
                  ...teamProgress.readState.activeChannelIds,
                };
              }
            }
          }
          pendingTeamProgressIds.delete(teamId);
          publishTeamProgress(teamId);
          teamProgress.posts = [];
          teamProgress.channelContext = null;
          teamProgress.threadContext = null;
          teamProgress.readState = null;
          return;
        }
        scheduleTeamProgress(teamId);
      };
      setMentionLoadProgress(
        createMentionLoadProgressState(runId, teamIds.length, true),
      );
      setPostState((current) => ({
        ...current,
        status: current.posts.length > 0 ? current.status : "loading",
        error: null,
      }));

      if (
        mentionCacheContext &&
        mentionCacheEntryId &&
        mentionCacheHydratedEntryIdRef.current !== mentionCacheEntryId
      ) {
        mentionCacheHydratedEntryIdRef.current = mentionCacheEntryId;
        const cached = await loadMentionCache(mentionCacheContext);
        if (!canPublishProgress()) {
          return;
        }
        setMentionCacheState(
          cached && cached.posts.length > 0
            ? {
                entryId: mentionCacheEntryId,
                ownerUserId: cached.userId,
                scopeTeamId: cached.scopeTeamId,
                active: true,
                posts: cached.posts.filter(
                  (post) =>
                    !deletedPostIdsRef.current?.has(post.id),
                ),
                readState: cached.readState,
                savedAt: cached.savedAt,
              }
            : createMentionCacheDisplayState(mentionCacheEntryId),
        );
        mentionCacheStoredPostIdsRef.current = new Set(
          cached?.posts.map((post) => post.id) ?? [],
        );
      }

      try {
        await mapInBatches(
          teamIds,
          TEAM_FANOUT_BATCH_SIZE,
          async (teamId) => {
            if (!canPublishProgress()) {
              return;
            }
            await Promise.all([
              (async () => {
                if (!canPublishProgress()) {
                  return;
                }
                try {
                  const posts = await searchPostsInTeam(
                    teamId,
                    mentionSearchTerms,
                    0,
                    MENTIONS_PAGE_SIZE,
                    { isOrSearch: true },
                  );
                  if (!canPublishProgress()) {
                    return;
                  }
                  successfulSearchCount += 1;
                  searchHasMore =
                    searchHasMore ||
                    posts.length === MENTIONS_PAGE_SIZE;
                  searchPosts = mergePosts(
                    posts,
                    searchPosts,
                    MENTIONS_MAX_BUFFER,
                  );
                  appendTeamProgressPosts(teamId, posts);
                } catch (error) {
                  if (firstSearchError === null) {
                    firstSearchError = error;
                  }
                } finally {
                  completeTeamPipeline(teamId, "search");
                }
              })(),
              (async () => {
                if (!canPublishProgress()) {
                  return;
                }
                try {
                  const result = await loadUnreadChannelMentionPosts(
                    teamId,
                    (progress) => {
                      if (progress.type === "context") {
                        setTeamChannelContext(
                          teamId,
                          progress.members,
                          progress.activeChannelIds,
                        );
                      } else {
                        appendTeamProgressPosts(
                          teamId,
                          progress.posts,
                        );
                      }
                    },
                    () => !canPublishProgress(),
                    activeChannelSnapshotPromise,
                  );
                  if (!canPublishProgress()) {
                    return;
                  }
                  unreadChannelPosts = mergePosts(
                    result.posts,
                    unreadChannelPosts,
                    MENTIONS_MAX_BUFFER,
                  );
                  if (
                    !teamProgressById.get(teamId)?.channelContext
                  ) {
                    setTeamChannelContext(
                      teamId,
                      result.members,
                      result.activeChannelIds,
                    );
                  }
                } catch {
                  if (canPublishProgress()) {
                    setTeamChannelContext(teamId, [], null);
                  }
                } finally {
                  completeTeamPipeline(teamId, "channel");
                }
              })(),
              (async () => {
                if (!canPublishProgress()) {
                  return;
                }
                try {
                  const result = await loadUnreadThreadMentionPosts(
                    teamId,
                    (progress) => {
                      if (progress.type === "context") {
                        setTeamThreadContext(
                          teamId,
                          progress.threads,
                        );
                      } else {
                        appendTeamProgressPosts(
                          teamId,
                          progress.posts,
                        );
                      }
                    },
                    () => !canPublishProgress(),
                    activeChannelSnapshotPromise,
                  );
                  if (!canPublishProgress()) {
                    return;
                  }
                  unreadThreadPosts = mergePosts(
                    result.posts,
                    unreadThreadPosts,
                    MENTIONS_MAX_BUFFER,
                  );
                  if (
                    teamProgressById.get(teamId)?.threadContext === null
                  ) {
                    setTeamThreadContext(teamId, result.threads);
                  }
                } catch {
                  if (canPublishProgress()) {
                    setTeamThreadContext(teamId, []);
                  }
                } finally {
                  completeTeamPipeline(teamId, "thread");
                }
              })(),
            ]);
          },
          teamIds.length > TEAM_FANOUT_BATCH_SIZE
            ? TEAM_FANOUT_GAP_MS
            : 0,
          () => !canPublishProgress(),
        );
        if (isCancelled()) {
          cancelTeamProgressFlush();
          return;
        }
        if (progressFlushTimer !== null) {
          window.clearTimeout(progressFlushTimer);
          progressFlushTimer = null;
        }
        flushTeamProgress();

        if (teamIds.length > 0 && successfulSearchCount === 0) {
          throw firstSearchError ?? new Error(text.failedToLoadMentions);
        }

        const rawLatestPosts = mergePosts(
          searchPosts,
          [...unreadChannelPosts, ...unreadThreadPosts],
          MENTIONS_MAX_BUFFER,
        );
        const nextMentionReadState = compactMentionReadState(
          completedMentionReadState,
          [...rawLatestPosts, ...mentionPostsRef.current],
          { preserveActiveChannelIds: true },
        );
        const retainedPostSnapshotById = new Map(
          mentionPostsRef.current.map((post) => [post.id, post]),
        );
        const editedEventsById = new Map(
          postedEventsRef.current
            .filter(
              (event) =>
                event.eventType === "post_edited" &&
                (
                  !column.teamId ||
                  event.teamId === column.teamId ||
                  channelDirectory[event.channelId]?.team_id === column.teamId ||
                  mentionPostsRef.current.some((post) => post.id === event.post.id) ||
                  rawLatestPosts.some((post) => post.id === event.post.id) ||
                  event.channelType === "D" ||
                  event.channelType === "G"
                ),
            )
            .map((event) => [event.post.id, event]),
        );
        const validateEditedPosts = async (
          posts: MattermostPost[],
        ): Promise<MattermostPost[]> => {
          const validated: MattermostPost[] = [];
          for (const post of posts) {
            const editedEvent = editedEventsById.get(post.id);
            const retainedPost = retainedPostSnapshotById.get(post.id);
            if (
              !editedEvent &&
              (
                !retainedPost ||
                !hasMentionRelevantPostChanged(retainedPost, post)
              )
            ) {
              validated.push(post);
              continue;
            }

            const editedPost = editedEvent?.post ?? post;
            if ((editedPost.delete_at ?? 0) > 0) {
              continue;
            }
            let channelType =
              editedEvent?.channelType ??
              channelDirectory[editedPost.channel_id]?.type;
            let channelLookupFailed = false;
            if (!channelType) {
              try {
                channelType = (
                  await getChannelsByIds([editedPost.channel_id])
                )[0]?.type;
              } catch {
                channelLookupFailed = true;
              }
            }
            if (
              editedEvent?.mentionsUser ||
              postMatchesMentionCandidate(
                editedPost,
                channelType,
                resolvedCurrentUserId,
                mentionKeys,
                {
                  channelMetadataAvailable: true,
                  serverCountedChannel: false,
                },
              ) ||
              postMatchesImplicitMention(
                editedPost,
                undefined,
                [],
                {
                  currentUserId: resolvedCurrentUserId,
                  collapsedReplyThreads,
                  commentsNotify,
                },
              )
            ) {
              validated.push(editedPost);
              continue;
            }

            if (channelLookupFailed && retainedPost) {
              // Keep the previous object so its difference from the API post
              // remains detectable and DM/GM classification can retry.
              validated.push(retainedPost);
              continue;
            }

            if (
              !editedPost.root_id ||
              collapsedReplyThreads ||
              (commentsNotify !== "root" && commentsNotify !== "any")
            ) {
              continue;
            }

            try {
              const [rootPosts, threadPosts] = await Promise.all([
                getPostsByIds([editedPost.root_id], {
                  maxAgeMs: MENTION_HISTORY_RECONCILE_CACHE_MS,
                }),
                commentsNotify === "any"
                  ? getPostThreadSince(
                      editedPost.root_id,
                      0,
                      200,
                      MENTION_THREAD_POST_SCAN_LIMIT,
                    )
                  : Promise.resolve([] as MattermostPost[]),
              ]);
              if (postMatchesImplicitMention(
                editedPost,
                rootPosts[0],
                threadPosts,
                {
                  currentUserId: resolvedCurrentUserId,
                  collapsedReplyThreads,
                  commentsNotify,
                },
              )) {
                validated.push(editedPost);
              }
            } catch {
              // A transient context failure must not discard a potentially
              // implicit non-CRT reply; the next poll will retry.
              validated.push(editedPost);
            }
          }
          return validated;
        };
        const latestPosts = await validateEditedPosts(rawLatestPosts);
        if (isCancelled()) {
          return;
        }
        const latestPostIds = new Set(latestPosts.map((post) => post.id));
        const retainedPostsSnapshot = filterActiveMentionPosts(
          mentionPostsRef.current,
          nextMentionReadState,
        ).filter(
          (post) => !deletedPostIdsRef.current?.has(post.id),
        );
        const postsToReconcile = retainedPostsSnapshot.filter(
          (post) => !latestPostIds.has(post.id),
        );
        let reconciledPostIds: Set<string> | null = null;
        let reconciledPostsById: Map<string, MattermostPost> | null = null;
        if (postsToReconcile.length > 0) {
          try {
            const unreadPostIds = new Set(
              filterUnreadMentionPosts(
                postsToReconcile,
                nextMentionReadState,
              ).map((post) => post.id),
            );
            const [unreadReconciledPosts, historyReconciledPosts] = await Promise.all([
              getPostsByIds(
                postsToReconcile
                  .filter((post) => unreadPostIds.has(post.id))
                  .map((post) => post.id),
                {
                  maxAgeMs: Math.min(
                    MENTION_UNREAD_RECONCILE_CACHE_MAX_MS,
                    Math.max(1_000, Math.floor(mentionPollingIntervalMs / 2)),
                  ),
                },
              ),
              getPostsByIds(
                postsToReconcile
                  .filter((post) => !unreadPostIds.has(post.id))
                  .map((post) => post.id),
                { maxAgeMs: MENTION_HISTORY_RECONCILE_CACHE_MS },
              ),
            ]);
            if (isCancelled()) {
              return;
            }
            const reconciledPosts = await validateEditedPosts(
              [...unreadReconciledPosts, ...historyReconciledPosts].filter(
                (post) => (post.delete_at ?? 0) === 0,
              ),
            );
            reconciledPostIds = new Set(postsToReconcile.map((post) => post.id));
            reconciledPostsById = new Map(
              reconciledPosts.map((post) => [post.id, post]),
            );
          } catch {
            // Keep the bounded local history if reconciliation is temporarily
            // unavailable. Active channel filtering and WebSocket deletions
            // still remove known-invalid entries.
          }
        }
        if (isCancelled()) {
          return;
        }
        setMentionReadState(nextMentionReadState);
        void ensureUsers([
          ...latestPosts,
          ...(reconciledPostsById?.values() ?? []),
        ].map((post) => post.user_id));
        setPostState((current) => ({
          status: "ready",
          posts: mergePosts(
            latestPosts.filter(
              (post) => !deletedPostIdsRef.current?.has(post.id),
            ),
            filterActiveMentionPosts(
              current.posts,
              nextMentionReadState,
            ).flatMap((post) => {
              if (deletedPostIdsRef.current?.has(post.id)) {
                return [];
              }
              if (!reconciledPostIds || !reconciledPostsById) {
                return [post];
              }
              if (!reconciledPostIds.has(post.id)) {
                return [post];
              }
              const reconciledPost = reconciledPostsById.get(post.id);
              return reconciledPost ? [reconciledPost] : [];
            }),
            MENTIONS_MAX_BUFFER,
          ),
          error: null,
          nextPage: 1,
          hasMore: searchHasMore,
          loadingMore: false,
        }));
        setMentionCacheState(
          createMentionCacheDisplayState(mentionCacheEntryId),
        );
        cancelTeamProgressFlush();
        setMentionLoadProgress((current) =>
          current.runId === runId
            ? createMentionLoadProgressState(runId)
            : current,
        );
        setHasCompletedInitialLoad(true);
        mentionCacheSaveEntryIdRef.current = mentionCacheEntryId;
        setMentionCacheSaveVersion((current) => current + 1);
        finishRefresh();
      } catch (error) {
        cancelTeamProgressFlush();
        if (isCancelled()) {
          return;
        }
        setPostState((current) => ({
          status: "error",
          posts: current.posts,
          error: getLocalizedApiErrorMessage(error, text.failedToLoadMentions),
          nextPage: current.nextPage,
          hasMore: current.hasMore,
          loadingMore: false,
        }));
        setMentionLoadProgress((current) =>
          current.runId === runId
            ? createMentionLoadProgressState(runId)
            : current,
        );
        setHasCompletedInitialLoad(true);
        finishRefresh();
      }
    },
    mentionPollingIntervalMs,
    {
      enabled: teamIds.length > 0 && Boolean(currentUserId) && Boolean(mentionSearchTerms),
      paused,
      onDisabled: () => {
        mentionLoadRunIdRef.current += 1;
        setHasCompletedInitialLoad(false);
        setPostState({
          status: "idle",
          posts: [],
          error: null,
          nextPage: 1,
          hasMore: false,
          loadingMore: false,
        });
        setMentionReadState({
          channelLastViewedAt: {},
          threadLastViewedAt: {},
          activeChannelIds: null,
        });
        setMentionLoadProgress(
          createMentionLoadProgressState(mentionLoadRunIdRef.current),
        );
        setMentionCacheState(
          createMentionCacheDisplayState(mentionCacheEntryId),
        );
        setMentionDisplaySnapshot(null);
        setSuppressAppliedMentionNotifications(false);
        finishRefresh();
      },
      dependencies: [
        column.teamId,
        currentUserId,
        ensureUsers,
        finishRefresh,
        loadUnreadChannelMentionPosts,
        loadUnreadThreadMentionPosts,
        mentionPollingIntervalMs,
        mentionCacheContext,
        mentionCacheEntryId,
        mentionSearchTerms,
        paused,
        readRefreshNonce,
        reconnectNonce,
        mentionReconcileNonce,
        refreshNonce,
        teamIds,
        username,
      ],
    },
  );

  useEffect(() => {
    if (
      mentionCacheSaveVersion === 0 ||
      !mentionCacheContext ||
      !mentionCacheEntryId ||
      mentionCacheSaveEntryIdRef.current !== mentionCacheEntryId ||
      postState.status !== "ready"
    ) {
      return;
    }

    let cancelled = false;
    const savedAt = Date.now();
    const posts = postState.posts.filter(
      (post) => !deletedPostIdsRef.current?.has(post.id),
    );
    const readState = applyMentionReadMarkers(
      mentionReadState,
      realtimeReadMarkers,
    );
    // Track the in-flight snapshot synchronously. If an edit or deletion
    // arrives before storage.set resolves, the queued cache removal must
    // still run after this write and invalidate the stale snapshot.
    mentionCacheStoredPostIdsRef.current = new Set(
      posts.map((post) => post.id),
    );
    void saveMentionCache(
      mentionCacheContext,
      posts,
      readState,
      savedAt,
    ).then(() => {
      if (!cancelled) {
        setMentionCacheLastSavedAt(savedAt);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    mentionCacheEntryId,
    mentionCacheSaveVersion,
  ]);

  useEffect(() => {
    const processedEvents = processedMentionPostedEventsRef.current;
    if (!processedEvents) {
      return;
    }
    const knownPostIds = new Set([
      ...mentionPostsRef.current.map((post) => post.id),
      ...mentionCacheState.posts.map((post) => post.id),
      ...(mentionDisplaySnapshot?.posts.map((post) => post.id) ?? []),
    ]);
    const scopedEvents = takeScopedMentionPostedEvents(
      postedEvents,
      processedEvents,
      {
        columnTeamId: column.teamId,
        channelDirectory,
        knownPostIds,
      },
    );
    if (scopedEvents.length === 0) {
      return;
    }

    const matchingEvents = scopedEvents.filter((event) => event.mentionsUser);
    const editedPostIds = new Set(
      scopedEvents
        .filter(
          (event) =>
            event.eventType === "post_edited" &&
            (event.mentionsUser || knownPostIds.has(event.post.id)),
        )
        .map((event) => event.post.id),
    );
    if (matchingEvents.length === 0 && editedPostIds.size === 0) {
      return;
    }
    const activeRealtimePosts = filterActiveMentionPosts(
      matchingEvents.map((event) => event.post),
      effectiveMentionReadState,
    );
    const realtimePosts = column.unreadOnly
      ? filterUnreadMentionPosts(
          activeRealtimePosts,
          effectiveMentionReadState,
        )
      : activeRealtimePosts;
    if (activeRealtimePosts.length > 0) {
      void ensureUsers(Array.from(new Set(activeRealtimePosts.map((post) => post.user_id))));
    }
    if (editedPostIds.size > 0) {
      // Apply only edits that already belong to this feed or now match it.
      // Ambiguous thread replies are reconciled separately with bounded
      // thread context.
      setSuppressAppliedMentionNotifications(true);
    }
    const mergeRealtimePosts = (
      currentPosts: MattermostPost[],
      incomingPosts: MattermostPost[],
    ) =>
      mergePosts(
        incomingPosts,
        currentPosts.filter((post) => !editedPostIds.has(post.id)),
        MENTIONS_MAX_BUFFER,
      );
    setPostState((current) => ({
      ...current,
      status: "ready",
      error: null,
      posts: mergeRealtimePosts(current.posts, activeRealtimePosts),
    }));
    setMentionCacheState((current) => ({
      ...current,
      posts: mergeRealtimePosts(current.posts, activeRealtimePosts),
    }));
    setMentionLoadProgress((current) => ({
      ...current,
      posts: mergeRealtimePosts(current.posts, activeRealtimePosts),
    }));
    setMentionDisplaySnapshot((current) =>
      current
        ? {
            ...current,
            posts: mergeRealtimePosts(current.posts, realtimePosts),
            deferredPostIds: current.deferredPostIds.filter(
              (postId) => !editedPostIds.has(postId),
            ),
          }
        : current
    );
    if (realtimePosts.length === 0) {
      return;
    }

    // A genuine WebSocket mention must retain PostList's normal new-post
    // affordance even if a read-marker update just finished in the same turn.
    setSuppressAppliedMentionNotifications(false);
    // Realtime events are genuine new activity, so keep them immediate even
    // while a background scan result is waiting for explicit application.
  }, [
    channelDirectory,
    column.teamId,
    column.unreadOnly,
    effectiveMentionReadState,
    ensureUsers,
    mentionCacheState.posts,
    mentionDisplaySnapshot?.posts,
    postedEvents,
  ]);

  useEffect(() => {
    if (deletedPostIds.length === 0) {
      return;
    }
    const deletionKey = `${mentionCacheEntryId ?? ""}:${deletedPostIds.join(",")}`;
    if (processedMentionDeletionKeyRef.current === deletionKey) {
      return;
    }
    processedMentionDeletionKeyRef.current = deletionKey;
    const deletedPostIdSet = new Set(deletedPostIds);
    const removesInMemoryPost =
      mentionPostsRef.current.some((post) => deletedPostIdSet.has(post.id)) ||
      mentionLoadProgress.posts.some((post) =>
        deletedPostIdSet.has(post.id)
      ) ||
      mentionCacheState.posts.some((post) =>
        deletedPostIdSet.has(post.id)
      ) ||
      Boolean(
        mentionDisplaySnapshot?.posts.some((post) =>
          deletedPostIdSet.has(post.id)
        ),
      );
    const invalidatesStoredCache =
      mentionCacheState.posts.some((post) =>
        deletedPostIdSet.has(post.id)
      ) ||
      [...mentionCacheStoredPostIdsRef.current].some((postId) =>
        deletedPostIdSet.has(postId)
      );
    if (removesInMemoryPost) {
      setSuppressAppliedMentionNotifications(true);
      setPostState((current) => {
        const posts = current.posts.filter((post) =>
          !deletedPostIdSet.has(post.id)
        );
        return posts.length === current.posts.length
          ? current
          : { ...current, posts };
      });
      setMentionLoadProgress((current) => {
        const posts = current.posts.filter(
          (post) => !deletedPostIdSet.has(post.id),
        );
        return posts.length === current.posts.length
          ? current
          : { ...current, posts };
      });
      setMentionCacheState((current) => {
        const posts = current.posts.filter(
          (post) => !deletedPostIdSet.has(post.id),
        );
        return posts.length === current.posts.length
          ? current
          : { ...current, posts };
      });
      setMentionDisplaySnapshot((current) => {
        if (!current) {
          return current;
        }
        const posts = current.posts.filter(
          (post) => !deletedPostIdSet.has(post.id),
        );
        if (posts.length === current.posts.length) {
          return current;
        }
        return {
          ...current,
          posts,
          deferredPostIds: current.deferredPostIds.filter(
            (postId) => !deletedPostIdSet.has(postId),
          ),
        };
      });
    }
    if (invalidatesStoredCache && mentionCacheContext) {
      mentionCacheStoredPostIdsRef.current = new Set();
      void removeMentionCache(mentionCacheContext);
    }
  }, [
    deletedPostIds,
    mentionCacheEntryId,
    mentionCacheContext,
  ]);

  useEffect(() => {
    const editedPostIds = new Set(
      postedEvents
        .filter((event) => event.eventType === "post_edited")
        .map((event) => event.post.id),
    );
    if (
      editedPostIds.size === 0 ||
      !mentionCacheState.posts.some((post) =>
        editedPostIds.has(post.id)
      ) &&
      ![...mentionCacheStoredPostIdsRef.current].some((postId) =>
        editedPostIds.has(postId)
      )
    ) {
      return;
    }
    setMentionCacheState((current) => ({
      ...current,
      posts: current.posts.filter(
        (post) => !editedPostIds.has(post.id),
      ),
    }));
    if (mentionCacheContext) {
      mentionCacheStoredPostIdsRef.current = new Set();
      void removeMentionCache(mentionCacheContext);
    }
  }, [
    mentionCacheContext,
    mentionCacheState.posts,
    postedEvents,
  ]);

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
        const channels = await getChannelsByIds(missingChannelIds);
        if (cancelled) {
          return;
        }

        setChannelDirectory((current) => {
          const next = { ...current };
          for (const channel of channels) {
            delete next[channel.id];
            next[channel.id] = channel;
          }
          const channelIds = Object.keys(next);
          while (
            channelIds.length >
            MENTION_METADATA_DIRECTORY_MAX_ENTRIES
          ) {
            const oldestChannelId = channelIds.shift();
            if (!oldestChannelId) {
              break;
            }
            delete next[oldestChannelId];
          }
          return next;
        });

        const dmChannels = channels.filter((channel) => channel.type === "D" || channel.type === "G");
        if (dmChannels.length === 0) {
          return;
        }

        const nextMemberDirectory: Record<string, string[]> = {};
        for (const channel of dmChannels) {
          if (channel.type === "D") {
            nextMemberDirectory[channel.id] = parseDmChannelUserIds(channel);
          }
        }

        const groupChannels = dmChannels.filter((channel) => channel.type === "G");
        if (groupChannels.length > 0) {
          const groupEntries = await Promise.all(
            groupChannels.map(async (channel) => ({
              channelId: channel.id,
              userIds: (await getChannelMembers(channel.id)).map((m) => m.user_id),
            })),
          );
          if (cancelled) {
            return;
          }
          for (const entry of groupEntries) {
            nextMemberDirectory[entry.channelId] = entry.userIds;
          }
        }

        setMemberDirectory((current) => {
          const next = { ...current };
          for (const [channelId, userIds] of Object.entries(
            nextMemberDirectory,
          )) {
            delete next[channelId];
            next[channelId] = userIds;
          }
          const channelIds = Object.keys(next);
          while (
            channelIds.length >
            MENTION_METADATA_DIRECTORY_MAX_ENTRIES
          ) {
            const oldestChannelId = channelIds.shift();
            if (!oldestChannelId) {
              break;
            }
            delete next[oldestChannelId];
          }
          return next;
        });
        void ensureUsers(Object.values(nextMemberDirectory).flat());
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
        // Keep the metadata line box stable while channel details are loading.
        // Otherwise the late label changes every card's height and moves the
        // scroll anchor during mention-cache revalidation.
        return <PendingPostMeta />;
      }

      const channelLabel = getChannelLabel(channel, userDirectory, memberDirectory, null);
      if (channel.type === "D" || channel.type === "G") {
        const kindLabel = getChannelKindLabel(channel);
        return channel.type === "G" ? `${text.groupDirectMessage} / ${channelLabel}` : `${text.directMessage} / ${channelLabel}`;
      }

      const teamLabel = channel.team_id ? teamDirectory[channel.team_id]?.display_name || teamDirectory[channel.team_id]?.name : null;
      return teamLabel ? `${channelLabel} / ${teamLabel}` : channelLabel;
    },
    [channelDirectory, memberDirectory, teamDirectory, userDirectory],
  );

  const handleLoadMore = async () => {
    if (teamIds.length === 0 || !currentUser || !mentionSearchTerms || postState.loadingMore || !postState.hasMore) {
      return;
    }

    setPostState((current) => ({ ...current, loadingMore: true, error: null }));

    try {
      let posts: MattermostPost[] = [];
      let hasFullPage = false;
      await Promise.all([
        mapInBatches(
          teamIds,
          TEAM_FANOUT_BATCH_SIZE,
          async (teamId) => {
            const teamPosts = await searchPostsInTeam(
              teamId,
              mentionSearchTerms,
              postState.nextPage,
              MENTIONS_PAGE_SIZE,
              { isOrSearch: true },
            );
            hasFullPage =
              hasFullPage ||
              teamPosts.length === MENTIONS_PAGE_SIZE;
            posts = mergePosts(
              teamPosts,
              posts,
              MENTIONS_MAX_BUFFER,
            );
          },
          teamIds.length > TEAM_FANOUT_BATCH_SIZE ? TEAM_FANOUT_GAP_MS : 0,
        ),
        new Promise((resolve) => window.setTimeout(resolve, MIN_LOAD_MORE_MS)),
      ]);
      void ensureUsers(posts.map((post) => post.user_id));
      setPostState((current) => ({
        status: "ready",
        posts: mergePosts(current.posts, posts, MENTIONS_MAX_BUFFER),
        error: null,
        nextPage: current.nextPage + 1,
        hasMore:
          hasFullPage &&
          current.posts.length + posts.length < MENTIONS_MAX_BUFFER,
        loadingMore: false,
      }));
    } catch (error) {
      setPostState((current) => ({
        ...current,
        status: "error",
        error: getLocalizedApiErrorMessage(error, text.failedToLoadMentions),
        loadingMore: false,
      }));
    }
  };

  useEffect(() => {
    if (!__MATTERMOST_DECK_E2E_DEBUG__ || !isDebugEnabled()) {
      return;
    }

    window.__mattermostDeckDebugColumnState ??= {};
    window.__mattermostDeckDebugColumnState[column.id] = {
      type: "mentions",
      postStatus: postState.status,
      postIds: postState.posts.map((post) => post.id),
      postMessages: postState.posts.map((post) => post.message),
      displayedPostIds: displayedPosts.map((post) => post.id),
      displayedPostMessages: displayedPosts.map((post) => post.message),
      visiblePostIds: visiblePosts.map((post) => post.id),
      visiblePostMessages: visiblePosts.map((post) => post.message),
      channelLastViewedAt: effectiveMentionReadState.channelLastViewedAt,
      threadLastViewedAt: effectiveMentionReadState.threadLastViewedAt,
      mentionCount,
      mentionLoadActive: mentionLoadProgress.active,
      mentionLoadCompletedTeams: mentionLoadProgress.completedTeams,
      mentionLoadTotalTeams: mentionLoadProgress.totalTeams,
      mentionBufferedPostIds: mentionLoadProgress.posts.map(
        (post) => post.id,
      ),
      mentionBufferedPostMessages: mentionLoadProgress.posts.map(
        (post) => post.message,
      ),
      mentionUpdatePending:
        Boolean(mentionDisplaySnapshot) &&
        !mentionLoadProgress.active &&
        pendingMentionUpdateCount > 0,
      mentionPendingUpdateCount: pendingMentionUpdateCount,
      mentionDisplaySnapshotRunId:
        mentionDisplaySnapshot?.runId ?? null,
      mentionRefreshPhase: mentionLoadProgress.active
        ? "loading"
        : mentionDisplaySnapshot && pendingMentionUpdateCount > 0
          ? "pending"
          : "ready",
      provisionalPostIds: Array.from(provisionalPostIds),
      cachedPostIds: Array.from(cachedPostIds),
      mentionCacheActive: mentionCacheActiveForContext,
      mentionCacheSavedAt: mentionCacheState.savedAt,
      mentionCacheLastSavedAt,
      mentionNotificationsSuppressed:
        suppressMentionNewPostNotifications,
      mentionCachePhase: mentionCacheActiveForContext
        ? mentionLoadProgress.active
          ? "revalidating"
          : "stale"
        : mentionLoadProgress.active
          ? "miss"
          : hasCompletedInitialLoad
            ? "ready"
            : "idle",
      teamId: column.teamId,
    };

    return () => {
      if (window.__mattermostDeckDebugColumnState) {
        delete window.__mattermostDeckDebugColumnState[column.id];
      }
    };
  }, [
    column.id,
    column.teamId,
    cachedPostIds,
    hasCompletedInitialLoad,
    mentionCount,
    effectiveMentionReadState.channelLastViewedAt,
    effectiveMentionReadState.threadLastViewedAt,
    displayedPosts,
    mentionLoadProgress.active,
    mentionLoadProgress.completedTeams,
    mentionLoadProgress.posts,
    mentionLoadProgress.totalTeams,
    mentionDisplaySnapshot,
    pendingMentionUpdateCount,
    mentionCacheLastSavedAt,
    mentionCacheActiveForContext,
    mentionCacheState.savedAt,
    postState.posts,
    postState.status,
    provisionalPostIds,
    suppressMentionNewPostNotifications,
    visiblePosts,
  ]);

  return (
    <section
      ref={setSectionNode}
      className={`deck-column deck-column--mentions${isFocusedPane ? " deck-column--pane-focused" : ""}`}
      style={getColumnAccentStyle(column.type, columnColors)}
      data-deck-column-id={column.id}
    >
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2
            title={text.addMentions}
            tabIndex={-1}
            data-deck-mention-apply-focus="true"
          >
            <span className="deck-title-with-icon">
              <ColumnTypeBadge type="mentions" />
              <span>{text.addMentions}</span>
            </span>
          </h2>
          {mentionLoadProgress.active ? (
            <ColumnLoadingProgress
              title={
                mentionCacheActiveForContext
                  ? text.refreshingMentions
                  : text.loadingMentions
              }
              detail={
                mentionCacheActiveForContext
                  ? text.refreshingCachedMentionsProgress(
                      visiblePosts.length,
                      mentionLoadProgress.completedTeams,
                      mentionLoadProgress.totalTeams,
                    )
                  : text.loadingMentionsProgress(
                      visiblePosts.length,
                      mentionLoadProgress.completedTeams,
                      mentionLoadProgress.totalTeams,
                    )
              }
              announcement={
                visiblePosts.length > 0 &&
                (!hasCompletedInitialLoad || isRefreshing)
                  ? text.loadingMentionsTeamsProgress(
                      mentionLoadProgress.completedTeams,
                      mentionLoadProgress.totalTeams,
                    )
                  : undefined
              }
              completed={mentionLoadProgress.completedTeams}
              total={mentionLoadProgress.totalTeams}
            />
          ) : mentionDisplaySnapshot &&
            pendingMentionUpdateCount > 0 ? (
            <div className="deck-mention-updates">
              <button
                type="button"
                className="deck-mention-updates-button"
                data-update-count={pendingMentionUpdateCount}
                onClick={handleApplyMentionUpdates}
                aria-controls={mentionPostListId}
              >
                <span className="deck-mention-updates-button-label">
                  {text.showMentionUpdates(
                    pendingMentionUpdateCount,
                  )}
                </span>
              </button>
              <span
                className="deck-sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {text.mentionUpdatesAvailable(
                  pendingMentionUpdateCount,
                )}
              </span>
            </div>
          ) : (
            <p title={selectedTeam ? selectedTeam.display_name || selectedTeam.name : text.allTeams}>
              {selectedTeam ? selectedTeam.display_name || selectedTeam.name : text.allTeams}
            </p>
          )}
        </div>
        <div className="deck-column-actions">
          <div className="deck-badge" title={text.mentionBadge(mentionCount, Boolean(column.teamId))}>
            {mentionCount}
          </div>
          {isFocusedPane ? (
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost deck-icon-button--active"
              title={text.exitFocus}
              aria-label={text.exitFocus}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active />
            </button>
          ) : null}
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            aria-label={showControls ? text.collapseControls("mentions") : text.expandControls("mentions")}
          >
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>

      {showControls ? (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-inline-actions">
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveLeft} onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveRight} onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              title={text.refresh}
              onClick={() => {
                startRefresh();
                setRefreshNonce((current) => current + 1);
              }}
              disabled={isRefreshing}
            >
              <RefreshIcon spinning={isRefreshing} />
            </button>
            <button
              type="button"
              className={`deck-icon-button deck-icon-button--ghost${paused ? " deck-icon-button--active" : ""}`}
              onClick={() => setPaused((v) => !v)}
              title={paused ? text.resumePolling : text.pausePolling}
              aria-label={paused ? text.resumePolling : text.pausePolling}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              type="button"
              className={`deck-icon-button deck-icon-button--ghost${isFocusedPane ? " deck-icon-button--active" : ""}`}
              title={isFocusedPane ? text.exitFocus : text.focusPane}
              aria-label={isFocusedPane ? text.exitFocus : text.focusPane}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active={isFocusedPane} />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.removeColumn} onClick={() => onRemove(column.id)}>
              <CloseIcon />
            </button>
          </div>
          <div className="deck-controls">
            <label className="deck-field">
              <span>{text.teamLabel}</span>
              <CustomSelect
                options={teamOptions}
                value={column.teamId ?? ""}
                placeholder={text.allTeams}
                onChange={(teamId) => onUpdate(column.id, { teamId: teamId || undefined })}
              />
            </label>
            <label className="deck-toggle">
              <input
                type="checkbox"
                checked={Boolean(column.unreadOnly)}
                onChange={(event) => onUpdate(column.id, { unreadOnly: event.currentTarget.checked })}
              />
              <span>{text.unreadOnly}</span>
            </label>
          </div>

          <article className="deck-card deck-card--muted">
            <strong>{text.scope}</strong>
            <p>{selectedTeam ? selectedTeam.display_name || selectedTeam.name : text.allTeams}</p>
          </article>
          <article className="deck-card deck-card--muted">
          <strong>{text.addMentions}</strong>
            <p>{text.mentionBadge(mentionCount, Boolean(column.teamId))}</p>
          </article>
          {column.unreadOnly ? (
            <article className="deck-card deck-card--muted">
              <strong>{text.unreadOnly}</strong>
              <p>{text.unreadOnlyNote}</p>
            </article>
          ) : null}
          {!column.teamId ? (
            <article className="deck-card">
              <strong>{text.allTeams}</strong>
              <p>{text.allTeamsNote}</p>
            </article>
          ) : null}
        </div>
      ) : null}

      {postState.status === "error" &&
      !mentionLoadProgress.active &&
      visiblePosts.length === 0 ? (
        <PaneErrorState
          title={text.failedToLoadMentions}
          error={postState.error ?? text.unknownError}
          onRetry={() => {
            setPaused(false);
            startRefresh();
            setRefreshNonce((current) => current + 1);
          }}
        />
      ) : shouldShowLoadingState ? (
        <ColumnLoadingState
          title={text.loadingMentions}
          detail={text.loadingMentionsProgress(
            visiblePosts.length,
            mentionLoadProgress.completedTeams,
            mentionLoadProgress.totalTeams || teamIds.length,
          )}
        />
      ) : (
        <>
          {postState.status === "error" &&
          !mentionLoadProgress.active &&
          visiblePosts.length > 0 ? (
            <PaneErrorState
              title={text.failedToLoadMentions}
              detail={text.showingCachedMentions}
              error={postState.error ?? text.unknownError}
              muted
              onRetry={() => {
                setPaused(false);
                startRefresh();
                setRefreshNonce((current) => current + 1);
              }}
            />
          ) : null}
          {visiblePosts.length === 0 &&
          !mentionLoadProgress.active &&
          !mentionDisplaySnapshot ? (
            <article className="deck-card">
              <strong>{text.noMentions}</strong>
              <p>{column.unreadOnly ? text.noUnreadMentions : text.mentionsWillAppear}</p>
            </article>
          ) : visiblePosts.length > 0 || mentionDisplaySnapshot ? (
            <PostList
              posts={visiblePosts}
              userDirectory={userDirectory}
              compactMode={compactMode}
              hasMore={postState.hasMore}
              loadingMore={postState.loadingMore}
              onLoadMore={handleLoadMore}
              renderMeta={renderPostMeta}
              onOpenPost={(post) => {
                const channel = channelDirectory[post.channel_id];
                const teamId = channel?.team_id;
                onOpenPost(post, {
                  teamName: teamId ? teamDirectory[teamId]?.name : selectedTeam?.name,
                  channelName: channel?.name,
                });
              }}
              postClickAction={postClickAction}
              showImagePreviews={showImagePreviews}
              language={language}
              reversedPostOrder={reversedPostOrder}
              highlightTerms={highlightTerms}
              currentUserId={currentUserId}
              lastViewedAt={mentionsLastReadAt}
              onMarkRead={handleMarkRead}
              unreadSeparatorLabel={text.unreadSeparatorLabel}
              markReadLabel={text.markRead}
              jumpToLatestLabel={text.jumpToLatest}
              newPostsLabel={text.newPosts}
              suppressEndState={
                mentionLoadProgress.active ||
                mentionCacheActiveForContext ||
                Boolean(mentionDisplaySnapshot)
              }
              suppressNewPostNotifications={
                suppressMentionNewPostNotifications
              }
              deferredPostIds={visibleDeferredMentionPostIds}
              busy={mentionLoadProgress.active}
              listId={mentionPostListId}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function useRuntimePerformanceSnapshot(
  enabled: boolean,
): RuntimePerformanceSnapshot {
  const [snapshot, setSnapshot] = useState<RuntimePerformanceSnapshot>(() => {
    const api = getApiPerformanceSnapshot();
    const diagnostics = getDeckDiagnosticsSnapshot();
    const memory = "memory" in performance ? (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory : undefined;
    const memoryUsedMb = memory ? memory.usedJSHeapSize / (1024 * 1024) : null;
    const memoryLimitMb = memory ? memory.jsHeapSizeLimit / (1024 * 1024) : null;
    return {
      domNodeCount: document.getElementsByTagName("*").length,
      memoryUsedMb,
      memoryLimitMb,
      memoryUsageRatio: memory && memory.jsHeapSizeLimit > 0 ? memory.usedJSHeapSize / memory.jsHeapSizeLimit : null,
      api,
      diagnostics,
    };
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const collect = () => {
      const api = getApiPerformanceSnapshot();
      const diagnostics = getDeckDiagnosticsSnapshot();
      const performanceWithMemory = performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      };
      const memory = performanceWithMemory.memory;
      const memoryUsedMb = memory ? memory.usedJSHeapSize / (1024 * 1024) : null;
      const memoryLimitMb = memory ? memory.jsHeapSizeLimit / (1024 * 1024) : null;

      setSnapshot({
        domNodeCount: document.getElementsByTagName("*").length,
        memoryUsedMb,
        memoryLimitMb,
        memoryUsageRatio: memory && memory.jsHeapSizeLimit > 0 ? memory.usedJSHeapSize / memory.jsHeapSizeLimit : null,
        api,
        diagnostics,
      });
    };

    collect();
    const timer = window.setInterval(collect, 2_000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return snapshot;
}

function ChannelWatchColumn({
  column,
  mode,
  currentUsername,
  currentUserId,
  currentTeamId,
  currentChannelId,
  currentTeamLabel,
  currentChannelLabel,
  realtimeEnabled,
  teams,
  userDirectory,
  ensureUsers,
  postedEvents,
  reconnectNonce,
  pollingIntervalSeconds,
  canMoveLeft,
  canMoveRight,
  onMove,
  onAddColumn,
  onRememberTarget,
  onUpdate,
  onRemove,
  onOpenPost,
  postClickAction,
  compactMode,
  columnColors,
  showImagePreviews,
  language,
  reversedPostOrder,
  highlightKeywords,
  isFocusedPane,
  onToggleFocus,
}: {
  column: DeckColumn;
  mode: "channel" | "dm";
  currentUsername: string | null;
  currentUserId: string | null;
  currentTeamId?: string;
  currentChannelId?: string;
  currentTeamLabel?: string | null;
  currentChannelLabel?: string | null;
  realtimeEnabled: boolean;
  teams: MattermostTeam[];
  userDirectory: Record<string, MattermostUser>;
  ensureUsers: (userIds: string[]) => Promise<void>;
  postedEvents: PostedEvent[];
  reconnectNonce: number;
  pollingIntervalSeconds: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (id: string, direction: "left" | "right") => void;
  onAddColumn: (type: DeckColumnType, defaults?: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>) => string;
  onRememberTarget: (target: RecentChannelTarget) => void;
  onUpdate: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>) => void;
  onRemove: (id: string) => void;
  onOpenPost: (post: MattermostPost, target?: OpenPostTarget) => void;
  postClickAction: PostClickAction;
  compactMode: boolean;
  columnColors: ColumnColorSettings;
  showImagePreviews: boolean;
  language: DeckLanguage;
  reversedPostOrder: boolean;
  highlightKeywords: string;
  isFocusedPane: boolean;
  onToggleFocus: (id: string) => void;
}): React.JSX.Element {
  const text = useAppText();
  const [channelState, setChannelState] = useState<ChannelState>({ status: "idle", channels: [], error: null });
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
  const { isRefreshing, startRefresh, finishRefresh } = useRefreshIndicator();
  const [paused, setPaused] = useState(false);
  const [lastViewedAt, setLastViewedAt] = useState<number | null>(null);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
  const [sectionNode, setSectionNode] = useState<HTMLElement | null>(null);
  const hasConfiguredTarget = mode === "dm" ? Boolean(column.channelId) : Boolean(column.teamId && column.channelId);
  const shouldShowLoadingState =
    hasConfiguredTarget &&
    postState.posts.length === 0 &&
    (postState.status === "idle" || postState.status === "loading") &&
    !hasCompletedInitialLoad;
  const isPaneVisible = useElementVisibility(sectionNode, { rootMargin: "600px 0px", defaultVisible: true });
  const [showControls, setShowControls] = useState(!hasConfiguredTarget);
  const markReadFiredRef = useRef(false);
  const teamDirectory = useMemo(() => Object.fromEntries(teams.map((team) => [team.id, team])), [teams]);
  const selectedTeam = column.teamId ? teamDirectory[column.teamId] : undefined;

  useEffect(() => {
    setHasCompletedInitialLoad(false);
    setPostState({
      status: "idle",
      posts: [],
      error: null,
      nextPage: 1,
      hasMore: false,
      loadingMore: false,
    });
  }, [mode, column.teamId, column.channelId]);

  useEffect(() => {
    if (isFocusedPane) {
      setShowControls(false);
    }
  }, [isFocusedPane]);

  useEffect(() => {
    setShowControls(mode === "dm" ? !column.channelId : !(column.teamId && column.channelId));
  }, [column.channelId, column.teamId, mode]);

  useEffect(() => {
    let cancelled = false;

    if (mode === "channel" && !column.teamId) {
      setChannelState({ status: "idle", channels: [], error: null });
      setPostState({
        status: "idle",
        posts: [],
        error: null,
        nextPage: 1,
        hasMore: false,
        loadingMore: false,
      });
      finishRefresh();
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setChannelState((current) => ({ ...current, status: "loading", error: null }));
      try {
        const channels =
          mode === "dm"
            ? (await getDirectChannelsForCurrentUser()).filter(isDirectMessageChannel)
            : (await getChannelsForCurrentUser(column.teamId as string)).filter(isStandardChannel);
        if (cancelled) {
          return;
        }

        if (mode === "dm") {
          const nextMemberDirectory: Record<string, string[]> = {};
          for (const channel of channels) {
            if (channel.type === "D") {
              nextMemberDirectory[channel.id] = parseDmChannelUserIds(channel);
            }
          }

          const groupChannels = channels.filter((channel) => channel.type === "G");
          if (groupChannels.length > 0) {
            const groupEntries = await Promise.all(
              groupChannels.map(async (channel) => ({
                channelId: channel.id,
                userIds: (await getChannelMembers(channel.id)).map((m) => m.user_id),
              })),
            );
            if (cancelled) {
              return;
            }
            for (const entry of groupEntries) {
              nextMemberDirectory[entry.channelId] = entry.userIds;
            }
          }

          setMemberDirectory(nextMemberDirectory);
          void ensureUsers(Object.values(nextMemberDirectory).flat());
        }

        setChannelState({ status: "ready", channels, error: null });
        if (column.channelId && !channels.some((channel) => channel.id === column.channelId)) {
          onUpdate(column.id, { channelId: undefined });
        }
        finishRefresh();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setChannelState({
          status: "error",
          channels: [],
          error: getLocalizedApiErrorMessage(error, text.failedToLoadChannels),
        });
        finishRefresh();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    column.channelId,
    column.id,
    column.teamId,
    ensureUsers,
    finishRefresh,
    mode,
    onUpdate,
    reconnectNonce,
    refreshNonce,
  ]);

  // Fetch lastViewedAt for the channel
  useEffect(() => {
    if (!column.channelId) {
      setLastViewedAt(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const member = await getMyChannelMember(column.channelId as string);
        if (!cancelled) {
          setLastViewedAt(member.last_viewed_at ?? null);
        }
      } catch {
        // ignore - lastViewedAt stays null
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [column.channelId, reconnectNonce]);

  const handleMarkRead = useCallback(() => {
    const channelId = column.channelId;
    if (!channelId) return;
    markReadFiredRef.current = true;
    const optimisticAt = Date.now();
    setLastViewedAt(optimisticAt);
    void (async () => {
      try {
        await viewChannel(channelId);
        const member = await getMyChannelMember(channelId);
        setLastViewedAt(member.last_viewed_at ?? optimisticAt);
      } catch {
        markReadFiredRef.current = false;
      }
    })();
  }, [column.channelId]);

  const channelOptions = useMemo<CustomSelectOption[]>(
    () =>
      channelState.channels.map((channel) => ({
        value: channel.id,
        label: getChannelLabel(channel, userDirectory, memberDirectory, currentUserId),
      })),
    [channelState.channels, currentUserId, memberDirectory, userDirectory],
  );

  const selectedChannel = useMemo(
    () => channelState.channels.find((entry) => entry.id === column.channelId),
    [channelState.channels, column.channelId],
  );
  const selectedChannelLabel = selectedChannel
    ? getChannelLabel(selectedChannel, userDirectory, memberDirectory, currentUserId)
    : undefined;
  const selectedChannelKindLabel = getChannelKindLabel(selectedChannel);
  const selectedTeamLabel = selectedTeam ? selectedTeam.display_name || selectedTeam.name : undefined;
  const highlightTerms = useMemo(() => resolveHighlightTerms(highlightKeywords, currentUsername), [currentUsername, highlightKeywords]);
  const canWatchCurrentChannel = Boolean(currentChannelId) && (mode === "dm" || Boolean(currentTeamId));
  const currentWatchLabel = currentChannelLabel ?? (mode === "dm" ? text.directMessage : text.channelLabel);

  useEffect(() => {
    if (!selectedChannel) {
      return;
    }
    onRememberTarget({
      type: mode === "dm" ? "dmWatch" : "channelWatch",
      teamId: selectedTeam?.id ?? "",
      teamLabel: selectedTeam ? selectedTeam.display_name || selectedTeam.name : selectedChannelKindLabel ?? text.directMessage,
      channelId: selectedChannel.id,
      channelLabel: selectedChannelLabel ?? (selectedChannel.display_name || selectedChannel.name),
    });
  }, [mode, onRememberTarget, selectedChannel, selectedChannelKindLabel, selectedChannelLabel, selectedTeam]);

  const channelPostPollingIntervalMs = useMemo(
    () => getSyncInterval(realtimeEnabled, pollingIntervalSeconds, isPaneVisible),
    [isPaneVisible, pollingIntervalSeconds, realtimeEnabled],
  );

  useColumnPolling(
    async (isCancelled) => {
      setPostState((current) => ({
        ...current,
        status: current.posts.length > 0 ? current.status : "loading",
        error: null,
      }));
      try {
        const latestPosts = await getRecentPosts(column.channelId as string, 0, POSTS_PAGE_SIZE);
        if (isCancelled()) {
          return;
        }
        void ensureUsers(latestPosts.map((post) => post.user_id));
        setPostState((current) => ({
          status: "ready",
          posts: current.posts.length > 0 ? mergePosts(latestPosts, current.posts, POSTS_MAX_BUFFER) : latestPosts,
          error: null,
          nextPage: 1,
          hasMore: latestPosts.length === POSTS_PAGE_SIZE,
          loadingMore: false,
        }));
        setHasCompletedInitialLoad(true);
        finishRefresh();
      } catch (error) {
        if (isCancelled()) {
          return;
        }
        setPostState({
          status: "error",
          posts: [],
          error: getLocalizedApiErrorMessage(error, text.failedToLoadPosts),
          nextPage: 1,
          hasMore: false,
          loadingMore: false,
        });
        setHasCompletedInitialLoad(true);
        finishRefresh();
      }
    },
    channelPostPollingIntervalMs,
    {
      enabled: !((mode === "channel" && !column.teamId) || !column.channelId),
      paused,
      onDisabled: () => {
        setHasCompletedInitialLoad(false);
        setPostState({
          status: "idle",
          posts: [],
          error: null,
          nextPage: 1,
          hasMore: false,
          loadingMore: false,
        });
        finishRefresh();
      },
      dependencies: [
        channelPostPollingIntervalMs,
        column.channelId,
        column.teamId,
        ensureUsers,
        finishRefresh,
        mode,
        paused,
        reconnectNonce,
        refreshNonce,
      ],
    },
  );

  useEffect(() => {
    const matchingEvents = postedEvents.filter((event) => event.channelId === column.channelId);
    if (matchingEvents.length === 0) {
      return;
    }
    void ensureUsers(Array.from(new Set(matchingEvents.map((event) => event.post.user_id))));
    setPostState((current) => ({
      ...current,
      status: "ready",
      error: null,
      posts: mergePosts(
        matchingEvents.map((event) => event.post),
        current.posts,
        POSTS_MAX_BUFFER,
      ),
    }));
  }, [column.channelId, ensureUsers, postedEvents]);

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
      void ensureUsers(posts.map((post) => post.user_id));
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
        error: getLocalizedApiErrorMessage(error, text.failedToLoadPosts),
        loadingMore: false,
      }));
    }
  };

  const triggerRefresh = useCallback(() => {
    startRefresh();
    setRefreshNonce((current) => current + 1);
  }, [startRefresh]);

  useEffect(() => {
    if (!__MATTERMOST_DECK_E2E_DEBUG__ || !isDebugEnabled()) {
      return;
    }

    window.__mattermostDeckDebugColumnState ??= {};
    window.__mattermostDeckDebugColumnState[column.id] = {
      kind: "channelWatch",
      mode,
      channelStatus: channelState.status,
      channelOptions,
      selectedTeamId: column.teamId ?? null,
      selectedChannelId: column.channelId ?? null,
      showControls,
    };

    return () => {
      if (window.__mattermostDeckDebugColumnState) {
        delete window.__mattermostDeckDebugColumnState[column.id];
      }
    };
  }, [channelOptions, channelState.status, column.channelId, column.id, column.teamId, mode, showControls]);

  return (
    <section
      ref={setSectionNode}
      className={`deck-column deck-column--${mode === "dm" ? "dm" : "channel"}${isFocusedPane ? " deck-column--pane-focused" : ""}`}
      style={getColumnAccentStyle(column.type, columnColors)}
    >
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2 title={selectedChannelLabel ?? (mode === "dm" ? text.addDmWatch : text.addChannelWatch)}>
            <span className="deck-title-with-icon">
              <ColumnTypeBadge type={column.type} />
              <span>{selectedChannelLabel ?? (mode === "dm" ? text.addDmWatch : text.addChannelWatch)}</span>
            </span>
          </h2>
          <p
            title={
              selectedChannel
                ? mode === "dm"
                  ? selectedChannelKindLabel ?? text.directMessage
                  : selectedTeamLabel ?? text.unknownTeam
                : mode === "dm"
                  ? text.pickDmOrGroup
                  : text.pickTeamAndChannel
            }
          >
            {selectedChannel
              ? mode === "dm"
                ? selectedChannelKindLabel ?? text.directMessage
                : selectedTeamLabel ?? text.unknownTeam
              : mode === "dm"
                ? text.pickDmOrGroup
                : text.pickTeamAndChannel}
          </p>
        </div>
        <div className="deck-column-actions">
          {isFocusedPane ? (
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost deck-icon-button--active"
              title={text.exitFocus}
              aria-label={text.exitFocus}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active />
            </button>
          ) : null}
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            aria-label={
              showControls
                ? text.collapseControls(selectedChannelLabel ?? (mode === "dm" ? text.addDmWatch : text.addChannelWatch))
                : text.expandControls(selectedChannelLabel ?? (mode === "dm" ? text.addDmWatch : text.addChannelWatch))
            }
          >
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>

      {showControls ? (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-inline-actions">
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveLeft} onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveRight} onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              title={text.refresh}
              onClick={triggerRefresh}
              disabled={isRefreshing}
            >
              <RefreshIcon spinning={isRefreshing} />
            </button>
            <button
              type="button"
              className={`deck-icon-button deck-icon-button--ghost${paused ? " deck-icon-button--active" : ""}`}
              onClick={() => setPaused((v) => !v)}
              title={paused ? text.resumePolling : text.pausePolling}
              aria-label={paused ? text.resumePolling : text.pausePolling}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              type="button"
              className={`deck-icon-button deck-icon-button--ghost${isFocusedPane ? " deck-icon-button--active" : ""}`}
              title={isFocusedPane ? text.exitFocus : text.focusPane}
              aria-label={isFocusedPane ? text.exitFocus : text.focusPane}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active={isFocusedPane} />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.removeColumn} onClick={() => onRemove(column.id)}>
              <CloseIcon />
            </button>
          </div>
          <div className="deck-controls">
            {mode === "channel" ? (
              <TeamSelect
                teams={teams}
                teamId={column.teamId}
                onChange={(teamId) => onUpdate(column.id, { teamId: teamId || undefined, channelId: undefined })}
                language={language}
              />
            ) : null}
            <label className="deck-field">
              <span>{mode === "dm" ? text.addDmWatch : text.channelLabel}</span>
              <CustomSelect
                options={channelOptions}
                value={column.channelId ?? ""}
                disabled={(mode === "channel" && !column.teamId) || channelState.status === "loading"}
                placeholder={mode === "dm" ? text.selectDm : text.selectChannel}
                onChange={(channelId) => onUpdate(column.id, { channelId: channelId || undefined })}
              />
            </label>
          </div>

          {mode === "channel" && !column.teamId ? (
            <article className="deck-card">
              <strong>{text.selectATeam}</strong>
              <p>{text.selectATeamDesc}</p>
            </article>
          ) : !column.channelId && channelState.status === "error" ? (
            <PaneErrorState
              title={text.failedToLoadChannels}
              error={channelState.error ?? text.unknownError}
              onRetry={() => {
                startRefresh();
                setRefreshNonce((current) => current + 1);
              }}
            />
          ) : !column.channelId ? (
            <article className="deck-card">
              <strong>{mode === "dm" ? text.selectADm : text.selectAChannel}</strong>
              <p>{mode === "dm" ? text.selectDmDesc : text.selectChannelDesc}</p>
            </article>
          ) : mode === "dm" ? (
            <article className="deck-card deck-card--muted">
              <strong>{selectedChannelLabel ?? text.pinnedTarget}</strong>
              <p>{selectedChannelKindLabel ?? text.directMessage}</p>
            </article>
          ) : selectedTeam ? (
            <article className="deck-card deck-card--muted">
              <strong>{selectedChannelLabel ?? text.pinnedTarget}</strong>
              <p>{selectedTeamLabel}</p>
            </article>
          ) : null}
        </div>
      ) : null}

      {mode === "channel" && !column.teamId ? (
        <article className="deck-card deck-card--muted">
          <strong>{text.startWithChannel}</strong>
          <p>{text.startWithChannelDesc}</p>
          <div className="deck-stack deck-stack--empty-actions">
            {canWatchCurrentChannel ? (
              <button
                type="button"
                className="deck-add-item"
                onClick={() => onUpdate(column.id, { teamId: currentTeamId, channelId: currentChannelId })}
              >
                <span>{text.watchCurrentChannel}</span>
                <small>{currentWatchLabel}{currentTeamLabel ? ` / ${currentTeamLabel}` : ""}</small>
              </button>
            ) : null}
            <button type="button" className="deck-add-item deck-add-item--secondary" onClick={() => onAddColumn("mentions")}>
              <span>{text.recommendedMentions}</span>
              <small>{text.recommendedMentionsDesc}</small>
            </button>
            <button type="button" className="deck-add-item deck-add-item--secondary" onClick={() => onAddColumn("saved")}>
              <span>{text.recommendedSaved}</span>
              <small>{text.recommendedSavedDesc}</small>
            </button>
          </div>
        </article>
      ) : !column.channelId ? (
        <article className="deck-card deck-card--muted">
          <strong>{mode === "dm" ? text.selectADm : text.selectAChannel}</strong>
          <p>{mode === "dm" ? text.selectDmDesc : text.selectChannelDesc}</p>
          <div className="deck-stack deck-stack--empty-actions">
            {canWatchCurrentChannel ? (
              <button
                type="button"
                className="deck-add-item"
                onClick={() => onUpdate(column.id, {
                  teamId: mode === "channel" ? currentTeamId : column.teamId,
                  channelId: currentChannelId,
                })}
              >
                <span>{text.useCurrentChannel}</span>
                <small>{currentWatchLabel}{currentTeamLabel ? ` / ${currentTeamLabel}` : ""}</small>
              </button>
            ) : null}
            <button type="button" className="deck-add-item deck-add-item--secondary" onClick={() => onAddColumn("diagnostics")}>
              <span>{text.recommendedDiagnostics}</span>
              <small>{text.recommendedDiagnosticsDesc}</small>
            </button>
          </div>
        </article>
      ) : postState.status === "error" ? (
        <PaneErrorState
          title={text.failedToLoadPosts}
          error={postState.error ?? text.unknownError}
          onRetry={() => {
            setPaused(false);
            startRefresh();
            setRefreshNonce((current) => current + 1);
          }}
        />
      ) : shouldShowLoadingState ? (
        <ColumnLoadingState
          title={mode === "dm" ? text.loadingDirectMessages : text.loadingChannelPosts}
          detail={mode === "dm" ? text.loadingDirectMessagesDesc : text.loadingChannelPostsDesc}
        />
      ) : postState.posts.length === 0 ? (
        <article className="deck-card">
          <strong>{text.noPostsYet}</strong>
          <p>{mode === "dm" ? text.noDirectPosts : text.noChannelPosts}</p>
        </article>
      ) : (
        <PostList
          posts={postState.posts}
          userDirectory={userDirectory}
          compactMode={compactMode}
          hasMore={postState.hasMore}
          loadingMore={postState.loadingMore}
          onLoadMore={handleLoadMore}
          onOpenPost={(post) => onOpenPost(post, { teamName: selectedTeam?.name, channelName: selectedChannel?.name })}
          postClickAction={postClickAction}
          showImagePreviews={showImagePreviews}
          language={language}
          reversedPostOrder={reversedPostOrder}
          highlightTerms={highlightTerms}
          currentUserId={currentUserId}
          lastViewedAt={lastViewedAt}
          onMarkRead={handleMarkRead}
          unreadSeparatorLabel={text.unreadSeparatorLabel}
          markReadLabel={text.markRead}
          jumpToLatestLabel={text.jumpToLatest}
          newPostsLabel={text.newPosts}
        />
      )}
    </section>
  );
}
function SearchIcon(): React.JSX.Element {
  return (
    <svg className="deck-search-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

function InitialLoadingState({ message }: { message: string }): React.JSX.Element {
  const text = useAppText();
  return (
    <section className="deck-loading-state" aria-live="polite">
      <div className="deck-loading-spinner" aria-hidden="true" />
      <strong>{message}</strong>
      <p>{text.initialLoadingDesc}</p>
      <div className="deck-loading-skeletons" aria-hidden="true">
        <div className="deck-loading-skeleton" />
        <div className="deck-loading-skeleton" />
        <div className="deck-loading-skeleton" />
      </div>
    </section>
  );
}

function ColumnLoadingState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <article
      className="deck-loading-state deck-loading-state--column"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="deck-loading-spinner" aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
    </article>
  );
}

function PaneErrorState({
  title,
  error,
  detail,
  muted = false,
  onRetry,
}: {
  title: string;
  error: string;
  detail?: string;
  muted?: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <article
      className={`deck-card${muted ? " deck-card--muted" : ""}`}
      role={muted ? "status" : "alert"}
      aria-live={muted ? "polite" : "assertive"}
      aria-atomic="true"
    >
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
      <p>{error}</p>
      <div className="deck-inline-actions">
        <button
          type="button"
          className="deck-add-item deck-add-item--secondary"
          onClick={onRetry}
        >
          {i18n.t("deck.retry")}
        </button>
      </div>
    </article>
  );
}

function ColumnLoadingProgress({
  title,
  detail,
  announcement,
  completed,
  total,
}: {
  title: string;
  detail: string;
  announcement?: string;
  completed: number;
  total: number;
}): React.JSX.Element {
  const progress = total > 0
    ? Math.min(100, Math.max(0, (completed / total) * 100))
    : 0;

  return (
    <div
      className="deck-column-loading-status"
      title={`${title} ${detail}`}
      data-completed={completed}
      data-total={total}
    >
      <div className="deck-loading-spinner" aria-hidden="true" />
      <span className="deck-column-loading-copy">
        <strong>{title}</strong>
        <span aria-hidden="true"> · </span>
        <span>{detail}</span>
      </span>
      <span
        className="deck-column-loading-track"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, total)}
        aria-valuenow={Math.min(completed, Math.max(1, total))}
        aria-valuetext={detail}
      >
        <span style={{ width: `${progress}%` }} />
      </span>
      {announcement ? (
        <span
          className="deck-sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </span>
      ) : null}
    </div>
  );
}

function SearchLikeColumn({
  column,
  currentUsername,
  currentUserId,
  teams,
  userDirectory,
  ensureUsers,
  pollingIntervalSeconds,
  reconnectNonce,
  canMoveLeft,
  canMoveRight,
  onMove,
  onUpdate,
  onRemove,
  onOpenPost,
  postClickAction,
  compactMode,
  columnColors,
  showImagePreviews,
  language,
  reversedPostOrder,
  highlightKeywords,
  isFocusedPane,
  onToggleFocus,
}: {
  column: DeckColumn;
  currentUsername: string | null;
  currentUserId?: string | null;
  teams: MattermostTeam[];
  userDirectory: Record<string, MattermostUser>;
  ensureUsers: (userIds: string[]) => Promise<void>;
  pollingIntervalSeconds: number;
  reconnectNonce: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (id: string, direction: "left" | "right") => void;
  onUpdate: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>) => void;
  onRemove: (id: string) => void;
  onOpenPost: (post: MattermostPost, target?: OpenPostTarget) => void;
  postClickAction: PostClickAction;
  compactMode: boolean;
  columnColors: ColumnColorSettings;
  showImagePreviews: boolean;
  language: DeckLanguage;
  reversedPostOrder: boolean;
  highlightKeywords: string;
  isFocusedPane: boolean;
  onToggleFocus: (id: string) => void;
}): React.JSX.Element {
  const text = useAppText();
  const [searchChannelDirectory, setSearchChannelDirectory] = useState<Record<string, MattermostChannel>>({});
  const [postState, setPostState] = useState<PostState>({
    status: "idle",
    posts: [],
    error: null,
    nextPage: 1,
    hasMore: false,
    loadingMore: false,
  });
  const { isRefreshing, startRefresh, finishRefresh } = useRefreshIndicator();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(!(column.teamId && column.query?.trim()));
  const [draftQuery, setDraftQuery] = useState(column.query ?? "");
  const [savedSearches, setSavedSearches] = useState<string[]>([]);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
  const [sectionNode, setSectionNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    void loadStoredJson<string[]>(SAVED_SEARCHES_KEY, []).then(setSavedSearches);
  }, []);

  const handleSaveSearch = () => {
    const q = draftQuery.trim();
    if (!q || savedSearches.includes(q)) return;
    const next = [...savedSearches, q];
    setSavedSearches(next);
    void saveStoredJson(SAVED_SEARCHES_KEY, next);
  };

  const handleDeleteSavedSearch = (q: string) => {
    const next = savedSearches.filter((s) => s !== q);
    setSavedSearches(next);
    void saveStoredJson(SAVED_SEARCHES_KEY, next);
  };
  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const query = column.query?.trim() ?? "";
  const highlightTerms = useMemo(
    () => uniqueTerms([...extractSearchTerms(query), ...resolveHighlightTerms(highlightKeywords, currentUsername)]),
    [currentUsername, highlightKeywords, query],
  );
  const apiQuery = useMemo(() => expandSearchQueryForApi(query), [query]);
  const ready = Boolean(column.teamId && query);
  const shouldShowLoadingState =
    ready &&
    postState.posts.length === 0 &&
    (postState.status === "idle" || postState.status === "loading") &&
    !hasCompletedInitialLoad;
  const isPaneVisible = useElementVisibility(sectionNode, { rootMargin: "600px 0px", defaultVisible: true });
  const title = query || text.addSearch;

  useEffect(() => {
    setHasCompletedInitialLoad(false);
    setPostState({
      status: "idle",
      posts: [],
      error: null,
      nextPage: 1,
      hasMore: false,
      loadingMore: false,
    });
  }, [column.teamId, query]);

  useEffect(() => {
    if (isFocusedPane) {
      setShowControls(false);
    }
  }, [isFocusedPane]);

  useEffect(() => {
    if (isFocusedPane) {
      setShowControls(false);
    }
  }, [isFocusedPane]);

  useEffect(() => {
    setShowControls(!(column.teamId && column.query?.trim()));
  }, [column.query, column.teamId]);

  useEffect(() => {
    setDraftQuery(column.query ?? "");
  }, [column.query]);

  useEffect(() => {
    const missingChannelIds = Array.from(
      new Set(postState.posts.map((post) => post.channel_id).filter((channelId) => channelId && !searchChannelDirectory[channelId])),
    );
    if (missingChannelIds.length === 0) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const channels = await getChannelsByIds(missingChannelIds);
        if (cancelled) {
          return;
        }
        setSearchChannelDirectory((current) => {
          const next = { ...current };
          for (const channel of channels) {
            next[channel.id] = channel;
          }
          return next;
        });
      } catch {
        return;
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [postState.posts, searchChannelDirectory]);

  const searchPollingIntervalMs = useMemo(
    () => Math.max(getSyncInterval(false, pollingIntervalSeconds, isPaneVisible), SEARCH_SYNC_INTERVAL_FLOOR_MS),
    [isPaneVisible, pollingIntervalSeconds],
  );

  useColumnPolling(
    async (isCancelled) => {
      setPostState((current) => ({
        ...current,
        status: current.posts.length > 0 ? current.status : "loading",
        error: null,
      }));

      try {
        const latestPosts = await searchPostsInTeam(column.teamId as string, apiQuery, 0, POSTS_PAGE_SIZE);
        if (isCancelled()) {
          return;
        }
        ensureUsers(latestPosts.map((post) => post.user_id));
        setPostState((current) => ({
          status: "ready",
          posts: current.posts.length > 0 ? mergePosts(latestPosts, current.posts, POSTS_MAX_BUFFER) : latestPosts,
          error: null,
          nextPage: 1,
          hasMore: latestPosts.length === POSTS_PAGE_SIZE,
          loadingMore: false,
        }));
        setHasCompletedInitialLoad(true);
        finishRefresh();
      } catch (error) {
        if (isCancelled()) {
          return;
        }
        setPostState({
          status: "error",
          posts: [],
          error: getLocalizedApiErrorMessage(error, text.failedToLoadResults),
          nextPage: 1,
          hasMore: false,
          loadingMore: false,
        });
        setHasCompletedInitialLoad(true);
        finishRefresh();
      }
    },
    searchPollingIntervalMs,
    {
      enabled: ready,
      paused,
      onDisabled: () => {
        setHasCompletedInitialLoad(false);
        setPostState({
          status: "idle",
          posts: [],
          error: null,
          nextPage: 1,
          hasMore: false,
          loadingMore: false,
        });
        finishRefresh();
      },
      dependencies: [
        apiQuery,
        column.teamId,
        ensureUsers,
        finishRefresh,
        paused,
        ready,
        reconnectNonce,
        refreshNonce,
        searchPollingIntervalMs,
      ],
    },
  );

  const handleLoadMore = async () => {
    if (!ready || postState.loadingMore || !postState.hasMore) {
      return;
    }

    setPostState((current) => ({ ...current, loadingMore: true, error: null }));
    try {
      const [posts] = await Promise.all([
        searchPostsInTeam(column.teamId as string, apiQuery, postState.nextPage, POSTS_PAGE_SIZE),
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
        error: getLocalizedApiErrorMessage(error, text.failedToLoadResults),
        loadingMore: false,
      }));
    }
  };

  const handleApplyQuery = () => {
    onUpdate(column.id, { query: draftQuery.trim() || undefined });
  };

  return (
    <section
      ref={setSectionNode}
      className={`deck-column deck-column--search${isFocusedPane ? " deck-column--pane-focused" : ""}`}
      style={getColumnAccentStyle(column.type, columnColors)}
    >
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2 title={title}>
            <span className="deck-title-with-icon">
              <ColumnTypeBadge type={column.type} />
              <span>{title}</span>
            </span>
          </h2>
          <p title={selectedTeam ? selectedTeam.display_name || selectedTeam.name : text.pickTeam}>
            {selectedTeam ? selectedTeam.display_name || selectedTeam.name : text.pickTeam}
          </p>
        </div>
        <div className="deck-column-actions">
          {isFocusedPane ? (
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost deck-icon-button--active"
              title={text.exitFocus}
              aria-label={text.exitFocus}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active />
            </button>
          ) : null}
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            aria-label={showControls ? text.collapseControls(title) : text.expandControls(title)}
          >
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>

      {showControls ? (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-inline-actions">
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveLeft} onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveRight} onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              title={text.refresh}
              onClick={() => {
                startRefresh();
                setRefreshNonce((current) => current + 1);
              }}
              disabled={isRefreshing || !ready}
            >
              <RefreshIcon spinning={isRefreshing} />
            </button>
            <button
              type="button"
              className={`deck-icon-button deck-icon-button--ghost${paused ? " deck-icon-button--active" : ""}`}
              onClick={() => setPaused((v) => !v)}
              title={paused ? text.resumePolling : text.pausePolling}
              aria-label={paused ? text.resumePolling : text.pausePolling}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              type="button"
              className={`deck-icon-button deck-icon-button--ghost${isFocusedPane ? " deck-icon-button--active" : ""}`}
              title={isFocusedPane ? text.exitFocus : text.focusPane}
              aria-label={isFocusedPane ? text.exitFocus : text.focusPane}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active={isFocusedPane} />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.removeColumn} onClick={() => onRemove(column.id)}>
              <CloseIcon />
            </button>
          </div>
          <div className="deck-controls">
            <TeamSelect teams={teams} teamId={column.teamId} onChange={(teamId) => onUpdate(column.id, { teamId: teamId || undefined })} language={language} />
            <label className="deck-field">
              <span>{text.queryLabel}</span>
              <input
                className="deck-input"
                value={draftQuery}
                placeholder={text.searchTerms}
                onChange={(event) => setDraftQuery(event.target.value)}
                onFocus={stopDeckInputPropagation}
                onClick={stopDeckInputPropagation}
                onPointerDown={stopDeckInputPropagation}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleApplyQuery();
                  }
                }}
                onKeyUp={stopDeckInputPropagation}
              />
            </label>
            <div className="deck-inline-actions">
              <button type="button" className="deck-load-more" onClick={handleApplyQuery}>
                {text.applySearch}
              </button>
              <button
                type="button"
                className="deck-icon-button deck-icon-button--ghost"
                onClick={handleSaveSearch}
                disabled={!draftQuery.trim() || savedSearches.includes(draftQuery.trim())}
                title={text.saveSearchQuery}
                aria-label={text.saveSearchQuery}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </button>
            </div>
            {savedSearches.length > 0 && (
              <div className="deck-saved-searches">
                <span className="deck-saved-searches-label">{text.savedSearches}</span>
                <div className="deck-saved-searches-list">
                  {savedSearches.map((q) => (
                    <div key={q} className="deck-saved-search-chip">
                      <button
                        type="button"
                        className="deck-saved-search-apply"
                        onClick={() => {
                          setDraftQuery(q);
                          onUpdate(column.id, { query: q });
                        }}
                        title={q}
                      >
                        {q}
                      </button>
                      <button
                        type="button"
                        className="deck-saved-search-delete"
                        onClick={() => handleDeleteSavedSearch(q)}
                        aria-label={text.removeSavedSearch(q)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <article className="deck-card deck-card--muted">
            <strong>{text.searchSyntax}</strong>
            <p>{text.searchSyntaxDesc}</p>
          </article>
        </div>
      ) : null}

      {!ready ? (
        <article className="deck-card">
          <strong>{text.setSearch}</strong>
          <p>{text.setSearchDesc}</p>
        </article>
      ) : postState.status === "error" ? (
        <PaneErrorState
          title={text.failedToLoadResults}
          error={postState.error ?? text.unknownError}
          onRetry={() => {
            setPaused(false);
            startRefresh();
            setRefreshNonce((current) => current + 1);
          }}
        />
      ) : shouldShowLoadingState ? (
        <ColumnLoadingState
          title={column.type === "keywordWatch" ? text.loadingKeywordMatches : text.loadingSearchResults}
          detail={text.loadingSearchDesc}
        />
      ) : postState.posts.length === 0 ? (
        <article className="deck-card">
          <strong>{text.noResults}</strong>
          <p>{text.noResultsDesc}</p>
        </article>
      ) : (
        <PostList
          posts={postState.posts}
          userDirectory={userDirectory}
          compactMode={compactMode}
          hasMore={postState.hasMore}
          loadingMore={postState.loadingMore}
          onLoadMore={handleLoadMore}
          renderMeta={() => (selectedTeam ? selectedTeam.display_name || selectedTeam.name : null)}
          renderBody={(post, { isVisible }) => {
            const snippet = buildSearchSnippet(post.message, query);
            return isVisible ? renderHighlightedTextFromTerms(snippet, highlightTerms) : snippet;
          }}
          onOpenPost={(post) => onOpenPost(post, {
            teamName: selectedTeam?.name,
            channelName: searchChannelDirectory[post.channel_id]?.name,
          })}
          postClickAction={postClickAction}
          showImagePreviews={showImagePreviews}
          language={language}
          reversedPostOrder={reversedPostOrder}
          highlightTerms={highlightTerms}
          currentUserId={currentUserId}
        />
      )}
    </section>
  );
}

function SavedPostsColumn({
  column,
  currentUsername,
  currentUserId,
  userDirectory,
  ensureUsers,
  pollingIntervalSeconds,
  reconnectNonce,
  canMoveLeft,
  canMoveRight,
  onMove,
  onRemove,
  onOpenPost,
  postClickAction,
  compactMode,
  columnColors,
  showImagePreviews,
  language,
  reversedPostOrder,
  highlightKeywords,
  isFocusedPane,
  onToggleFocus,
}: {
  column: DeckColumn;
  currentUsername: string | null;
  currentUserId?: string | null;
  userDirectory: Record<string, MattermostUser>;
  ensureUsers: (userIds: string[]) => Promise<void>;
  pollingIntervalSeconds: number;
  reconnectNonce: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (id: string, direction: "left" | "right") => void;
  onRemove: (id: string) => void;
  onOpenPost: (post: MattermostPost, target?: OpenPostTarget) => void;
  postClickAction: PostClickAction;
  compactMode: boolean;
  columnColors: ColumnColorSettings;
  showImagePreviews: boolean;
  language: DeckLanguage;
  reversedPostOrder: boolean;
  highlightKeywords: string;
  isFocusedPane: boolean;
  onToggleFocus: (id: string) => void;
}): React.JSX.Element {
  const text = useAppText();
  const [savedChannelDirectory, setSavedChannelDirectory] = useState<Record<string, MattermostChannel>>({});
  const [postState, setPostState] = useState<PostState>({
    status: "idle",
    posts: [],
    error: null,
    nextPage: 1,
    hasMore: false,
    loadingMore: false,
  });
  const { isRefreshing, startRefresh, finishRefresh } = useRefreshIndicator();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const highlightTerms = useMemo(() => resolveHighlightTerms(highlightKeywords, currentUsername), [currentUsername, highlightKeywords]);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
  const [sectionNode, setSectionNode] = useState<HTMLElement | null>(null);
  const shouldShowLoadingState =
    postState.posts.length === 0 &&
    (postState.status === "idle" || postState.status === "loading") &&
    !hasCompletedInitialLoad;
  const isPaneVisible = useElementVisibility(sectionNode, { rootMargin: "600px 0px", defaultVisible: true });

  const savedPollingIntervalMs = useMemo(
    () => Math.max(getSyncInterval(false, pollingIntervalSeconds, isPaneVisible), SEARCH_SYNC_INTERVAL_FLOOR_MS),
    [isPaneVisible, pollingIntervalSeconds],
  );

  useColumnPolling(
    async (isCancelled) => {
      setPostState((current) => ({ ...current, status: current.posts.length > 0 ? current.status : "loading", error: null }));
      try {
        const latestPosts = await getFlaggedPosts(0, POSTS_PAGE_SIZE);
        if (isCancelled()) {
          return;
        }
        ensureUsers(latestPosts.map((post) => post.user_id));
        setPostState((current) => ({
          status: "ready",
          posts: current.posts.length > 0 ? mergePosts(latestPosts, current.posts, POSTS_MAX_BUFFER) : latestPosts,
          error: null,
          nextPage: 1,
          hasMore: latestPosts.length === POSTS_PAGE_SIZE,
          loadingMore: false,
        }));
        setHasCompletedInitialLoad(true);
        finishRefresh();
      } catch (error) {
        if (isCancelled()) {
          return;
        }
        setPostState({
          status: "error",
          posts: [],
          error: getLocalizedApiErrorMessage(error, text.failedToLoadSavedPosts),
          nextPage: 1,
          hasMore: false,
          loadingMore: false,
        });
        setHasCompletedInitialLoad(true);
        finishRefresh();
      }
    },
    savedPollingIntervalMs,
    {
      paused,
      dependencies: [
        ensureUsers,
        finishRefresh,
        paused,
        reconnectNonce,
        refreshNonce,
        savedPollingIntervalMs,
      ],
    },
  );

  useEffect(() => {
    const missingChannelIds = Array.from(
      new Set(postState.posts.map((post) => post.channel_id).filter((channelId) => channelId && !savedChannelDirectory[channelId])),
    );
    if (missingChannelIds.length === 0) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const channels = await getChannelsByIds(missingChannelIds);
        if (cancelled) {
          return;
        }
        setSavedChannelDirectory((current) => {
          const next = { ...current };
          for (const channel of channels) {
            next[channel.id] = channel;
          }
          return next;
        });
      } catch {
        return;
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [postState.posts, savedChannelDirectory]);

  const handleLoadMore = async () => {
    if (postState.loadingMore || !postState.hasMore) {
      return;
    }

    setPostState((current) => ({ ...current, loadingMore: true, error: null }));
    try {
      const [posts] = await Promise.all([
        getFlaggedPosts(postState.nextPage, POSTS_PAGE_SIZE),
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
        error: getLocalizedApiErrorMessage(error, text.failedToLoadSavedPosts),
        loadingMore: false,
      }));
    }
  };

  return (
    <section
      ref={setSectionNode}
      className={`deck-column deck-column--saved${isFocusedPane ? " deck-column--pane-focused" : ""}`}
      style={getColumnAccentStyle(column.type, columnColors)}
    >
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2><span className="deck-title-with-icon"><ColumnTypeBadge type="saved" /><span>{text.addSaved}</span></span></h2>
          <p>{text.flaggedPosts}</p>
        </div>
        <div className="deck-column-actions">
          {isFocusedPane ? (
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost deck-icon-button--active"
              title={text.exitFocus}
              aria-label={text.exitFocus}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active />
            </button>
          ) : null}
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            title={
              showControls
                ? text.collapseControls(text.addSaved)
                : text.expandControls(text.addSaved)
            }
            aria-label={
              showControls
                ? text.collapseControls(text.addSaved)
                : text.expandControls(text.addSaved)
            }
            aria-expanded={showControls}
            aria-controls={`mattermost-deck-saved-controls-${column.id}`}
          >
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>
      {showControls ? (
        <div
          id={`mattermost-deck-saved-controls-${column.id}`}
          className="deck-stack deck-stack--controls"
        >
          <div className="deck-inline-actions">
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveLeft} onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveRight} onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              title={text.refresh}
              onClick={() => {
                startRefresh();
                setRefreshNonce((current) => current + 1);
              }}
              disabled={isRefreshing}
            >
              <RefreshIcon spinning={isRefreshing} />
            </button>
            <button
              type="button"
              className={`deck-icon-button deck-icon-button--ghost${paused ? " deck-icon-button--active" : ""}`}
              onClick={() => setPaused((v) => !v)}
              title={paused ? text.resumePolling : text.pausePolling}
              aria-label={paused ? text.resumePolling : text.pausePolling}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              type="button"
              className={`deck-icon-button deck-icon-button--ghost${isFocusedPane ? " deck-icon-button--active" : ""}`}
              title={isFocusedPane ? text.exitFocus : text.focusPane}
              aria-label={isFocusedPane ? text.exitFocus : text.focusPane}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active={isFocusedPane} />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.removeColumn} onClick={() => onRemove(column.id)}>
              <CloseIcon />
            </button>
          </div>
        </div>
      ) : null}
      {postState.status === "error" ? (
        <PaneErrorState
          title={text.failedToLoadSavedPosts}
          error={postState.error ?? text.unknownError}
          onRetry={() => {
            setPaused(false);
            startRefresh();
            setRefreshNonce((current) => current + 1);
          }}
        />
      ) : shouldShowLoadingState ? (
        <ColumnLoadingState
          title={text.loadingSavedPosts}
          detail={text.loadingSavedPostsDesc}
        />
      ) : postState.posts.length === 0 ? (
        <article className="deck-card">
          <strong>{text.noSavedPosts}</strong>
          <p>{text.noSavedPostsDesc}</p>
        </article>
      ) : (
        <PostList
          posts={postState.posts}
          userDirectory={userDirectory}
          compactMode={compactMode}
          hasMore={postState.hasMore}
          loadingMore={postState.loadingMore}
          onLoadMore={handleLoadMore}
          onOpenPost={(post) => onOpenPost(post, {
            channelName: savedChannelDirectory[post.channel_id]?.name,
          })}
          postClickAction={postClickAction}
          showImagePreviews={showImagePreviews}
          language={language}
          reversedPostOrder={reversedPostOrder}
          highlightTerms={highlightTerms}
          currentUserId={currentUserId}
        />
      )}
    </section>
  );
}

function DiagnosticsColumn({
  column,
  wsStatus,
  syncLogs,
  apiHealthStatus,
  realtimeEnabled,
  runtimeMetrics,
  canMoveLeft,
  canMoveRight,
  onMove,
  onRemove,
  onOpenSettings,
  columnColors,
  language = "ja",
  isFocusedPane,
  onToggleFocus,
}: {
  column: DeckColumn;
  wsStatus: WebSocketStatus;
  syncLogs: SyncLogEntry[];
  apiHealthStatus: ApiHealthStatus;
  realtimeEnabled: boolean;
  runtimeMetrics: RuntimePerformanceSnapshot;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (id: string, direction: "left" | "right") => void;
  onRemove: (id: string) => void;
  onOpenSettings: () => void;
  columnColors: ColumnColorSettings;
  language?: DeckLanguage;
  isFocusedPane: boolean;
  onToggleFocus: (id: string) => void;
}): React.JSX.Element {
  const text = useAppText();
  const [showControls, setShowControls] = useState(false);
  const diagnosticsLogs = useMemo(() => buildDiagnosticsLogEntries(syncLogs), [syncLogs]);
  const healthLabel =
    apiHealthStatus === "healthy"
      ? text.diagnosticsStatusHealthy
      : apiHealthStatus === "degraded"
        ? text.diagnosticsStatusDegraded
        : text.diagnosticsStatusError;
  const wsStatusLabel = (() => {
    switch (wsStatus) {
      case "idle":
        return text.diagnosticsWsIdle;
      case "connecting":
        return text.diagnosticsWsConnecting;
      case "connected":
        return text.diagnosticsWsConnected;
      case "reconnecting":
        return text.diagnosticsWsReconnecting;
      case "offline":
        return text.diagnosticsWsOffline;
      case "auth_failed":
        return text.diagnosticsWsAuthFailed;
      default:
        return text.diagnosticsWsError;
    }
  })();

  useEffect(() => {
    if (isFocusedPane) {
      setShowControls(false);
    }
  }, [isFocusedPane]);

  return (
    <section className={`deck-column deck-column--diagnostics${isFocusedPane ? " deck-column--pane-focused" : ""}`} style={getColumnAccentStyle(column.type, columnColors)}>
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2><span className="deck-title-with-icon"><ColumnTypeBadge type="diagnostics" /><span>{text.diagnosticsTitle}</span></span></h2>
          <p>{text.diagnosticsDesc}</p>
        </div>
        <div className="deck-column-actions">
          {isFocusedPane ? (
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost deck-icon-button--active"
              title={text.exitFocus}
              aria-label={text.exitFocus}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active />
            </button>
          ) : null}
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            title={
              showControls
                ? text.collapseControls(text.diagnosticsTitle)
                : text.expandControls(text.diagnosticsTitle)
            }
            aria-label={
              showControls
                ? text.collapseControls(text.diagnosticsTitle)
                : text.expandControls(text.diagnosticsTitle)
            }
            aria-expanded={showControls}
            aria-controls={`mattermost-deck-diagnostics-controls-${column.id}`}
          >
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>
      {showControls ? (
        <div
          id={`mattermost-deck-diagnostics-controls-${column.id}`}
          className="deck-stack deck-stack--controls"
        >
          <div className="deck-inline-actions">
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveLeft} onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.moveRight} onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className={`deck-icon-button deck-icon-button--ghost${isFocusedPane ? " deck-icon-button--active" : ""}`}
              title={isFocusedPane ? text.exitFocus : text.focusPane}
              aria-label={isFocusedPane ? text.exitFocus : text.focusPane}
              onClick={() => onToggleFocus(column.id)}
            >
              <FocusIcon active={isFocusedPane} />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.removeColumn} onClick={() => onRemove(column.id)}>
              <CloseIcon />
            </button>
          </div>
          <button type="button" className="deck-icon-button deck-icon-button--ghost" title={text.settingsButton} onClick={onOpenSettings}>
            <SettingsIcon />
          </button>
        </div>
      ) : null}
      <div className="deck-stack">
        <div className="deck-metric-grid">
          <article className="deck-card deck-card--metric">
            <strong>{text.diagnosticsStatus}</strong>
            <p>{healthLabel}</p>
            <span>{realtimeEnabled ? wsStatusLabel : text.diagnosticsPolling}</span>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>{text.diagnosticsApiTps}</strong>
            <p>{runtimeMetrics.api.recentTps.toFixed(1)}</p>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>{text.diagnosticsAvgLatency}</strong>
            <p>{formatLatency(runtimeMetrics.api.averageLatencyMs)}</p>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>{text.diagnosticsErrorRate}</strong>
            <p>{formatRate(runtimeMetrics.api.recentErrorRate)}</p>
            <span>{runtimeMetrics.api.recentFailedRequestsPerMinute} / {runtimeMetrics.api.recentRequestsPerMinute} {text.diagnosticsRecentSuffix}</span>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>{text.diagnosticsInFlight}</strong>
            <p>{runtimeMetrics.api.inFlightRequests}</p>
            <span>{runtimeMetrics.api.totalGetRequests} GET / {runtimeMetrics.api.totalPostRequests} POST / {runtimeMetrics.api.totalFailedRequests} {text.diagnosticsFailedSuffix}</span>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>{text.diagnosticsWsReconnects}</strong>
            <p>{runtimeMetrics.diagnostics.websocket.reconnectCount.toLocaleString()}</p>
            <span>{runtimeMetrics.diagnostics.websocket.lastReconnectAt ? formatPostTime(runtimeMetrics.diagnostics.websocket.lastReconnectAt) : text.diagnosticsNotAvailable}</span>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>{text.diagnosticsRender}</strong>
            <p>{formatLatency(runtimeMetrics.diagnostics.render.p95CommitMs)}</p>
            <span>{text.diagnosticsAverageShort} {formatLatency(runtimeMetrics.diagnostics.render.averageCommitMs)} / {text.diagnosticsLastShort} {formatLatency(runtimeMetrics.diagnostics.render.lastCommitMs)}</span>
          </article>
        </div>
        <article className="deck-card">
          <strong>{text.diagnosticsRecentSyncLog}</strong>
          <ul className="deck-log-list">
            {diagnosticsLogs.length > 0 ? diagnosticsLogs.map((entry) => (
              <li key={`${entry.timestamp}-${entry.message}`} className={`deck-log-entry deck-log-entry--${entry.level}`}>
                <span className="deck-log-time">{formatPostTime(entry.timestamp)}</span>
                <span className="deck-log-text" title={entry.message}>{entry.summary}</span>
                {entry.count > 1 ? <span className="deck-log-count">x{entry.count}</span> : null}
              </li>
            )) : (
              <li className="deck-log-entry deck-log-entry--info">
                <span className="deck-log-time">-</span>
                <span className="deck-log-text" title={text.noRecentEvents}>{text.noRecentEvents}</span>
              </li>
            )}
          </ul>
          <p className="deck-card-caption">{text.diagnosticsPerformanceHint}</p>
        </article>
      </div>
    </section>
  );
}

export function App({ routeKey, shadowRoot }: AppProps): React.JSX.Element {
  const renderStartedAt = window.performance.now();
  useLayoutEffect(() => {
    // Keep diagnostics bounded without enabling React's full-subtree Profiler
    // mode. React's development Profiler writes User Timing measures whose
    // structured details remain retained until navigation or clearMeasures().
    recordRenderCommit(window.performance.now() - renderStartedAt);
  });

  useEffect(() => {
    debugLog("app.mount", { routeKey, path: window.location.pathname });
    return () => {
      debugLog("app.unmount", { routeKey, path: window.location.pathname });
    };
  }, []);

  useEffect(() => {
    debugLog("app.routeKey", { routeKey, path: window.location.pathname });
  }, [routeKey]);

  const currentRouteKey = useCurrentRouteKey(routeKey);
  useEffect(() => {
    debugLog("app.currentRouteKey", { routeKey: currentRouteKey, path: window.location.pathname });
  }, [currentRouteKey]);

  const currentRoute = useMemo(() => readDeckCurrentRoute(), [currentRouteKey]);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [mentionReadRefreshNonce, setMentionReadRefreshNonce] = useState(0);
  const [realtimeReadMarkers, setRealtimeReadMarkers] = useState<MentionReadMarkers>({
    channelLastViewedAt: {},
    threadLastViewedAt: {},
  });
  const [stateRefreshNonce, setStateRefreshNonce] = useState(0);
  const [mentionReconcileNonce, setMentionReconcileNonce] = useState(0);
  const [mentionMetadataNonce, setMentionMetadataNonce] = useState(0);
  const [postedEvents, setPostedEvents] = useState<PostedEvent[]>([]);
  const [deletedPostIds, setDeletedPostIds] = useState<string[]>([]);
  const deletedPostIdsRef = useRef<Set<string>>(new Set());
  const implicitMentionReconcilePostIdsRef = useRef<Set<string>>(new Set());
  const realtimeMentionScopeRef = useRef<{
    hasAllMentionsColumn: boolean;
    hasAnyMentionsColumn: boolean;
    teamIds: Set<string>;
  }>({
    hasAllMentionsColumn: false,
    hasAnyMentionsColumn: false,
    teamIds: new Set(),
  });
  const [realtimeAuthError, setRealtimeAuthError] = useState<string | null>(null);
  const mentionReconcileTimerRef = useRef<number | null>(null);
  const mentionReconcileStartedAtRef = useRef<number | null>(null);
  const [userDirectory, setUserDirectory] = useState<Record<string, MattermostUser>>({});
  const userDirectoryRef = useRef<Record<string, MattermostUser>>({});
  const [drawerOpen, setDrawerOpen] = useStoredBoolean(DRAWER_OPEN_STORAGE_KEY, true);
  const [contentMounted, setContentMounted] = useState(true);
  const unmountTimerRef = useRef<number | null>(null);
  const deckSettings = useDeckSettingsState();
  const text = useAppText();
  useEffect(() => { void i18n.changeLanguage(deckSettings.language); }, [deckSettings.language]);
  const effectiveRealtimeEnabled = deckSettings.wsPat.trim().length > 0 && !realtimeAuthError;
  const state = useDeckState(currentRouteKey, stateRefreshNonce, effectiveRealtimeEnabled, deckSettings.pollingIntervalSeconds);
  useEffect(() => {
    setRealtimeReadMarkers({
      channelLastViewedAt: {},
      threadLastViewedAt: {},
    });
  }, [state.userId]);
  const [mentionsLastReadAt, setMentionsLastReadAt] = useMentionsLastReadAt();
  const [columns, addColumn, removeColumn, updateColumn, moveColumn, replaceColumns] = useDeckLayout();
  realtimeMentionScopeRef.current = {
    hasAllMentionsColumn: (columns ?? []).some(
      (column) => column.type === "mentions" && !column.teamId,
    ),
    hasAnyMentionsColumn: (columns ?? []).some(
      (column) => column.type === "mentions",
    ),
    teamIds: new Set(
      (columns ?? [])
        .filter((column) => column.type === "mentions" && column.teamId)
        .map((column) => column.teamId as string),
    ),
  };
  const [recentTargets, rememberRecentTarget] = useRecentTargets();
  const [savedViews, saveView, removeView, getView] = useSavedViews();
  const automaticThreadLayoutEnabled = (
    deckSettings.loaded &&
    deckSettings.autoAdjustThreadLayout
  );
  const hostLayout = useMattermostHostLayout(automaticThreadLayoutEnabled);
  const [threadLayoutOverride, setThreadLayoutOverride] = useState(false);
  const [
    railWidth,
    setRailWidth,
    persistRailWidth,
    threadLayoutMode,
    requestedRailWidth,
    maximumInteractiveRailWidth,
  ] = useRailWidth(
    drawerOpen,
    deckSettings.preferredRailWidth,
    hostLayout,
    threadLayoutOverride || !automaticThreadLayoutEnabled,
  );
  const autoCollapsed = (
    drawerOpen &&
    threadLayoutMode === "collapsed" &&
    !threadLayoutOverride
  );
  const effectiveDrawerOpen = drawerOpen && !autoCollapsed;
  const threadLayoutConstrained = (
    hostLayout.rightSidebarWidth > 0 &&
    threadLayoutMode !== "normal" &&
    !threadLayoutOverride
  );
  // Keep the resize handle available while the open Deck is temporarily
  // compacted for Mattermost's right pane. A real drag switches to a manual
  // override; an automatically collapsed Deck remains closed until the user
  // explicitly opens it with the drawer toggle.
  const canResizeRail = effectiveDrawerOpen;
  const [threadLayoutAnnouncement, setThreadLayoutAnnouncement] = useState("");
  const previousThreadLayoutModeRef = useRef<ResponsiveRailMode>("normal");
  const [isResizing, setIsResizing] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showViewsMenu, setShowViewsMenu] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showRailAddMenu, setShowRailAddMenu] = useState(false);
  const [viewReorderMode, setViewReorderMode] = useState(false);
  const [viewReorderDraft, setViewReorderDraft] = useState<DeckColumn[] | null>(null);
  const [railAddMenuPosition, setRailAddMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [isCompactHeader, setIsCompactHeader] = useState(false);
  const [focusedColumnId, setFocusedColumnId] = useState<string | null>(null);
  const [pendingScrollColumnId, setPendingScrollColumnId] = useState<string | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const drawerToggleRef = useRef<HTMLButtonElement | null>(null);
  const deckContentRef = useRef<HTMLDivElement | null>(null);
  const scrollWrapRef = useRef<HTMLDivElement | null>(null);
  const lastHorizontalScrollLeftRef = useRef(0);
  const threadScrollLeftRef = useRef<number | null>(null);
  const wasThreadConstrainedRef = useRef(false);
  const deckContentHadFocusRef = useRef(false);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousColumnRectsRef = useRef<Record<string, DOMRect>>({});
  const previousColumnOrderRef = useRef<string[]>([]);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const viewsMenuRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const railAddMenuRef = useRef<HTMLDivElement | null>(null);
  const railAddButtonRef = useRef<HTMLButtonElement | null>(null);
  const railAddOverlayMenuRef = useRef<HTMLDivElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const threadLayoutConstrainedRef = useRef(threadLayoutConstrained);
  threadLayoutConstrainedRef.current = threadLayoutConstrained;
  const resizeStateRef = useRef<{
    pointerId: number;
    didMove: boolean;
    startClientX: number;
    startRailWidth: number;
    startedThreadConstrained: boolean;
    overrideActivated: boolean;
  } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const wsStatus = useWebSocketStatus();
  const syncLogs = useSyncLogs();
  const runtimeMetrics = useRuntimePerformanceSnapshot(
    (columns ?? []).some((column) => column.type === "diagnostics"),
  );
  const mattermostThemeState = useMattermostThemeStyle(deckSettings.theme);
  const mattermostThemeStyle = mattermostThemeState.style;
  const apiHealthStatus = useApiHealth(state.status, deckSettings.healthCheckPath, deckSettings.pollingIntervalSeconds);
  const shellStyle = useMemo(
    () =>
      ({
        ...mattermostThemeStyle,
        ["--deck-font-scale"]: String(deckSettings.fontScalePercent / 100),
        ["--deck-column-width"]: `${normalisePreferredColumnWidth(deckSettings.preferredColumnWidth)}px`,
        ["--deck-density-scale"]: deckSettings.compactMode ? "0.86" : "1",
      }) as MattermostThemeStyle,
    [deckSettings.compactMode, deckSettings.fontScalePercent, deckSettings.preferredColumnWidth, mattermostThemeStyle],
  );

  useEffect(() => {
    userDirectoryRef.current = userDirectory;
  }, [userDirectory]);

  const scheduleMentionReconcile = useCallback((reason: string) => {
    const now = Date.now();
    const startedAt = mentionReconcileStartedAtRef.current ?? now;
    mentionReconcileStartedAtRef.current = startedAt;
    const remainingMs = Math.max(
      0,
      MENTION_RECONCILE_MAX_WAIT_MS - (now - startedAt),
    );
    const delayMs = Math.min(MENTION_RECONCILE_DEBOUNCE_MS, remainingMs);
    if (mentionReconcileTimerRef.current !== null) {
      window.clearTimeout(mentionReconcileTimerRef.current);
    }
    mentionReconcileTimerRef.current = window.setTimeout(() => {
      mentionReconcileTimerRef.current = null;
      mentionReconcileStartedAtRef.current = null;
      debugLog("app.ws.mention-reconcile", { reason });
      setMentionReconcileNonce((current) => current + 1);
    }, delayMs);
  }, []);

  useEffect(
    () => () => {
      if (mentionReconcileTimerRef.current !== null) {
        window.clearTimeout(mentionReconcileTimerRef.current);
      }
      mentionReconcileTimerRef.current = null;
      mentionReconcileStartedAtRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (hostLayout.rightSidebarWidth <= 0) {
      setThreadLayoutOverride(false);
    }
  }, [hostLayout.rightSidebarWidth]);

  useEffect(() => {
    const previousMode = previousThreadLayoutModeRef.current;
    if (previousMode === threadLayoutMode) {
      return;
    }

    if (threadLayoutMode === "compact") {
      setThreadLayoutAnnouncement(text.threadLayoutCompactStatus);
    } else if (threadLayoutMode === "collapsed") {
      setThreadLayoutAnnouncement(text.threadLayoutCollapsedStatus);
    } else {
      setThreadLayoutAnnouncement(text.threadLayoutRestoredStatus);
    }
    previousThreadLayoutModeRef.current = threadLayoutMode;
  }, [
    text.threadLayoutCollapsedStatus,
    text.threadLayoutCompactStatus,
    text.threadLayoutRestoredStatus,
    threadLayoutMode,
  ]);

  useLayoutEffect(() => {
    const wasConstrained = wasThreadConstrainedRef.current;
    const scrollWrap = scrollWrapRef.current;

    if (threadLayoutConstrained && !wasConstrained && scrollWrap) {
      threadScrollLeftRef.current = lastHorizontalScrollLeftRef.current;
    } else if (!threadLayoutConstrained && wasConstrained && scrollWrap) {
      const restoreLeft = threadScrollLeftRef.current;
      if (restoreLeft !== null) {
        scrollWrap.scrollLeft = restoreLeft;
        lastHorizontalScrollLeftRef.current = restoreLeft;
        window.requestAnimationFrame(() => {
          if (scrollWrap.isConnected) {
            scrollWrap.scrollLeft = restoreLeft;
          }
        });
      }
      threadScrollLeftRef.current = null;
    }

    wasThreadConstrainedRef.current = threadLayoutConstrained;
  }, [threadLayoutConstrained]);

  useLayoutEffect(() => {
    if (!autoCollapsed) {
      return;
    }

    const activeElement = shadowRoot?.activeElement;
    const contentContainsFocus = Boolean(
      activeElement &&
      deckContentRef.current?.contains(activeElement),
    );
    if (contentContainsFocus || deckContentHadFocusRef.current) {
      drawerToggleRef.current?.focus();
      deckContentHadFocusRef.current = false;
    }
  }, [autoCollapsed, shadowRoot]);

  useEffect(() => {
    setRealtimeAuthError(null);
  }, [deckSettings.wsPat]);
  useEffect(() => {
    setPostedEvents([]);
    setDeletedPostIds([]);
  }, [state.userId]);
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
            delete next[user.id];
            next[user.id] = user;
          }
          const directoryUserIds = Object.keys(next);
          while (
            directoryUserIds.length > USER_DIRECTORY_MAX_ENTRIES
          ) {
            const oldestUserId = directoryUserIds.shift();
            if (!oldestUserId) {
              break;
            }
            if (oldestUserId === state.userId) {
              directoryUserIds.push(oldestUserId);
              continue;
            }
            delete next[oldestUserId];
          }
          return next;
        });
      } catch {
        return;
      }
    },
    [state.userId],
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
  const formatRecentTargetLabel = useCallback(
    (target: RecentChannelTarget) => getRecentTargetLabel(target.channelLabel, userDirectory, state.userId),
    [state.userId, userDirectory],
  );

  const getColumnViewMeta = useCallback((column: DeckColumn) => {
    const root = columnRefs.current[column.id];
    const title = root?.querySelector(".deck-column-heading h2")?.textContent?.replace(/\s+/g, " ").trim();
    const subtitle = root?.querySelector(".deck-column-heading p")?.textContent?.replace(/\s+/g, " ").trim();
    return {
      title: title && title.length > 0 ? title : getColumnTitle(column.type),
      subtitle: subtitle && subtitle.length > 0 ? subtitle : undefined,
    };
  }, []);

  const healthStatusLabel = getApiHealthLabel(apiHealthStatus);
  const connectionModeLabel = realtimeAuthError ? text.pollingRealtimeAuthFailed : effectiveRealtimeEnabled ? text.realtime : text.polling;
  const syncStatusLabel = `${healthStatusLabel} / ${connectionModeLabel}`;
  const shouldSafeStop = shouldSafeStopDeckState(state);
  const handleOpenPost = useCallback(
    (post: MattermostPost, target?: OpenPostTarget) => {
      const targetTeam = target?.teamName ?? currentRoute.teamName;
      if (!targetTeam) {
        return;
      }
      openMattermostThread(targetTeam, { postId: post.id, rootId: post.root_id }, target?.channelName ?? currentRoute.channelName);
    },
    [currentRoute.channelName, currentRoute.teamName],
  );

  useEffect(() => {
    if (!__MATTERMOST_DECK_E2E_DEBUG__) {
      return;
    }

    try {
      if (window.localStorage.getItem(DEBUG_FLAG_KEY) !== "1") {
        return;
      }
      const handleDebugOpenThread = (event: Event) => {
        const customEvent = event as CustomEvent<{ teamName?: string; postId?: string; rootId?: string; channelName?: string }>;
        const teamName = customEvent.detail?.teamName;
        const postId = customEvent.detail?.postId;
        const rootId = customEvent.detail?.rootId;
        const channelName = customEvent.detail?.channelName;
        if (!teamName || !postId) {
          return;
        }
        openMattermostThread(teamName, { postId, rootId }, channelName ?? readDeckCurrentRoute().channelName);
      };
      window.addEventListener("mattermost-deck-debug-open-thread", handleDebugOpenThread as EventListener);
      return () => {
        window.removeEventListener("mattermost-deck-debug-open-thread", handleDebugOpenThread as EventListener);
      };
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("mattermost-deck-resizing", isResizing);
    return () => {
      document.body.classList.remove("mattermost-deck-resizing");
    };
  }, [isResizing]);

  useEffect(() => {
    if (!canResizeRail && isResizing) {
      resizeStateRef.current = null;
      setIsResizing(false);
    }
  }, [canResizeRail, isResizing]);

  useEffect(() => {
    if (!focusedColumnId) {
      return;
    }
    if ((columns ?? []).some((column) => column.id === focusedColumnId)) {
      return;
    }
    setFocusedColumnId(null);
  }, [columns, focusedColumnId]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || isResizing) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? shell.clientWidth;
      setIsCompactHeader(width < COMPACT_HEADER_BREAKPOINT_PX);
    });

    observer.observe(shell);
    setIsCompactHeader(shell.clientWidth < COMPACT_HEADER_BREAKPOINT_PX);
    return () => {
      observer.disconnect();
    };
  }, [drawerOpen, isResizing]);

  useEffect(() => {
    if (drawerOpen) {
      if (unmountTimerRef.current !== null) {
        window.clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
      setContentMounted(true);
    } else {
      unmountTimerRef.current = window.setTimeout(() => {
        setContentMounted(false);
        unmountTimerRef.current = null;
      }, DRAWER_UNMOUNT_DELAY_MS);
    }
    return () => {
      if (unmountTimerRef.current !== null) {
        window.clearTimeout(unmountTimerRef.current);
      }
    };
  }, [drawerOpen]);

  useLayoutEffect(() => {
    const currentColumns = columns ?? [];
    const currentOrder = currentColumns.map((column) => column.id);
    const previousOrder = previousColumnOrderRef.current;
    const nextRects: Record<string, DOMRect> = {};
    const animated: HTMLDivElement[] = [];
    const reduceMotion = getPreferredScrollBehavior() === "auto";

    for (const column of currentColumns) {
      const element = columnRefs.current[column.id];
      if (!element) {
        continue;
      }

      const nextRect = element.getBoundingClientRect();
      nextRects[column.id] = nextRect;
      const previousRect = previousColumnRectsRef.current[column.id];
      if (!previousRect || reduceMotion) {
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
    previousColumnOrderRef.current = currentOrder;

    const orderChanged =
      currentOrder.length !== previousOrder.length || currentOrder.some((id, index) => id !== previousOrder[index]);

    if (animated.length === 0 || !orderChanged) {
      for (const element of animated) {
        element.style.transition = "";
        element.style.transform = "";
      }
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

  const realtimeMentionKeySignature = state.currentUser
    ? JSON.stringify({
        username: state.currentUser.username,
        firstName: state.currentUser.first_name ?? "",
        notifyProps: state.currentUser.notify_props ?? {},
        groupNames: state.currentUser.mention_group_names ?? [],
        collapsedReplyThreads:
          state.currentUser.collapsed_reply_threads === true,
      })
    : "";
  const realtimeMentionKeys = useMemo(
    () =>
      state.currentUser
        ? getMattermostMentionKeys(state.currentUser)
        : [],
    [realtimeMentionKeySignature],
  );

  useEffect(() => {
    if (!state.username) {
      return;
    }

    let websocketEffectActive = true;
    let postedEventMetadataSequence = 0;
    const pendingPostedEventMetadata = new Map<string, number>();

    const publishPostedEvent = (event: PostedEvent) => {
      if (
        !websocketEffectActive ||
        deletedPostIdsRef.current.has(event.post.id)
      ) {
        return;
      }

      const channelWideMentionsEnabled =
        state.currentUser?.notify_props?.channel === "true";
      const mentionsCurrentUser = state.userId
        ? postMatchesRealtimeMentionCandidate(
            event.post,
            event.channelType,
            state.userId,
            realtimeMentionKeys,
            event.mentionsUser,
            channelWideMentionsEnabled,
          )
        : false;
      const localEvent: PostedEvent = {
        ...event,
        // Recompute this from the current user's notification keys. The
        // generic WebSocket parser recognizes @channel/@all/@here, but it
        // does not know whether this user disabled channel-wide mentions.
        mentionsUser: mentionsCurrentUser,
      };
      debugLog("app.ws.posted", {
        eventType: localEvent.eventType,
        channelId: localEvent.channelId,
        channelType: localEvent.channelType ?? null,
        teamId: localEvent.teamId ?? null,
        mentionsUser: localEvent.mentionsUser,
        postId: localEvent.post.id,
      });
      setPostedEvents((current) =>
        appendPostedEvent(current, localEvent, POSTED_EVENT_BUFFER_SIZE),
      );
      if (localEvent.eventType === "post_edited") {
        invalidatePostByIdCache(localEvent.post.id);
      }

      const mentionScope = realtimeMentionScopeRef.current;
      const affectsMentionScope =
        mentionScope.hasAllMentionsColumn ||
        (
          localEvent.teamId &&
          mentionScope.teamIds.has(localEvent.teamId)
        ) ||
        localEvent.channelType === "D" ||
        localEvent.channelType === "G";
      const commentsNotify =
        state.currentUser?.notify_props?.comments;
      const needsImplicitMentionContext =
        mentionScope.hasAnyMentionsColumn &&
        affectsMentionScope &&
        !localEvent.mentionsUser &&
        Boolean(localEvent.post.root_id) &&
        localEvent.post.user_id !== state.userId &&
        state.currentUser?.collapsed_reply_threads !== true &&
        (commentsNotify === "root" || commentsNotify === "any");
      const rootId = localEvent.post.root_id;
      if (
        needsImplicitMentionContext &&
        rootId &&
        implicitMentionReconcilePostIdsRef.current.size <
          MAX_IMPLICIT_MENTION_RECONCILES_IN_FLIGHT &&
        !implicitMentionReconcilePostIdsRef.current.has(localEvent.post.id)
      ) {
        implicitMentionReconcilePostIdsRef.current.add(localEvent.post.id);
        debugLog("app.ws.mention-context-reconcile", {
          teamId: localEvent.teamId ?? null,
          channelId: localEvent.channelId,
          postId: localEvent.post.id,
          rootId,
        });
        const threadContext =
          commentsNotify === "any"
            ? getPostThreadSinceWithMetadata(rootId, 0, 200, 200)
            : Promise.resolve({
                posts: [] as MattermostPost[],
                truncated: false,
              });
        void Promise.all([
          getPostsByIds([rootId]),
          threadContext,
        ])
          .then(([rootPosts, { posts: threadPosts, truncated }]) => {
            if (
              !websocketEffectActive ||
              deletedPostIdsRef.current.has(localEvent.post.id)
            ) {
              return;
            }
            const reconciledThreadPosts = [
              ...threadPosts.filter(
                (post) => post.id !== localEvent.post.id
              ),
              localEvent.post,
            ];
            if (
              !postMatchesBoundedImplicitMention(
                localEvent.post,
                rootPosts[0],
                reconciledThreadPosts,
                {
                  currentUserId: state.userId ?? "",
                  collapsedReplyThreads: false,
                  commentsNotify,
                },
                truncated,
              )
            ) {
              return;
            }
            setPostedEvents((current) =>
              appendPostedEvent(
                current,
                { ...localEvent, mentionsUser: true },
                POSTED_EVENT_BUFFER_SIZE,
              )
            );
          })
          .catch((error: unknown) => {
            debugLog("app.ws.mention-context-reconcile-failed", {
              postId: localEvent.post.id,
              message:
                error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            implicitMentionReconcilePostIdsRef.current.delete(
              localEvent.post.id,
            );
          });
      }
    };

    const disconnect = connectMattermostWebSocket({
      userId: state.userId,
      username: state.username,
      enabled: effectiveRealtimeEnabled && !state.sessionExpired,
      token: deckSettings.wsPat,
      onReconnect: () => {
        debugLog("app.ws.reconnect-refresh", { reason: "websocket-reconnect" });
        setStateRefreshNonce((current) => current + 1);
        setReconnectNonce((current) => current + 1);
      },
      onPosted: (event) => {
        pendingPostedEventMetadata.delete(event.post.id);
        publishPostedEvent(event);
        if (!postedEventNeedsChannelMetadata(event)) {
          return;
        }

        const metadataSequence = ++postedEventMetadataSequence;
        pendingPostedEventMetadata.set(event.post.id, metadataSequence);
        void getChannelsByIds([event.channelId])
          .then(([channel]) => {
            if (
              !websocketEffectActive ||
              !channel ||
              pendingPostedEventMetadata.get(event.post.id) !==
                metadataSequence ||
              deletedPostIdsRef.current.has(event.post.id)
            ) {
              return;
            }
            publishPostedEvent(
              withPostedEventChannelMetadata(event, channel),
            );
          })
          .catch((error: unknown) => {
            if (
              websocketEffectActive &&
              pendingPostedEventMetadata.get(event.post.id) ===
                metadataSequence
            ) {
              debugLog("app.ws.posted-channel-metadata-failed", {
                channelId: event.channelId,
                postId: event.post.id,
                message:
                  error instanceof Error ? error.message : String(error),
              });
              // A bounded mentions refresh is the fallback if the targeted
              // lookup is temporarily unavailable.
              scheduleMentionReconcile("posted-channel-metadata-failed");
            }
          })
          .finally(() => {
            if (
              pendingPostedEventMetadata.get(event.post.id) ===
              metadataSequence
            ) {
              pendingPostedEventMetadata.delete(event.post.id);
            }
          });
      },
      onPostDeleted: (postId) => {
        debugLog("app.ws.post-deleted", { postId });
        pendingPostedEventMetadata.delete(postId);
        invalidatePostByIdCache(postId);
        setPostedEvents((current) =>
          current.filter((event) => event.post.id !== postId),
        );
        const nextDeletedPostIds = [
          ...Array.from(deletedPostIdsRef.current).filter(
            (currentPostId) => currentPostId !== postId,
          ),
          postId,
        ].slice(-POSTED_EVENT_BUFFER_SIZE);
        deletedPostIdsRef.current = new Set(nextDeletedPostIds);
        setDeletedPostIds(nextDeletedPostIds);
      },
      onMentionMetadataChanged: () => {
        debugLog("app.ws.mention-metadata-refresh", {
          reason: "mention-definition-changed",
        });
        invalidateMentionMetadataCaches();
        setMentionMetadataNonce((current) => current + 1);
        setStateRefreshNonce((current) => current + 1);
        scheduleMentionReconcile("mention-definition-changed");
      },
      onUnreadChanged: (change) => {
        const hasChannelMarkers =
          Object.keys(change.channelLastViewedAt).length > 0;
        const hasThreadMarkers =
          Object.keys(change.threadLastViewedAt).length > 0;
        if (hasChannelMarkers || hasThreadMarkers) {
          debugLog("app.ws.unread-local-update", {
            eventType: change.eventType,
            channelCount: Object.keys(change.channelLastViewedAt).length,
            threadCount: Object.keys(change.threadLastViewedAt).length,
          });
          setRealtimeReadMarkers((current) =>
            mergeMentionReadMarkers(current, change)
          );
          return;
        }

        if (isChannelReadStateEvent(change.eventType)) {
          if (change.channelIds.length === 0) {
            debugLog("app.ws.unread-local-noop", {
              eventType: change.eventType,
              reason: "channel-read-event-without-markers",
            });
            return;
          }
          debugLog("app.ws.unread-marker-lookup", {
            eventType: change.eventType,
            channelCount: change.channelIds.length,
          });
          void Promise.all(
            change.channelIds.map(async (channelId) => {
              for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                  return await getMyChannelMember(channelId, { fresh: true });
                } catch (error) {
                  if (
                    isMattermostSessionExpiredError(error) ||
                    attempt === 1
                  ) {
                    return null;
                  }
                  await new Promise((resolve) =>
                    window.setTimeout(resolve, 750)
                  );
                  if (!websocketEffectActive) {
                    return null;
                  }
                }
              }
              return null;
            }),
          ).then((members) => {
            if (!websocketEffectActive) {
              return;
            }
            const channelLastViewedAt = Object.fromEntries(
              members.flatMap((member) =>
                member?.channel_id && member.last_viewed_at !== undefined
                  ? [[
                      member.channel_id,
                      Math.max(0, member.last_viewed_at),
                    ] as const]
                  : []
              ),
            );
            if (Object.keys(channelLastViewedAt).length > 0) {
              setRealtimeReadMarkers((current) =>
                mergeMentionReadMarkers(current, {
                  channelLastViewedAt,
                  threadLastViewedAt: {},
                })
              );
            } else {
              debugLog("app.ws.unread-marker-lookup-failed", {
                eventType: change.eventType,
                channelCount: change.channelIds.length,
                reason: "read-marker-will-reconcile-on-next-poll",
              });
            }
          });
          return;
        }

        if (
          change.eventType === "thread_read_changed" ||
          change.eventType === "post_unread"
        ) {
          if (change.eventType === "post_unread") {
            setRealtimeReadMarkers((current) =>
              invalidateMentionReadMarkers(current, change)
            );
          }
          debugLog("app.ws.unread-mentions-refresh", {
            eventType: change.eventType,
            reason: "read-marker-not-in-event",
          });
          setMentionReadRefreshNonce((current) => current + 1);
          return;
        }

        debugLog("app.ws.unread-structural-refresh", {
          eventType: change.eventType,
          reason: "channel-or-membership-changed",
        });
        setStateRefreshNonce((current) => current + 1);
        setReconnectNonce((current) => current + 1);
      },
      onAuthFailure: (message) => {
        setRealtimeAuthError(message);
      },
    });
    return () => {
      websocketEffectActive = false;
      pendingPostedEventMetadata.clear();
      disconnect();
    };
  }, [
    deckSettings.wsPat,
    effectiveRealtimeEnabled,
    realtimeMentionKeys,
    scheduleMentionReconcile,
    state.sessionExpired,
    state.userId,
    state.username,
  ]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || event.pointerId !== resizeState.pointerId) {
        return;
      }

      // Preserve the point where the user grabbed the 14px handle. Using the
      // viewport edge directly makes a centered grab introduce a 7px jump and
      // can briefly move in the opposite direction.
      const nextWidth = (
        resizeState.startRailWidth +
        resizeState.startClientX -
        event.clientX
      );
      if (
        threadLayoutConstrainedRef.current &&
        !resizeState.overrideActivated
      ) {
        if (resizeState.startedThreadConstrained) {
          const dragDistance = Math.abs(
            resizeState.startClientX - event.clientX,
          );
          const normalizedNextWidth = clampRailWidth(nextWidth);
          const renderedDelta = normalizedNextWidth - resizeState.startRailWidth;
          const pointerDelta = nextWidth - resizeState.startRailWidth;
          if (
            dragDistance < RAIL_RESIZE_DRAG_THRESHOLD_PX ||
            renderedDelta === 0 ||
            Math.sign(renderedDelta) !== Math.sign(pointerDelta) ||
            (
              resizeState.startRailWidth < MIN_RAIL_WIDTH &&
              nextWidth < MIN_RAIL_WIDTH
            )
          ) {
            return;
          }
        }

        resizeState.overrideActivated = true;
        resizeState.didMove = true;
        // Apply the pointer-derived width in the same turn as the override so
        // the rail never jumps back to the previously requested width.
        setRailWidth(nextWidth);
        setThreadLayoutOverride(true);
        return;
      }

      if (!resizeState.didMove) {
        if (event.clientX === resizeState.startClientX) {
          return;
        }
        resizeState.didMove = true;
      }
      pendingWidthRef.current = nextWidth;
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

      const didMove = resizeStateRef.current.didMove;
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
      if (didMove) {
        persistRailWidth();
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
  }, [persistRailWidth, setRailWidth]);

  useEffect(() => {
    const root = document.getElementById(DECK_ROOT_ID);
    if (!root) return;
    root.style.transition = isResizing ? "none" : "";
  }, [isResizing]);

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!canResizeRail) {
      return;
    }

    resizeStateRef.current = {
      pointerId: event.pointerId,
      didMove: false,
      startClientX: event.clientX,
      startRailWidth: railWidth,
      startedThreadConstrained: threadLayoutConstrained,
      overrideActivated: threadLayoutOverride,
    };
    setIsResizing(true);
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!canResizeRail || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
      return;
    }

    const step = event.shiftKey ? 80 : 32;
    const nextWidth = railWidth + (event.key === "ArrowLeft" ? step : -step);
    if (
      threadLayoutConstrained &&
      event.key === "ArrowRight" &&
      nextWidth < MIN_RAIL_WIDTH
    ) {
      event.preventDefault();
      return;
    }
    if (threadLayoutConstrained) {
      setThreadLayoutOverride(true);
    }
    persistRailWidth(nextWidth);
    event.preventDefault();
  };

  const handleDrawerToggle = () => {
    if (!effectiveDrawerOpen && threadLayoutMode === "collapsed") {
      setThreadLayoutOverride(true);
      if (!drawerOpen) {
        setDrawerOpen(true);
      }
      return;
    }

    setDrawerOpen(!drawerOpen);
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
    defaults?: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>,
  ): string => {
    const nextId = addColumn(type, defaults);
    setPendingScrollColumnId(nextId);
    setShowAddMenu(false);
    setShowViewsMenu(false);
    setShowActionsMenu(false);
    setShowRailAddMenu(false);
    return nextId;
  };

  const handleAddCurrentChannelWatch = useCallback(() => {
    if (!state.currentChannelId) {
      return "";
    }

    return handleAddColumn(
      state.currentTeamId ? "channelWatch" : "dmWatch",
      {
        teamId: state.currentTeamId,
        channelId: state.currentChannelId,
      },
    );
  }, [handleAddColumn, state.currentChannelId, state.currentTeamId]);

  useEffect(() => {
    if (!pendingScrollColumnId) {
      return;
    }
    const element = columnRefs.current[pendingScrollColumnId];
    if (!element) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      element.scrollIntoView({
        behavior: getPreferredScrollBehavior(),
        block: "nearest",
        inline: "end",
      });
      setPendingScrollColumnId(null);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [columns, pendingScrollColumnId]);

  useEffect(() => {
    if (!showAddMenu && !showViewsMenu && !showActionsMenu && !showRailAddMenu) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setShowAddMenu(false);
      setShowViewsMenu(false);
      setShowActionsMenu(false);
      setShowRailAddMenu(false);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [showActionsMenu, showAddMenu, showRailAddMenu, showViewsMenu]);

  useLayoutEffect(() => {
    if (!showRailAddMenu) {
      setRailAddMenuPosition(null);
      return;
    }

    const shell = shellRef.current;
    const button = railAddButtonRef.current;
    if (!shell || !button) {
      return;
    }

    const updatePosition = () => {
      const shellRect = shell.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const estimatedHeight = 360;
      const margin = 12;
      const belowTop = buttonRect.bottom - shellRect.top + 8;
      const aboveTop = buttonRect.top - shellRect.top - estimatedHeight - 8;
      const top = aboveTop >= margin ? aboveTop : Math.min(Math.max(margin, belowTop), shellRect.height - estimatedHeight - margin);
      const right = Math.max(margin, shellRect.right - buttonRect.right);
      setRailAddMenuPosition({ top, right });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [showRailAddMenu]);

  useEffect(() => {
    if (!showAddMenu && !showViewsMenu && !showActionsMenu && !showRailAddMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      const clickedInside =
        (addMenuRef.current && path.includes(addMenuRef.current)) ||
        (viewsMenuRef.current && path.includes(viewsMenuRef.current)) ||
        (actionsMenuRef.current && path.includes(actionsMenuRef.current)) ||
        (railAddMenuRef.current && path.includes(railAddMenuRef.current)) ||
        (railAddOverlayMenuRef.current && path.includes(railAddOverlayMenuRef.current));

      if (clickedInside) {
        return;
      }

      setShowAddMenu(false);
      setShowViewsMenu(false);
      setShowActionsMenu(false);
      setShowRailAddMenu(false);
    };

    const target: EventTarget = shadowRoot ?? document;
    target.addEventListener("pointerdown", handlePointerDown as EventListener, true);
    return () => {
      target.removeEventListener("pointerdown", handlePointerDown as EventListener, true);
    };
  }, [showActionsMenu, showAddMenu, showRailAddMenu, showViewsMenu]);

  const handleSaveCurrentView = () => {
    const currentColumns = columns ?? [];
    if (currentColumns.length === 0) {
      return;
    }

    const name = window.prompt(text.viewNamePrompt, "");
    if (!name) {
      return;
    }

    saveView(name, currentColumns);
    setShowViewsMenu(false);
    setShowActionsMenu(false);
    setShowRailAddMenu(false);
  };

  const handleLoadSavedView = (id: string) => {
    const view = getView(id);
    if (!view) {
      return;
    }

    replaceColumns(view.columns);
    setShowViewsMenu(false);
    setShowActionsMenu(false);
    setShowRailAddMenu(false);
  };

  const handleFocusColumn = (id: string) => {
    const element = columnRefs.current[id];
    if (!element) {
      return;
    }

    element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    setShowViewsMenu(false);
    setShowActionsMenu(false);
    setShowRailAddMenu(false);
  };

  const handleCloseColumnFromMenu = (id: string) => {
    removeColumn(id);
    setShowViewsMenu(false);
    setShowActionsMenu(false);
    setShowRailAddMenu(false);
  };

  const handleStartViewReorder = () => {
    setViewReorderDraft([...(columns ?? [])]);
    setViewReorderMode(true);
  };

  const handleCancelViewReorder = () => {
    setViewReorderMode(false);
    setViewReorderDraft(null);
  };

  const handleApplyViewReorder = () => {
    if (viewReorderDraft) {
      replaceColumns(viewReorderDraft);
    }
    setViewReorderMode(false);
    setViewReorderDraft(null);
  };

  const handleMoveViewDraft = (id: string, direction: "up" | "down") => {
    setViewReorderDraft((current) => {
      if (!current) {
        return current;
      }
      const index = current.findIndex((column) => column.id === id);
      if (index < 0) {
        return current;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [column] = next.splice(index, 1);
      next.splice(targetIndex, 0, column);
      return next;
    });
  };

  useEffect(() => {
    if (!showViewsMenu && viewReorderMode) {
      setViewReorderMode(false);
      setViewReorderDraft(null);
    }
  }, [showViewsMenu, viewReorderMode]);

  const handleExportLayout = () => {
    const payload = JSON.stringify({ columns: columns ?? [] }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mattermost-deck-layout.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setShowActionsMenu(false);
    setShowRailAddMenu(false);
  };

  const handleImportLayout = () => {
    importFileInputRef.current?.click();
  };

  const handleImportFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { columns?: DeckColumn[] };
      if (!Array.isArray(parsed.columns)) {
        return;
      }
      replaceColumns(normaliseColumns(parsed.columns));
      setShowActionsMenu(false);
      setShowRailAddMenu(false);
    } catch {
      return;
    }
  };

  useEffect(() => {
    if (!__MATTERMOST_DECK_E2E_DEBUG__) {
      return;
    }

    if (!isDebugEnabled()) {
      delete window.__mattermostDeckDebug;
      return;
    }

    const debugShadowRoot = shadowRoot;

    window.__mattermostDeckDebug = {
      getState: () => ({
        contentMounted,
        stateStatus: state.status,
        username: state.username,
        routeKey: currentRouteKey,
        currentTeamId: state.currentTeamId,
        currentChannelId: state.currentChannelId,
        currentTeamLabel: state.currentTeamLabel,
        currentChannelLabel: state.currentChannelLabel,
        wsStatus,
        drawerOpen,
        effectiveDrawerOpen,
        railWidth,
        requestedRailWidth,
        focusedColumnId,
        maximumInteractiveRailWidth,
        autoAdjustThreadLayout: deckSettings.autoAdjustThreadLayout,
        canResizeRail,
        threadLayoutMode: (
          threadLayoutOverride && hostLayout.rightSidebarWidth > 0
            ? "override"
            : threadLayoutMode
        ),
        hostLayout,
        hostLayoutMeasurementCount,
        userTimingMeasureCount:
          window.performance.getEntriesByType("measure").length,
        horizontalScrollLeft: scrollWrapRef.current?.scrollLeft ?? 0,
        columns: (columns ?? []).map((column) => ({
          id: column.id,
          type: column.type,
          teamId: column.teamId,
          channelId: column.channelId,
          query: column.query,
          unreadOnly: column.unreadOnly,
        })),
      }),
      getThemeState: () => ({
        initialSource: mattermostThemeState.initialSource,
        activeTheme: deckSettings.theme,
        style: toDeckDebugStyleRecord(mattermostThemeStyle) ?? {},
        cacheKey: deckSettings.theme === "mattermost" ? getMattermostThemeCacheStorageKey() : null,
        cachedStyle: deckSettings.theme === "mattermost"
          ? toDeckDebugStyleRecord(loadCachedMattermostThemeStyle())
          : null,
      }),
      addColumn: handleAddColumn,
      updateColumn,
      moveColumn,
      removeColumn,
    };

    const debugApi = window.__mattermostDeckDebug;

    const handleDebugRequest = (event: Event) => {
      const customEvent = event as CustomEvent<{
        id?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }>;
      const requestId = customEvent.detail?.id;
      const action = customEvent.detail?.action;
      const payload = customEvent.detail?.payload ?? {};
      if (!requestId || !action) {
        return;
      }

      const getDebugColumnScope = (
        columnId: unknown,
      ): Element | ShadowRoot | null => {
        if (!debugShadowRoot) {
          return null;
        }
        if (typeof columnId !== "string" || !columnId) {
          return debugShadowRoot;
        }
        return Array.from(
          debugShadowRoot.querySelectorAll("[data-deck-column-id]"),
        ).find(
          (element) =>
            element.getAttribute("data-deck-column-id") === columnId,
        ) ?? null;
      };

      let result: unknown = null;
      if (action === "getState") {
        result = debugApi?.getState() ?? null;
      } else if (action === "setHorizontalScrollLeft") {
        const next = Number(payload.value);
        if (scrollWrapRef.current && Number.isFinite(next)) {
          scrollWrapRef.current.scrollLeft = next;
          lastHorizontalScrollLeftRef.current = scrollWrapRef.current.scrollLeft;
          result = scrollWrapRef.current.scrollLeft;
        }
      } else if (action === "clearColumnFocus") {
        setFocusedColumnId(null);
        result = true;
      } else if (action === "ensureDrawerOpen") {
        if (!effectiveDrawerOpen) {
          setThreadLayoutOverride(true);
          if (!drawerOpen) {
            setDrawerOpen(true);
          }
        }
        result = true;
      } else if (action === "getThemeState") {
        result = debugApi?.getThemeState() ?? null;
      } else if (action === "addColumn") {
        result = handleAddColumn(
          payload.type as DeckColumnType,
          payload.defaults as Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">> | undefined,
        );
      } else if (action === "updateColumn") {
        updateColumn(
          payload.id as string,
          payload.patch as Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">>,
        );
      } else if (action === "moveColumn") {
        moveColumn(payload.id as string, payload.direction as "left" | "right");
      } else if (action === "removeColumn") {
        removeColumn(payload.id as string);
      } else if (action === "getColumnState") {
        result = window.__mattermostDeckDebugColumnState?.[payload.id as string] ?? null;
      } else if (action === "getRenderedText" && debugShadowRoot) {
        result = debugShadowRoot.textContent?.replace(/\s+/g, " ").trim() ?? "";
      } else if (action === "getHighlightTexts" && debugShadowRoot) {
        result = Array.from(debugShadowRoot.querySelectorAll("mark.search-highlight"))
          .map((element) => element.textContent?.trim() ?? "")
          .filter(Boolean);
      } else if (action === "getHighlightStyle" && debugShadowRoot) {
        const mark = debugShadowRoot.querySelector("mark.search-highlight");
        if (mark instanceof HTMLElement) {
          const style = window.getComputedStyle(mark);
          result = {
            color: style.color,
            backgroundColor: style.backgroundColor,
            boxShadow: style.boxShadow,
          };
        } else {
          result = null;
        }
      } else if (action === "getLoadingState" && debugShadowRoot) {
        const loadingState = debugShadowRoot.querySelector(".deck-loading-state");
        result = {
          present: Boolean(loadingState),
          spinnerPresent: Boolean(debugShadowRoot.querySelector(".deck-loading-spinner")),
          skeletonCount: debugShadowRoot.querySelectorAll(".deck-loading-skeleton").length,
          text: loadingState?.querySelector("strong")?.textContent?.trim() ?? null,
        };
      } else if (action === "getMentionLoadingProgress" && debugShadowRoot) {
        const columnScope = getDebugColumnScope(payload.id);
        const progressState = columnScope?.querySelector(
          ".deck-column-loading-status",
        );
        result = {
          present: Boolean(progressState),
          spinnerPresent: Boolean(
            progressState?.querySelector(".deck-loading-spinner"),
          ),
          text: progressState?.textContent?.replace(/\s+/g, " ").trim() ?? null,
          completed: Number(
            progressState?.getAttribute("data-completed") ?? 0,
          ),
          total: Number(
            progressState?.getAttribute("data-total") ?? 0,
          ),
        };
      } else if (
        action === "getMentionPresentationState" &&
        debugShadowRoot
      ) {
        const columnScope = getDebugColumnScope(payload.id);
        const viewport = columnScope?.querySelector(
          ".deck-list-viewport",
        );
        const firstPostCard = columnScope?.querySelector(
          ".deck-card--post",
        );
        const progressState = columnScope?.querySelector(
          ".deck-column-loading-status",
        );
        const updateButton = columnScope?.querySelector(
          ".deck-mention-updates-button",
        );
        const viewportRect =
          viewport instanceof HTMLElement
            ? viewport.getBoundingClientRect()
            : null;
        const firstPostRect =
          firstPostCard instanceof HTMLElement
            ? firstPostCard.getBoundingClientRect()
            : null;
        result = {
          progressPresent: Boolean(progressState),
          updateButtonPresent: Boolean(updateButton),
          updateCount: Number(
            updateButton?.getAttribute("data-update-count") ?? 0,
          ),
          updateButtonText:
            updateButton?.textContent?.replace(/\s+/g, " ").trim() ??
            null,
          newPostsButtonPresent: Boolean(
            columnScope?.querySelector(".deck-new-posts-button"),
          ),
          newPostCount: Number(
            columnScope
              ?.querySelector(".deck-new-posts-button")
              ?.getAttribute("data-new-post-count") ?? 0,
          ),
          listFocused: Boolean(
            debugShadowRoot.activeElement?.matches(
              "[data-deck-mention-apply-focus='true']",
            ),
          ),
          skeletonCount:
            columnScope?.querySelectorAll(
              ".deck-loading-skeleton",
            ).length ?? 0,
          viewportTop: viewportRect?.top ?? null,
          viewportScrollTop:
            viewport instanceof HTMLElement
              ? viewport.scrollTop
              : null,
          firstPostTop: firstPostRect?.top ?? null,
          firstPostHeight: firstPostRect?.height ?? null,
        };
      } else if (
        action === "setMentionScrollTop" &&
        debugShadowRoot
      ) {
        const columnScope = getDebugColumnScope(payload.id);
        const viewport = columnScope?.querySelector(
          ".deck-list-viewport",
        );
        if (viewport instanceof HTMLElement) {
          const nextScrollTop = Number(payload.value);
          viewport.scrollTop = Number.isFinite(nextScrollTop)
            ? nextScrollTop
            : 0;
          viewport.dispatchEvent(new Event("scroll", {
            bubbles: true,
          }));
          result = viewport.scrollTop;
        }
      } else if (
        action === "markMentionInteraction" &&
        debugShadowRoot
      ) {
        const columnScope = getDebugColumnScope(payload.id);
        const viewport = columnScope?.querySelector(
          ".deck-list-viewport",
        );
        if (viewport instanceof HTMLElement) {
          viewport.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true,
          }));
          result = true;
        } else {
          result = false;
        }
      } else if (
        action === "applyMentionUpdates" &&
        debugShadowRoot
      ) {
        const columnScope = getDebugColumnScope(payload.id);
        const updateButton = columnScope?.querySelector(
          ".deck-mention-updates-button",
        );
        if (updateButton instanceof HTMLButtonElement) {
          updateButton.click();
          result = true;
        } else {
          result = false;
        }
      } else if (
        action === "clickMentionControl" &&
        debugShadowRoot
      ) {
        const columnScope = getDebugColumnScope(payload.id);
        const control = String(payload.control ?? "");
        let button: Element | null = null;
        if (control === "expandControls") {
          const controls = columnScope?.querySelector(
            ".deck-stack--controls",
          );
          if (controls) {
            result = true;
          } else {
            const headerButtons = columnScope?.querySelectorAll(
              ".deck-column-actions > button",
            );
            button =
              headerButtons?.[headerButtons.length - 1] ?? null;
          }
        } else if (control === "collapseControls") {
          const controls = columnScope?.querySelector(
            ".deck-stack--controls",
          );
          if (!controls) {
            result = true;
          } else {
            const headerButtons = columnScope?.querySelectorAll(
              ".deck-column-actions > button",
            );
            button =
              headerButtons?.[headerButtons.length - 1] ?? null;
          }
        } else if (control === "toggleControls") {
          const headerButtons = columnScope?.querySelectorAll(
            ".deck-column-actions > button",
          );
          button = headerButtons?.[headerButtons.length - 1] ?? null;
        } else if (control === "applyUpdates") {
          button = columnScope?.querySelector(
            ".deck-mention-updates-button",
          ) ?? null;
        } else if (control === "jumpLatest") {
          button = columnScope?.querySelector(
            ".deck-new-posts-button",
          ) ?? null;
        } else {
          if (
            control === "focus" &&
            columnScope instanceof Element &&
            columnScope.classList.contains("deck-column--pane-focused")
          ) {
            button = columnScope.querySelector(
              ".deck-column-actions .deck-icon-button--active",
            );
          } else {
            const toolbarButtons = columnScope?.querySelectorAll(
              ".deck-stack--controls .deck-inline-actions > button",
            );
            const toolbarButtonIndex: Record<string, number> = {
              moveLeft: 0,
              moveRight: 1,
              refresh: 2,
              pause: 3,
              focus: 4,
            };
            const index = toolbarButtonIndex[control];
            button =
              index === undefined
                ? null
                : toolbarButtons?.[index] ?? null;
          }
        }
        if (
          button instanceof HTMLButtonElement &&
          !button.disabled
        ) {
          button.click();
          result = true;
        } else if (result !== true) {
          result = false;
        }
      } else if (action === "getPostCardState" && debugShadowRoot) {
        const textToFind = String(payload.text ?? "");
        const columnScope = getDebugColumnScope(payload.columnId);
        const postCard = Array.from(
          columnScope?.querySelectorAll(".deck-card--post") ?? [],
        ).find((card) => card.textContent?.includes(textToFind));
        const viewport = postCard?.closest(".deck-list-viewport");
        const postRect =
          postCard instanceof HTMLElement
            ? postCard.getBoundingClientRect()
            : null;
        const viewportRect =
          viewport instanceof HTMLElement
            ? viewport.getBoundingClientRect()
            : null;
        result = {
          present: Boolean(postCard),
          clickable: postCard?.classList.contains(
            "deck-card--clickable",
          ) ?? false,
          role: postCard?.getAttribute("role") ?? null,
          top: postRect?.top ?? null,
          height: postRect?.height ?? null,
          relativeTop:
            postRect && viewportRect
              ? postRect.top - viewportRect.top
              : null,
          viewportTop: viewportRect?.top ?? null,
          viewportScrollTop:
            viewport instanceof HTMLElement
              ? viewport.scrollTop
              : null,
        };
      } else if (action === "getUnreadDebugInfo" && debugShadowRoot) {
        result = {
          shellTheme: debugShadowRoot.querySelector(".deck-shell")?.getAttribute("data-theme") ?? null,
          postCardCount: debugShadowRoot.querySelectorAll(".deck-post-card").length,
          unreadSeparatorCount: debugShadowRoot.querySelectorAll(".deck-list-separator--unread").length,
          separatorLabels: Array.from(debugShadowRoot.querySelectorAll(".deck-list-separator"))
            .map((element) => element.textContent?.trim() ?? "")
            .filter(Boolean),
        };
      } else if (action === "getUnreadMarkReadStyle" && debugShadowRoot) {
        const separator = debugShadowRoot.querySelector(".deck-list-separator--unread");
        const toggle = separator?.querySelector(".deck-unread-mark-read-toggle");
        if (separator instanceof HTMLElement && toggle instanceof HTMLElement) {
          separator.classList.add("deck-list-separator--preview-active");
          const style = window.getComputedStyle(toggle);
          result = {
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            shellTheme: debugShadowRoot.querySelector(".deck-shell")?.getAttribute("data-theme") ?? null,
            actionLabelVisible: window.getComputedStyle(
              toggle.querySelector(".deck-unread-mark-read-toggle-label--action") as Element,
            ).display,
          };
          separator.classList.remove("deck-list-separator--preview-active");
        } else {
          result = null;
        }
      }

      window.dispatchEvent(new CustomEvent("mattermost-deck-debug-response", {
        detail: { id: requestId, result },
      }));
    };

    window.addEventListener("mattermost-deck-debug-request", handleDebugRequest as EventListener);

    return () => {
      window.removeEventListener("mattermost-deck-debug-request", handleDebugRequest as EventListener);
      delete window.__mattermostDeckDebug;
    };
  }, [
    columns,
    canResizeRail,
    contentMounted,
    currentRouteKey,
    deckSettings.autoAdjustThreadLayout,
    deckSettings.theme,
    drawerOpen,
    effectiveDrawerOpen,
    handleAddColumn,
    hostLayout,
    focusedColumnId,
    mattermostThemeState.initialSource,
    mattermostThemeStyle,
    maximumInteractiveRailWidth,
    moveColumn,
    railWidth,
    removeColumn,
    requestedRailWidth,
    state.currentChannelId,
    state.currentChannelLabel,
    state.currentTeamId,
    state.currentTeamLabel,
    state.status,
    state.username,
    threadLayoutMode,
    threadLayoutOverride,
    updateColumn,
    wsStatus,
  ]);

  const isInitialLoading =
    state.status === "loading" ||
    (columns === null && state.status !== "error");

  return (
    <ShadowRootContext.Provider value={shadowRoot}>
    <aside
      ref={shellRef}
      className={`deck-shell${effectiveDrawerOpen ? "" : " deck-shell--collapsed"}`}
      aria-label="Mattermost Deck"
      lang={deckSettings.language}
      data-theme={deckSettings.theme === "mattermost" ? "mattermost" : resolveTheme(deckSettings.theme)}
      data-column-color-enabled={deckSettings.columnColorEnabled ? "true" : "false"}
      data-thread-layout-mode={
        threadLayoutOverride && hostLayout.rightSidebarWidth > 0
          ? "override"
          : threadLayoutMode
      }
      style={shellStyle}
    >
      <input
        ref={importFileInputRef}
        type="file"
        accept="application/json,.json"
        className="deck-hidden-file-input"
        onChange={handleImportFileChange}
      />
      <div className="deck-sr-only" aria-live="polite" aria-atomic="true">
        {threadLayoutAnnouncement}
      </div>
      <button
        type="button"
        className={`deck-resizer${isResizing ? " deck-resizer--active" : ""}`}
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        disabled={!canResizeRail}
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={Math.min(MIN_RAIL_WIDTH, railWidth)}
        aria-valuemax={Math.max(railWidth, maximumInteractiveRailWidth)}
        aria-valuenow={railWidth}
        aria-label={text.resizeLabel}
        aria-keyshortcuts="ArrowLeft ArrowRight"
        title={text.resizeDrag}
      >
        <span />
      </button>

      <button
        ref={drawerToggleRef}
        type="button"
        className="deck-drawer-toggle"
        onClick={handleDrawerToggle}
        aria-controls={DECK_CONTENT_ID}
        aria-expanded={effectiveDrawerOpen}
        aria-label={effectiveDrawerOpen ? text.hideDeck : text.showDeck}
        title={effectiveDrawerOpen ? text.hideDeck : text.showDeck}
      >
        <DrawerToggleIcon open={effectiveDrawerOpen} />
      </button>

      {!effectiveDrawerOpen && <div className="deck-collapsed-banner">Mattermost Deck</div>}
      {contentMounted && (
        <div
          ref={deckContentRef}
          id={DECK_CONTENT_ID}
          style={{ display: effectiveDrawerOpen ? "contents" : "none" }}
          onFocusCapture={() => {
            deckContentHadFocusRef.current = true;
          }}
          onBlurCapture={() => {
            window.requestAnimationFrame(() => {
              const activeElement = shadowRoot?.activeElement;
              deckContentHadFocusRef.current = Boolean(
                activeElement &&
                deckContentRef.current?.contains(activeElement),
              );
            });
          }}
        >
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
              {effectiveRealtimeEnabled ? (
                <div
                  className={`deck-status-badge deck-status-badge--${apiHealthStatus}${isCompactHeader ? " deck-status-badge--compact" : ""}`}
                  title={syncStatusLabel}
                  aria-label={syncStatusLabel}
                >
                  <span className="deck-status-badge-copy">
                    <HealthStatusIcon status={apiHealthStatus} />
                    {!isCompactHeader ? <span>{healthStatusLabel}</span> : null}
                    <StatusModeIcon realtimeEnabled={effectiveRealtimeEnabled} />
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className={`deck-status-badge deck-status-badge--${apiHealthStatus} deck-status-badge--action${isCompactHeader ? " deck-status-badge--compact" : ""}`}
                  onClick={handleOpenSettings}
                  title={`${text.settingsHint} (${syncStatusLabel})`}
                  aria-label={`${text.settingsHint} (${syncStatusLabel})`}
                >
                  <span className="deck-status-badge-copy">
                    <HealthStatusIcon status={apiHealthStatus} />
                    {!isCompactHeader ? <span>{healthStatusLabel}</span> : null}
                    <StatusModeIcon realtimeEnabled={effectiveRealtimeEnabled} />
                  </span>
                </button>
              )}
              <div className="deck-add-wrap deck-views-wrap" ref={viewsMenuRef}>
                <button
                  type="button"
                  className="deck-button deck-button--secondary deck-topbar-button"
                  onClick={() => {
                    setShowViewsMenu((current) => {
                      const next = !current;
                      if (next) {
                        setShowAddMenu(false);
                        setShowActionsMenu(false);
                        setShowRailAddMenu(false);
                      }
                      return next;
                    });
                  }}
                  disabled={columns === null || state.status === "loading"}
                  aria-expanded={showViewsMenu}
                  aria-controls={VIEWS_MENU_ID}
                >
                  <ViewsIcon />
                  <span className="deck-button-label">{text.viewsLabel}</span>
                </button>
                {showViewsMenu ? (
                  <div id={VIEWS_MENU_ID} className="deck-add-menu deck-add-menu--views">
                    <div className="deck-add-menu-title">{text.viewsLabel}</div>
                    <div className="deck-menu-row deck-menu-row--toolbar">
                      {!viewReorderMode ? (
                        <button type="button" className="deck-add-item" onClick={handleStartViewReorder}>
                          {text.reorderPanes}
                        </button>
                      ) : (
                        <>
                          <button type="button" className="deck-add-item" onClick={handleApplyViewReorder}>
                            {text.applyOrder}
                          </button>
                          <button type="button" className="deck-add-item deck-add-item--secondary" onClick={handleCancelViewReorder}>
                            {text.cancel}
                          </button>
                        </>
                      )}
                    </div>
                    {(viewReorderMode ? viewReorderDraft ?? [] : columns ?? []).map((column, index, source) => {
                      const meta = getColumnViewMeta(column);
                      return (
                        <div key={column.id} className="deck-menu-row deck-menu-row--view">
                          <button type="button" className="deck-add-item" onClick={() => handleFocusColumn(column.id)}>
                            <ColumnViewTarget type={column.type} title={`${index + 1}. ${meta.title}`} subtitle={meta.subtitle} />
                          </button>
                          {viewReorderMode ? (
                            <div className="deck-inline-actions deck-inline-actions--stack">
                              <button
                                type="button"
                                className="deck-icon-button deck-icon-button--ghost"
                                onClick={() => handleMoveViewDraft(column.id, "up")}
                                aria-label={text.moveViewUp(meta.title)}
                                disabled={index === 0}
                              >
                                <ArrowIcon direction="left" />
                              </button>
                              <button
                                type="button"
                                className="deck-icon-button deck-icon-button--ghost"
                                onClick={() => handleMoveViewDraft(column.id, "down")}
                                aria-label={text.moveViewDown(meta.title)}
                                disabled={index === source.length - 1}
                              >
                                <ArrowIcon direction="right" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="deck-icon-button deck-icon-button--ghost"
                              onClick={() => handleCloseColumnFromMenu(column.id)}
                              aria-label={text.closeView(meta.title)}
                            >
                              <CloseIcon />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.savedSetsLabel}</div>
                    <button type="button" className="deck-add-item" onClick={handleSaveCurrentView}>
                      {text.saveCurrentSet}
                    </button>
                    {savedViews.length > 0 ? (
                      <>
                        {savedViews.map((view) => (
                          <div key={view.id} className="deck-menu-row">
                            <button type="button" className="deck-add-item deck-add-item--recent" onClick={() => handleLoadSavedView(view.id)}>
                              <span>{view.name}</span>
                              <small>{text.savedColumns(view.columns.length)}</small>
                            </button>
                            <button type="button" className="deck-icon-button deck-icon-button--ghost" onClick={() => removeView(view.id)} aria-label={text.removeSavedView(view.name)}>
                              <CloseIcon />
                            </button>
                          </div>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="deck-add-wrap" ref={addMenuRef}>
                <button
                  type="button"
                  className="deck-button deck-topbar-button"
                  onClick={() => {
                    setShowAddMenu((current) => {
                      const next = !current;
                      if (next) {
                        setShowViewsMenu(false);
                        setShowActionsMenu(false);
                        setShowRailAddMenu(false);
                      }
                      return next;
                    });
                  }}
                  disabled={columns === null || state.status === "loading"}
                  aria-expanded={showAddMenu}
                  aria-controls={ADD_MENU_ID}
                >
                  <PlusIcon />
                  <span className="deck-button-label">{text.addLabel}</span>
                </button>
                {showAddMenu ? (
                  <div id={ADD_MENU_ID} className="deck-add-menu">
                    <div className="deck-add-menu-title">{text.choosePane}</div>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("mentions")}>
                      <ColumnMenuLabel type="mentions" label={text.addMentions} />
                    </button>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("channelWatch")}>
                      <ColumnMenuLabel type="channelWatch" label={text.addChannelWatch} />
                    </button>
                    {state.currentChannelId ? (
                      <button type="button" className="deck-add-item deck-add-item--secondary" onClick={handleAddCurrentChannelWatch}>
                        <span>{text.watchCurrentChannel}</span>
                      </button>
                    ) : null}
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("dmWatch")}>
                      <ColumnMenuLabel type="dmWatch" label={text.addDmWatch} />
                    </button>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("search")}>
                      <ColumnMenuLabel type="search" label={text.addSearch} />
                    </button>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("saved")}>
                      <ColumnMenuLabel type="saved" label={text.addSaved} />
                    </button>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("diagnostics")}>
                      <ColumnMenuLabel type="diagnostics" label={text.addDiagnostics} />
                    </button>
                    {recentTargets.length > 0 ? (
                      <>
                        <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.recentLabel}</div>
                        {recentTargets.map((target) => (
                          <button
                            key={`${target.type}:${target.teamId}:${target.channelId}`}
                            type="button"
                            className="deck-add-item deck-add-item--recent"
                            onClick={() =>
                              handleAddColumn(target.type, {
                                teamId: target.teamId || undefined,
                                channelId: target.channelId,
                              })
                            }
                            title={`${target.teamLabel} / ${formatRecentTargetLabel(target)}`}
                          >
                            <span>{formatRecentTargetLabel(target)}</span>
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
                  onClick={() => {
                    setShowActionsMenu((current) => {
                      const next = !current;
                      if (next) {
                        setShowAddMenu(false);
                        setShowViewsMenu(false);
                        setShowRailAddMenu(false);
                      }
                      return next;
                    });
                  }}
                  aria-label={text.moreActionsLabel}
                  disabled={columns === null || state.status === "loading"}
                  aria-expanded={showActionsMenu}
                  aria-controls={ACTIONS_MENU_ID}
                >
                  <HamburgerIcon />
                </button>
                {showActionsMenu ? (
                  <div id={ACTIONS_MENU_ID} className="deck-add-menu deck-add-menu--compact">
                    <div className="deck-add-menu-title">{statusText}</div>
                    {isCompactHeader ? (
                      <>
                        <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.choosePane}</div>
                        <button type="button" className="deck-add-item" onClick={() => handleAddColumn("mentions")}>
                          <ColumnMenuLabel type="mentions" label={text.addMentions} />
                        </button>
                        <button type="button" className="deck-add-item" onClick={() => handleAddColumn("channelWatch")}>
                          <ColumnMenuLabel type="channelWatch" label={text.addChannelWatch} />
                        </button>
                        {state.currentChannelId ? (
                          <button type="button" className="deck-add-item deck-add-item--secondary" onClick={handleAddCurrentChannelWatch}>
                            <span>{text.watchCurrentChannel}</span>
                          </button>
                        ) : null}
                        <button type="button" className="deck-add-item" onClick={() => handleAddColumn("dmWatch")}>
                          <ColumnMenuLabel type="dmWatch" label={text.addDmWatch} />
                        </button>
                        <button type="button" className="deck-add-item" onClick={() => handleAddColumn("search")}>
                          <ColumnMenuLabel type="search" label={text.addSearch} />
                        </button>
                        <button type="button" className="deck-add-item" onClick={() => handleAddColumn("saved")}>
                          <ColumnMenuLabel type="saved" label={text.addSaved} />
                        </button>
                        <button type="button" className="deck-add-item" onClick={() => handleAddColumn("diagnostics")}>
                          <ColumnMenuLabel type="diagnostics" label={text.addDiagnostics} />
                        </button>
                        {recentTargets.length > 0 ? (
                          <>
                            <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.recentLabel}</div>
                            {recentTargets.map((target) => (
                              <button
                                key={`${target.type}:${target.teamId}:${target.channelId}`}
                                type="button"
                                className="deck-add-item deck-add-item--recent"
                                onClick={() =>
                                  handleAddColumn(target.type, {
                                    teamId: target.teamId || undefined,
                                    channelId: target.channelId,
                                  })
                                }
                                title={`${target.teamLabel} / ${formatRecentTargetLabel(target)}`}
                              >
                                <span>{formatRecentTargetLabel(target)}</span>
                                <small>{target.teamLabel}</small>
                              </button>
                            ))}
                          </>
                        ) : null}
                        <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.viewsLabel}</div>
                        {(columns ?? []).map((column, index) => {
                          const meta = getColumnViewMeta(column);
                          return (
                            <div key={column.id} className="deck-menu-row deck-menu-row--view">
                              <button type="button" className="deck-add-item" onClick={() => handleFocusColumn(column.id)}>
                                <ColumnViewTarget type={column.type} title={`${index + 1}. ${meta.title}`} subtitle={meta.subtitle} />
                              </button>
                              <button
                                type="button"
                                className="deck-icon-button deck-icon-button--ghost"
                                onClick={() => handleCloseColumnFromMenu(column.id)}
                                aria-label={text.closeView(meta.title)}
                              >
                                <CloseIcon />
                              </button>
                            </div>
                          );
                        })}
                        <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.savedSetsLabel}</div>
                        <button type="button" className="deck-add-item" onClick={handleSaveCurrentView}>
                          {text.saveCurrentSet}
                        </button>
                        {savedViews.length > 0 ? (
                          <>
                            {savedViews.map((view) => (
                              <div key={view.id} className="deck-menu-row">
                                <button type="button" className="deck-add-item deck-add-item--recent" onClick={() => handleLoadSavedView(view.id)}>
                                  <span>{view.name}</span>
                                  <small>{text.savedColumns(view.columns.length)}</small>
                                </button>
                                <button type="button" className="deck-icon-button deck-icon-button--ghost" onClick={() => removeView(view.id)} aria-label={text.removeSavedView(view.name)}>
                                  <CloseIcon />
                                </button>
                              </div>
                            ))}
                          </>
                        ) : null}
                      </>
                    ) : null}
                    <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.menuLabel}</div>
                    <button
                      type="button"
                      className="deck-add-item"
                      onClick={() => {
                        handleOpenSettings();
                        setShowActionsMenu(false);
                      }}
                    >
                      <SettingsMenuLabel label={text.settingsButton} />
                    </button>
                    <div className="deck-add-menu-title deck-add-menu-title--secondary">{text.layoutLabel}</div>
                    <button type="button" className="deck-add-item" onClick={handleExportLayout}>
                      {text.exportLayout}
                    </button>
                    <button type="button" className="deck-add-item" onClick={handleImportLayout}>
                      {text.importLayout}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div
            ref={scrollWrapRef}
            className="deck-scroll-wrap"
            onScroll={(event) => {
              if (effectiveDrawerOpen) {
                lastHorizontalScrollLeftRef.current = event.currentTarget.scrollLeft;
              }
            }}
          >
            <div
              className={`deck-columns${focusedColumnId ? " deck-columns--focus" : ""}`}
              style={{
                minWidth: focusedColumnId
                  ? "100%"
                  : (columns?.length ?? 1) * (normalisePreferredColumnWidth(deckSettings.preferredColumnWidth) + 20) + 32,
              }}
            >
              {isInitialLoading ? (
                <div className="deck-column-motion">
                  <InitialLoadingState message={text.loading} />
                </div>
              ) : shouldSafeStop ? (
                <div className="deck-column-motion">
                  <section className="deck-column">
                    <article
                      className="deck-card"
                      role="alert"
                      aria-live="assertive"
                      aria-atomic="true"
                    >
                      <strong>
                        {state.sessionExpired
                          ? text.sessionExpired
                          : text.failedToLoad}
                      </strong>
                      <p>
                        {state.error ??
                          (state.sessionExpired
                            ? text.sessionExpiredDesc
                            : text.failedToLoad)}
                      </p>
                      <div className="deck-inline-actions">
                        <button
                          type="button"
                          className="deck-add-item deck-add-item--secondary"
                          onClick={() => {
                            if (state.sessionExpired) {
                              window.location.reload();
                            } else {
                              setStateRefreshNonce((current) => current + 1);
                            }
                          }}
                        >
                          {state.sessionExpired
                            ? text.reloadMattermost
                            : i18n.t("deck.retry")}
                        </button>
                        <button type="button" className="deck-add-item deck-add-item--secondary" onClick={handleOpenSettings}>
                          {text.settingsButton}
                        </button>
                      </div>
                    </article>
                  </section>
                </div>
              ) : (columns ?? []).map((column, index, allColumns) => {
                const setColumnRef = (element: HTMLDivElement | null) => {
                  columnRefs.current[column.id] = element;
                };
                const isFocusedPane = focusedColumnId === column.id;
                const isHiddenByFocus = Boolean(focusedColumnId) && !isFocusedPane;
                const motionClassName = `deck-column-motion${isFocusedPane ? " deck-column-motion--focused" : ""}${isHiddenByFocus ? " deck-column-motion--hidden" : ""}`;
                switch (column.type) {
                  case "mentions":
                    return (
                      <div key={column.id} ref={setColumnRef} className={motionClassName}>
        <MentionsColumn
          column={column}
          username={state.username}
          currentUser={state.currentUser}
          currentUserId={state.userId}
          mentionsLastReadAt={mentionsLastReadAt}
                          onSetMentionsLastReadAt={setMentionsLastReadAt}
                          currentTeamId={state.currentTeamId}
                          currentChannelId={state.currentChannelId}
                          realtimeEnabled={effectiveRealtimeEnabled}
                          teams={state.teams}
                          unreads={state.unreads}
                          userDirectory={userDirectory}
                          ensureUsers={ensureUsers}
                          postedEvents={postedEvents}
                          deletedPostIds={deletedPostIds}
                          deletedPostIdsRef={deletedPostIdsRef}
                          reconnectNonce={reconnectNonce}
                          mentionReconcileNonce={mentionReconcileNonce}
                          mentionMetadataNonce={mentionMetadataNonce}
                          readRefreshNonce={mentionReadRefreshNonce}
                          realtimeReadMarkers={realtimeReadMarkers}
                          pollingIntervalSeconds={deckSettings.pollingIntervalSeconds}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onUpdate={updateColumn}
                          onRemove={removeColumn}
                          onOpenPost={handleOpenPost}
                          postClickAction={deckSettings.postClickAction}
                          compactMode={deckSettings.compactMode}
                          columnColors={deckSettings.columnColors}
                          showImagePreviews={deckSettings.showImagePreviews}
                          language={deckSettings.language}
                          reversedPostOrder={deckSettings.reversedPostOrder}
                          highlightKeywords={deckSettings.highlightKeywords}
                          isFocusedPane={isFocusedPane}
                          onToggleFocus={(id) => setFocusedColumnId((current) => (current === id ? null : id))}
                        />
                      </div>
                    );
                  case "channelWatch":
                    return (
                      <div key={column.id} ref={setColumnRef} className={motionClassName}>
                        <ChannelWatchColumn
                          column={column}
                          mode="channel"
                          currentUsername={state.username}
                          currentUserId={state.userId}
                          currentTeamId={state.currentTeamId}
                          currentChannelId={state.currentChannelId}
                          currentTeamLabel={state.currentTeamLabel}
                          currentChannelLabel={state.currentChannelLabel}
                          realtimeEnabled={effectiveRealtimeEnabled}
                          teams={state.teams}
                          userDirectory={userDirectory}
                          ensureUsers={ensureUsers}
                          postedEvents={postedEvents}
                          reconnectNonce={reconnectNonce}
                          pollingIntervalSeconds={deckSettings.pollingIntervalSeconds}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onAddColumn={handleAddColumn}
                          onRememberTarget={rememberRecentTarget}
                          onUpdate={updateColumn}
                          onRemove={removeColumn}
                          onOpenPost={handleOpenPost}
                          postClickAction={deckSettings.postClickAction}
                          compactMode={deckSettings.compactMode}
                          columnColors={deckSettings.columnColors}
                          showImagePreviews={deckSettings.showImagePreviews}
                          language={deckSettings.language}
                          reversedPostOrder={deckSettings.reversedPostOrder}
                          highlightKeywords={deckSettings.highlightKeywords}
                          isFocusedPane={isFocusedPane}
                          onToggleFocus={(id) => setFocusedColumnId((current) => (current === id ? null : id))}
                        />
                      </div>
                    );
                  case "dmWatch":
                    return (
                      <div key={column.id} ref={setColumnRef} className={motionClassName}>
                        <ChannelWatchColumn
                          column={column}
                          mode="dm"
                          currentUsername={state.username}
                          currentUserId={state.userId}
                          currentTeamId={state.currentTeamId}
                          currentChannelId={state.currentChannelId}
                          currentTeamLabel={state.currentTeamLabel}
                          currentChannelLabel={state.currentChannelLabel}
                          realtimeEnabled={effectiveRealtimeEnabled}
                          teams={state.teams}
                          userDirectory={userDirectory}
                          ensureUsers={ensureUsers}
                          postedEvents={postedEvents}
                          reconnectNonce={reconnectNonce}
                          pollingIntervalSeconds={deckSettings.pollingIntervalSeconds}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onAddColumn={handleAddColumn}
                          onRememberTarget={rememberRecentTarget}
                          onUpdate={updateColumn}
                          onRemove={removeColumn}
                          onOpenPost={handleOpenPost}
                          postClickAction={deckSettings.postClickAction}
                          compactMode={deckSettings.compactMode}
                          columnColors={deckSettings.columnColors}
                          showImagePreviews={deckSettings.showImagePreviews}
                          language={deckSettings.language}
                          reversedPostOrder={deckSettings.reversedPostOrder}
                          highlightKeywords={deckSettings.highlightKeywords}
                          isFocusedPane={isFocusedPane}
                          onToggleFocus={(id) => setFocusedColumnId((current) => (current === id ? null : id))}
                        />
                      </div>
                    );
                  case "search":
                  case "keywordWatch":
                    return (
                      <div key={column.id} ref={setColumnRef} className={motionClassName}>
                        <SearchLikeColumn
                          column={column}
                          currentUsername={state.username}
                          currentUserId={state.userId}
                          teams={state.teams}
                          userDirectory={userDirectory}
                          ensureUsers={ensureUsers}
                          pollingIntervalSeconds={deckSettings.pollingIntervalSeconds}
                          reconnectNonce={reconnectNonce}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onUpdate={updateColumn}
                          onRemove={removeColumn}
                          onOpenPost={handleOpenPost}
                          postClickAction={deckSettings.postClickAction}
                          compactMode={deckSettings.compactMode}
                          columnColors={deckSettings.columnColors}
                          showImagePreviews={deckSettings.showImagePreviews}
                          language={deckSettings.language}
                          reversedPostOrder={deckSettings.reversedPostOrder}
                          highlightKeywords={deckSettings.highlightKeywords}
                          isFocusedPane={isFocusedPane}
                          onToggleFocus={(id) => setFocusedColumnId((current) => (current === id ? null : id))}
                        />
                      </div>
                    );
                  case "saved":
                    return (
                      <div key={column.id} ref={setColumnRef} className={motionClassName}>
                        <SavedPostsColumn
                          column={column}
                          currentUsername={state.username}
                          currentUserId={state.userId}
                          userDirectory={userDirectory}
                          ensureUsers={ensureUsers}
                          pollingIntervalSeconds={deckSettings.pollingIntervalSeconds}
                          reconnectNonce={reconnectNonce}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onRemove={removeColumn}
                          onOpenPost={handleOpenPost}
                          postClickAction={deckSettings.postClickAction}
                          compactMode={deckSettings.compactMode}
                          columnColors={deckSettings.columnColors}
                          showImagePreviews={deckSettings.showImagePreviews}
                          language={deckSettings.language}
                          reversedPostOrder={deckSettings.reversedPostOrder}
                          highlightKeywords={deckSettings.highlightKeywords}
                          isFocusedPane={isFocusedPane}
                          onToggleFocus={(id) => setFocusedColumnId((current) => (current === id ? null : id))}
                        />
                      </div>
                    );
                  case "diagnostics":
                    return (
                      <div key={column.id} ref={setColumnRef} className={motionClassName}>
                        <DiagnosticsColumn
                          column={column}
                          wsStatus={wsStatus}
                          syncLogs={syncLogs}
                          apiHealthStatus={apiHealthStatus}
                          realtimeEnabled={effectiveRealtimeEnabled}
                          runtimeMetrics={runtimeMetrics}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onRemove={removeColumn}
                          onOpenSettings={handleOpenSettings}
                          columnColors={deckSettings.columnColors}
                          language={deckSettings.language}
                          isFocusedPane={isFocusedPane}
                          onToggleFocus={(id) => setFocusedColumnId((current) => (current === id ? null : id))}
                        />
                      </div>
                  );
                }
              })}
              <div className="deck-column-tail" ref={railAddMenuRef}>
                <button
                  ref={railAddButtonRef}
                  type="button"
                  className="deck-column-add-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowRailAddMenu((current) => {
                      const next = !current;
                      if (next) {
                        setShowAddMenu(false);
                        setShowViewsMenu(false);
                        setShowActionsMenu(false);
                      }
                      return next;
                    });
                  }}
                  aria-label={text.addLabel}
                  title={text.addLabel}
                  aria-expanded={showRailAddMenu}
                  aria-controls={RAIL_ADD_MENU_ID}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>
          </div>
          {showRailAddMenu && railAddMenuPosition ? (
            <div
              ref={railAddOverlayMenuRef}
              id={RAIL_ADD_MENU_ID}
              className="deck-add-menu deck-add-menu--tail"
              style={{ top: `${railAddMenuPosition.top}px`, right: `${railAddMenuPosition.right}px` }}
            >
              <div className="deck-add-menu-title">{text.choosePane}</div>
              <button type="button" className="deck-add-item" onClick={() => handleAddColumn("mentions")}>
                <ColumnMenuLabel type="mentions" label={text.addMentions} />
              </button>
              <button type="button" className="deck-add-item" onClick={() => handleAddColumn("channelWatch")}>
                <ColumnMenuLabel type="channelWatch" label={text.addChannelWatch} />
              </button>
              {state.currentChannelId ? (
                <button type="button" className="deck-add-item deck-add-item--secondary" onClick={handleAddCurrentChannelWatch}>
                  <span>{text.watchCurrentChannel}</span>
                </button>
              ) : null}
              <button type="button" className="deck-add-item" onClick={() => handleAddColumn("dmWatch")}>
                <ColumnMenuLabel type="dmWatch" label={text.addDmWatch} />
              </button>
              <button type="button" className="deck-add-item" onClick={() => handleAddColumn("search")}>
                <ColumnMenuLabel type="search" label={text.addSearch} />
              </button>
              <button type="button" className="deck-add-item" onClick={() => handleAddColumn("saved")}>
                <ColumnMenuLabel type="saved" label={text.addSaved} />
              </button>
              <button type="button" className="deck-add-item" onClick={() => handleAddColumn("diagnostics")}>
                <ColumnMenuLabel type="diagnostics" label={text.addDiagnostics} />
              </button>
            </div>
          ) : null}
        </div>
      )}
    </aside>
    </ShadowRootContext.Provider>
  );
}
