import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
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
  getRecentPosts,
  getTeamByName,
  getTeamUnread,
  getTeamsForCurrentUser,
  getUsersByIds,
  getMyChannelMember,
  viewChannel,
  readCurrentRoute,
  searchPostsInTeam,
  type MattermostChannel,
  type MattermostChannelMember,
  type MattermostFileInfo,
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
import { getDeckDiagnosticsSnapshot, recordRenderCommit, recordSpecialMentionScan } from "../diagnostics";
import { addTraceEntry } from "../traceLog";
import { CustomSelect, type CustomSelectOption } from "./CustomSelect";
import {
  DEFAULT_COLUMN_COLORS,
  DEFAULT_SETTINGS,
  loadDeckSettings,
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
import { extractHighlightKeywords, tokenizePostText } from "./postText";
import { focusMattermostPost } from "./mattermostNavigation";
import { dedupeRecentTargets, type RecentChannelTarget } from "./recentTargets";
import { mapInBatches } from "./asyncBatch";


interface AppProps {
  routeKey: string;
  shadowRoot: ShadowRoot | null;
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

type SyncLogEntry = WsLogEntry;

interface RuntimePerformanceSnapshot {
  domNodeCount: number;
  memoryUsedMb: number | null;
  memoryLimitMb: number | null;
  memoryUsageRatio: number | null;
  api: ReturnType<typeof getApiPerformanceSnapshot>;
  diagnostics: ReturnType<typeof getDeckDiagnosticsSnapshot>;
}

type ApiHealthStatus = "healthy" | "degraded" | "error";

const FALLBACK_SYNC_INTERVAL_WS_MS = 300_000;
const FALLBACK_SYNC_INTERVAL_HIDDEN_MS = 180_000;
const DRAWER_UNMOUNT_DELAY_MS = 5 * 60 * 1_000;
const DECK_ROOT_ID = "mattermost-deck-root";
const AVAILABLE_COLUMN_TYPES: DeckColumnType[] = ["mentions", "channelWatch", "dmWatch"];
const RAIL_WIDTH_STORAGE_KEY = "mattermostDeck.railWidth.v1";
const DRAWER_OPEN_STORAGE_KEY = "mattermostDeck.drawerOpen.v1";
const RECENT_TARGETS_STORAGE_KEY = "mattermostDeck.recentTargets.v1";
const SAVED_VIEWS_STORAGE_KEY = "mattermostDeck.savedViews.v1";
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
const SEARCH_SYNC_INTERVAL_FLOOR_MS = 120_000;
const MAX_SAVED_VIEWS = 8;
const DEBUG_FLAG_KEY = "mattermostDeck.debugLogs";
const COMPACT_HEADER_BREAKPOINT_PX = 620;
const SPECIAL_MENTION_MEMBER_TTL_MS = 45_000;
const SPECIAL_MENTION_MEMBER_TTL_WS_MS = 180_000;
const SPECIAL_MENTION_POST_TTL_MS = 30_000;
const SPECIAL_MENTION_POST_TTL_WS_MS = 120_000;
const TEAM_FANOUT_BATCH_SIZE = 2;
const TEAM_FANOUT_GAP_MS = 250;
const CHANNEL_FANOUT_BATCH_SIZE = 3;
const CHANNEL_FANOUT_GAP_MS = 150;

declare global {
  interface Window {
    __mattermostDeckDebug?: {
      getState: () => {
        contentMounted: boolean;
        stateStatus: string;
        username: string | null;
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

interface OpenPostTarget {
  teamName?: string;
  channelName?: string;
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

function buildMentionSearchTerms(username: string): string {
  return [`@${username}`, "@all", "@here", "@channel"].join(" ");
}

function hasSpecialMention(message: string): boolean {
  return /(^|[^a-z0-9_])@(all|here|channel)\b/i.test(message);
}

function hasMentionForMentionsColumn(message: string, username: string): boolean {
  const escapedUsername = escapeRegExp(username);
  const userMentionPattern = new RegExp(`(^|[^a-z0-9_])@${escapedUsername}\\b`, "i");
  return userMentionPattern.test(message) || hasSpecialMention(message);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSearchTerms(query: string): string[] {
  return query
    .match(/"([^"]+)"|(\S+)/g)?.map((part) => part.replace(/^"|"$/g, "").trim()).filter((part) => part.length > 0) ?? [];
}

function expandSearchQueryForApi(query: string): string {
  return query.replace(/"[^"]+"|\S+/g, (token) => {
    if (token.startsWith("\"") && token.endsWith("\"")) {
      return token;
    }
    if (token.includes(":") || token.includes("*")) {
      return token;
    }
    return /^[\p{L}\p{N}_-]+$/u.test(token) ? `*${token}*` : token;
  });
}

function buildSearchSnippet(message: string, query: string, limit = 160): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty message)";
  }

  const terms = extractSearchTerms(query);
  const lower = normalized.toLowerCase();
  const matchPositions = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);

  if (matchPositions.length === 0 || normalized.length <= limit) {
    return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
  }

  const pivot = matchPositions[0];
  const start = Math.max(0, pivot - Math.floor(limit * 0.35));
  const end = Math.min(normalized.length, start + limit);
  const adjustedStart = Math.max(0, end - limit);
  const snippet = normalized.slice(adjustedStart, end).trim();
  const prefix = adjustedStart > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${snippet}${suffix}`;
}

function renderHighlightedText(text: string, query: string): React.ReactNode {
  const terms = extractSearchTerms(query);
  return renderHighlightedTextFromTerms(text, terms);
}

function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(term);
  }
  return result;
}

function renderTextHighlights(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) {
    return text;
  }

  const pattern = new RegExp(`(${terms.map((term) => escapeRegExp(term)).join('|')})`, 'gi');
  const segments = text.split(pattern);
  return segments.map((segment, index) =>
    terms.some((term) => segment.toLowerCase() === term.toLowerCase()) ? (
      <mark key={`${segment}-${index}`} className="search-highlight">
        {segment}
      </mark>
    ) : (
      <React.Fragment key={`${segment}-${index}`}>{segment}</React.Fragment>
    ),
  );
}

function renderHighlightedTextFromTerms(text: string, terms: string[]): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let index = 0;

  for (const token of tokenizePostText(text)) {
    if (token.type === 'url' && token.href) {
      nodes.push(
        <a
          key={`token-${index}`}
          className="deck-inline-link"
          href={token.href}
          target="_blank"
          rel="noreferrer"
          title={token.raw}
          onClick={(event) => event.stopPropagation()}
        >
          {token.display}
        </a>,
      );
    } else if (token.raw.trim().length === 0) {
      nodes.push(<React.Fragment key={`token-${index}`}>{token.raw}</React.Fragment>);
    } else if (token.display !== token.raw) {
      nodes.push(
        <span key={`token-${index}`} className="deck-inline-ellipsis" title={token.raw}>
          {token.display}
        </span>,
      );
    } else {
      nodes.push(<React.Fragment key={`token-${index}`}>{renderTextHighlights(token.raw, terms)}</React.Fragment>);
    }
    index += 1;
  }

  return nodes.length > 0 ? nodes : renderTextHighlights(text, terms);
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

function getUserAvatarUrl(userId: string): string {
  return `/api/v4/users/${encodeURIComponent(userId)}/image`;
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
      return source.length === 1 && userId === currentUserId ? `${resolved} (me)` : resolved;
    })
    .join(", ");
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
      return "Healthy";
    case "degraded":
      return "Degraded";
    default:
      return "Error";
  }
}

function openMattermostThread(teamName: string, postId: string, channelName?: string | null): void {
  const nextPath = channelName
    ? `/${teamName}/channels/${channelName}/${postId}`
    : `/${teamName}/pl/${postId}`;
  debugLog("app.open-thread", {
    currentPath: window.location.pathname,
    nextPath,
    postId,
  });
  if (window.location.pathname === nextPath) {
    window.dispatchEvent(new PopStateEvent("popstate"));
    void focusMattermostPost(postId);
    return;
  }

  debugLog("app.open-thread.push-state", { nextPath });
  window.history.pushState({}, "", nextPath);
  window.dispatchEvent(new PopStateEvent("popstate"));
  void focusMattermostPost(postId);
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

function useAppText() {
  const { t } = useTranslation();
  return useMemo(() => ({
    title: t("deck.title"),
    signedInAs: t("deck.signedInAs"),
    usingSession: t("deck.usingSession"),
    realtimeOff: t("deck.realtimeOff"),
    settingsHint: t("deck.settingsHint"),
    settingsButton: t("deck.settingsButton"),
    connectionLog: t("deck.connectionLog"),
    recentLabel: t("deck.recentLabel"),
    addLabel: t("deck.addLabel"),
    addMentions: t("deck.addMentions"),
    addChannelWatch: t("deck.addChannelWatch"),
    addDmWatch: t("deck.addDmWatch"),
    addSearch: t("deck.addSearch"),
    addSaved: t("deck.addSaved"),
    addDiagnostics: t("deck.addDiagnostics"),
    choosePane: t("deck.choosePane"),
    loading: t("deck.loading"),
    sessionExpired: t("deck.sessionExpired"),
    failedToLoad: t("deck.failedToLoad"),
    column: t("deck.column"),
    columns: t("deck.columns"),
    teamLabel: t("deck.teamLabel"),
    selectTeam: t("deck.selectTeam"),
    allTeams: t("deck.allTeams"),
    unreadOnly: t("deck.unreadOnly"),
    scope: t("deck.scope"),
    mentionBadge: (count: number, perTeam: boolean) =>
      t(perTeam ? "deck.mentionBadgePerTeam" : "deck.mentionBadgeAllTeams", { count }),
    unreadOnlyNote: t("deck.unreadOnlyNote"),
    unreadSeparatorLabel: t("deck.unreadSeparatorLabel"),
    markRead: t("deck.markRead"),
    jumpToLatest: t("deck.jumpToLatest"),
    newPosts: (count: number) => t("deck.newPosts", { count }),
    allTeamsNote: t("deck.allTeamsNote"),
    channelLabel: t("deck.channelLabel"),
    selectChannel: t("deck.selectChannel"),
    selectDm: t("deck.selectDm"),
    directMessage: t("deck.directMessage"),
    pinnedTarget: t("deck.pinnedTarget"),
    unknownTeam: t("deck.unknownTeam"),
    pickDmOrGroup: t("deck.pickDmOrGroup"),
    pickTeamAndChannel: t("deck.pickTeamAndChannel"),
    selectATeam: t("deck.selectATeam"),
    selectATeamDesc: t("deck.selectATeamDesc"),
    selectAChannel: t("deck.selectAChannel"),
    selectADm: t("deck.selectADm"),
    selectChannelDesc: t("deck.selectChannelDesc"),
    selectDmDesc: t("deck.selectDmDesc"),
    queryLabel: t("deck.queryLabel"),
    searchTerms: t("deck.searchTerms"),
    applySearch: t("deck.applySearch"),
    noRecentEvents: t("deck.noRecentEvents"),
    resizeLabel: t("deck.resizeLabel"),
    resizeDrag: t("deck.resizeDrag"),
    moreActionsLabel: t("deck.moreActionsLabel"),
    collapseControls: (name: string) => t("deck.collapseControls", { name }),
    expandControls: (name: string) => t("deck.expandControls", { name }),
  }), [t]);
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
  const highlightBg = readMattermostThemeValue(
    rootStyle,
    ["--mention-highlight-bg"],
    colorMixFallback(accent, "#ffe082"),
  );
  const highlightText = pickReadableForeground(
    highlightBg,
    [
      readMattermostThemeValue(rootStyle, ["--mention-highlight-link"]),
      centerText,
      "rgb(27, 29, 34)",
      "rgb(255, 255, 255)",
    ],
    "rgb(27, 29, 34)",
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

function useMattermostThemeStyle(
  theme: DeckTheme,
  routeKey: string,
): {
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
    const observer = new MutationObserver(() => scheduleApply());
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
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [routeKey, theme]);

  return {
    initialSource: initialSourceRef.current,
    style,
  };
}

function getSyncInterval(realtimeEnabled: boolean, pollingIntervalSeconds: number): number {
  if (document.hidden) {
    return Math.max(FALLBACK_SYNC_INTERVAL_HIDDEN_MS, pollingIntervalSeconds * 4_000);
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

async function loadAppState(): Promise<Omit<AppState, "status" | "error">> {
  const route = readCurrentRoute();
  const user = await getCurrentUser();

  const [teams, unreads, routeTeam] = await Promise.all([
    getTeamsForCurrentUser(),
    getTeamUnread(user.id),
    route.teamName ? getTeamByName(route.teamName).catch(() => null) : Promise.resolve(null),
  ]);

  const routeChannel =
    routeTeam && route.channelName && !isLikelyDirectChannelRouteName(route.channelName)
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
          status: "loading",
          error: null,
        }));
      }

      try {
        const data = await loadAppState();
        if (!cancelled) {
          debugLog("app.deck-state.ready", {
            currentTeamId: data.currentTeamId ?? null,
            currentChannelId: data.currentChannelId ?? null,
            path: window.location.pathname,
          });
          setState({
            status: "ready",
            error: null,
            ...data,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Failed to load Mattermost data.";
          debugLog("app.deck-state.error", {
            message,
            path: window.location.pathname,
          });
          setState((current) => ({
            ...current,
            status: "error",
            error: message,
            sessionExpired: /401/.test(message),
          }));
        }
      }
    };

    void run(true);
    const startTimer = () =>
      window.setInterval(() => {
        void run(false);
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
  }, [pollingIntervalSeconds, realtimeEnabled, refreshNonce]);

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
  const [scale, setScale] = useState<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const fitScaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const hasDragged = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => { posRef.current = pos; }, [pos]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const shadowRoot = useContext(ShadowRootContext);
  if (!shadowRoot) return null;

  const currentScale = scale ?? 0.001;
  const scaleLabel = `${Math.round(currentScale * 100)}%`;

  return createPortal(
    <div className="deck-lightbox-backdrop" role="dialog" aria-modal="true" aria-label={name}>
      {/* Toolbar */}
      <div className="deck-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="deck-lightbox-btn"
          title="Open in new tab"
          onClick={(e) => {
            e.stopPropagation();
            void chrome.runtime.sendMessage({ type: "mattermost-deck:open-tab", url: src });
          }}
        >
          <IconExternalLink />
        </button>
        <button type="button" className="deck-lightbox-btn" title="Download image" onClick={handleDownload}>
          <IconDownload />
        </button>
        <button type="button" className="deck-lightbox-btn deck-lightbox-btn--close" title="Close" onClick={onClose}>
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
          <button type="button" className="deck-lightbox-ctrl" title="Zoom out" onClick={zoomOut}><IconZoomOut /></button>
          <button type="button" className="deck-lightbox-ctrl deck-lightbox-ctrl--scale" title="Fit to screen" onClick={fitScreen}>
            {scaleLabel}
          </button>
          <button type="button" className="deck-lightbox-ctrl" title="Zoom in" onClick={zoomIn}><IconZoomIn /></button>
          <button type="button" className="deck-lightbox-ctrl" title="Fill screen" onClick={fillScreen}><IconMaximize /></button>
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
}: {
  info: MattermostFileInfo;
  placeholder: string | null;
  previewSrc: string;
  fullSrc: string;
  onOpen: () => void;
}): React.JSX.Element {
  const [src, setSrc] = useState<string>(placeholder ?? previewSrc);

  useEffect(() => {
    if (!placeholder) return;
    const img = new Image();
    img.onload = () => setSrc(previewSrc);
    img.onerror = () => setSrc(fullSrc);
    img.src = previewSrc;
  }, [placeholder, previewSrc, fullSrc]);

  return (
    <button
      type="button"
      className="deck-file-thumb-wrap"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      aria-label={`画像を開く: ${info.name}`}
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

function PostFileAttachments({ fileIds, postId, showImagePreviews = true }: { fileIds: string[]; postId: string; showImagePreviews?: boolean }): React.JSX.Element | null {
  const [fileInfos, setFileInfos] = useState<MattermostFileInfo[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; name: string } | null>(null);

  useEffect(() => {
    void fetchPostFileInfos(postId).then(setFileInfos).catch(() => undefined);
  }, [postId]);

  if (fileInfos.length === 0) return null;

  const baseUrl = window.location.origin;

  const getPlaceholderSrc = (info: MattermostFileInfo): string | null => {
    if (info.mini_preview) {
      return `data:${info.mime_type};base64,${info.mini_preview}`;
    }
    return null;
  };

  const getPreviewSrc = (info: MattermostFileInfo): string => {
    if (info.has_preview_image) {
      return `${baseUrl}/api/v4/files/${info.id}/preview`;
    }
    return `${baseUrl}/api/v4/files/${info.id}`;
  };

  const getFullSrc = (info: MattermostFileInfo): string => {
    return `${baseUrl}/api/v4/files/${info.id}`;
  };

  return (
    <>
      <div className="deck-post-files">
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
            />
          ) : (
            <button
              key={info.id}
              type="button"
              className="deck-file-card"
              onClick={(e) => {
                e.stopPropagation();
                void chrome.runtime.sendMessage({ type: "mattermost-deck:open-tab", url: `${baseUrl}/api/v4/files/${info.id}` });
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
  lastViewedAt,
  onMarkRead,
  unreadSeparatorLabel = "Unread",
  markReadLabel = "Mark as read",
  jumpToLatestLabel = "Latest",
  newPostsLabel = (count: number) => `${count} new`,
}: {
  posts: MattermostPost[];
  userDirectory: Record<string, MattermostUser>;
  compactMode?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  renderMeta?: (post: MattermostPost) => React.ReactNode;
  renderBody?: (post: MattermostPost) => React.ReactNode;
  onOpenPost?: (post: MattermostPost) => void;
  postClickAction: PostClickAction;
  showImagePreviews?: boolean;
  language?: DeckLanguage;
  reversedPostOrder?: boolean;
  highlightTerms?: string[];
  lastViewedAt?: number | null;
  onMarkRead?: () => void;
  unreadSeparatorLabel?: string;
  markReadLabel?: string;
  jumpToLatestLabel?: string;
  newPostsLabel?: (count: number) => string;
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragDetectedRef = useRef(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
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
  const shouldVirtualize = posts.length > POST_VIRTUALIZE_THRESHOLD;

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
      viewport.scrollTo({ top: target, behavior: "smooth" });
      setScrollTop(target);
    } else {
      viewport.scrollTo({ top: 0, behavior: "smooth" });
      setScrollTop(0);
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
  }, [posts, shouldVirtualize]);

  useEffect(() => {
    if (!reversedPostOrder || hasInitialScrolledRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport || viewportHeight === 0) return;
    const target = viewport.scrollHeight - viewport.clientHeight;
    if (target <= 0) return;
    viewport.scrollTop = target;
    setScrollTop(target);
    hasInitialScrolledRef.current = true;
  }, [reversedPostOrder, viewportHeight]);

  useEffect(() => {
    const nextTopPostId = posts[0]?.id ?? null;
    const previousTopPostId = previousTopPostIdRef.current;
    const previousCount = previousPostCountRef.current;
    previousTopPostIdRef.current = nextTopPostId;
    previousPostCountRef.current = posts.length;

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
      viewport.scrollTo({ top: target, behavior: "smooth" });
      setScrollTop(target);
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
      viewport.scrollTo({ top: 0, behavior: "smooth" });
      setScrollTop(0);
      setNewPostCount(0);
      setShowJumpToLatest(false);
    }
  }, [posts]);

  const rowHeights = useMemo(
    () => displayEntries.map((entry) => (entry.type === "separator" || entry.type === "unread-separator" ? POST_SEPARATOR_ESTIMATE : POST_ROW_ESTIMATE)),
    [displayEntries],
  );
  const offsets = useMemo(() => {
    const values: number[] = new Array(displayEntries.length);
    let total = 0;
    for (let index = 0; index < displayEntries.length; index += 1) {
      values[index] = total;
      total += rowHeights[index] ?? 0;
    }
    return values;
  }, [displayEntries, rowHeights]);
  const totalHeight = useMemo(() => rowHeights.reduce((sum, height) => sum + height, 0), [rowHeights]);
  const startIndex = shouldVirtualize ? Math.max(0, binarySearchOffsets(offsets, scrollTop) - POST_OVERSCAN) : 0;
  const endBoundary = scrollTop + viewportHeight;
  const endIndex = shouldVirtualize
    ? Math.min(displayEntries.length, binarySearchOffsets(offsets, endBoundary) + POST_OVERSCAN + 2)
    : displayEntries.length;
  const visibleEntries = displayEntries.slice(startIndex, endIndex);
  const offsetY = offsets[startIndex] ?? 0;
  const spacerHeight = totalHeight;

  const markReadFiredRef = useRef(false);

  useEffect(() => {
    if (!markReadFiredRef.current) {
      markReadFiredRef.current = false;
    }
  }, [lastViewedAt]);

  const renderEntry = (entry: PostListEntry): React.ReactNode => {
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
                markReadFiredRef.current = true;
                onMarkRead();
              }}
              aria-label={markReadLabel}
              title={markReadLabel}
            >
              <span className="deck-unread-mark-read-toggle-label deck-unread-mark-read-toggle-label--idle">
                {unreadSeparatorLabel}
              </span>
              <span className="deck-unread-mark-read-toggle-label deck-unread-mark-read-toggle-label--action">
                {markReadLabel}
              </span>
            </button>
          ) : (
            <span>{unreadSeparatorLabel}</span>
          )}
        </li>
      );
    }

    const { post } = entry;
    return (
      <li
        key={entry.key}
        className={`deck-card deck-card--post${compactMode ? " deck-card--post-compact" : ""}${onOpenPost && postClickAction !== "none" ? " deck-card--clickable" : ""}`}
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
                if (postClickAction === "ask" && !window.confirm("Open this post in the main Mattermost thread view?")) {
                  return;
                }
                onOpenPost(post);
              }
            : undefined
        }
      >
        <div className="deck-card-header">
          <strong>{formatPostTime(post.create_at)}</strong>
          <span className="deck-card-author">
            {!compactMode ? (
              <img
                className="deck-card-avatar"
                src={getUserAvatarUrl(post.user_id)}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <span className="deck-card-author-label">{getUserLabel(userDirectory[post.user_id], post.user_id)}</span>
          </span>
        </div>
        {renderMeta ? <div className="deck-card-meta">{renderMeta(post)}</div> : null}
        {(() => {
          const hasFiles = (post.file_ids?.length ?? 0) > 0;
          const body = renderBody ? renderBody(post) : renderHighlightedTextFromTerms(summarisePost(post.message), highlightTerms);
          const isEmpty = !renderBody && !post.message.trim();
          return (!isEmpty || !hasFiles) ? <p>{body}</p> : null;
        })()}
        {post.file_ids && post.file_ids.length > 0 && (
          <PostFileAttachments fileIds={post.file_ids} postId={post.id} showImagePreviews={showImagePreviews} />
        )}
      </li>
    );
  };

  const footerNode = hasMore || loadingMore ? (
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
  ) : posts.length > 0 ? (
    <div className="deck-list-end">
      {language === "ja" ? "すべての投稿を読み込みました" : "All posts loaded"}
    </div>
  ) : null;

  return (
    <div className="deck-post-list">
      {newPostCount > 0 || showJumpToLatest ? (
        <div className="deck-list-floating-action">
          <button
            type="button"
            className="deck-new-posts-button"
            onClick={scrollToLatest}
            title={newPostCount > 0 ? newPostsLabel(newPostCount) : jumpToLatestLabel}
            aria-label={newPostCount > 0 ? newPostsLabel(newPostCount) : jumpToLatestLabel}
          >
            <JumpToLatestIcon reversed={reversedPostOrder} />
          </button>
        </div>
      ) : null}
      {shouldVirtualize ? (
        <div
          ref={viewportRef}
          className="deck-list-viewport"
          onScroll={(event) => {
            const el = event.currentTarget;
            setScrollTop(el.scrollTop);
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
          <div className="deck-list-spacer" style={{ height: `${Math.max(spacerHeight, viewportHeight)}px` }}>
            <ul className="deck-list deck-list--virtual" style={{ transform: `translateY(${offsetY}px)` }}>
              {visibleEntries.map((entry) => renderEntry(entry))}
            </ul>
          </div>
          {!reversedPostOrder && footerNode}
        </div>
      ) : (
        <div
          ref={viewportRef}
          className="deck-list-viewport"
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
          <ul className="deck-list">{displayEntries.map((entry) => renderEntry(entry))}</ul>
          {!reversedPostOrder && footerNode}
        </div>
      )}
    </div>
  );
}

function MentionsColumn({
  column,
  username,
  currentTeamId,
  currentChannelId,
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
  postClickAction,
  compactMode,
  columnColors,
  showImagePreviews,
  language,
  reversedPostOrder,
  highlightKeywords,
}: {
  column: DeckColumn;
  username: string | null;
  currentTeamId?: string;
  currentChannelId?: string;
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
}): React.JSX.Element {
  const teamIds = useMemo(() => (column.teamId ? [column.teamId] : teams.map((team) => team.id)), [column.teamId, teams]);
  const text = useAppText();
  const highlightTerms = useMemo(() => extractHighlightKeywords(highlightKeywords), [highlightKeywords]);
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
  const [showControls, setShowControls] = useState(false);
  const [paused, setPaused] = useState(false);
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshStopTimerRef = useRef<number | null>(null);
  const specialMentionMembersCacheRef = useRef<Record<string, { expiresAt: number; members: MattermostChannelMember[] }>>({});
  const specialMentionPostsCacheRef = useRef<Record<string, { expiresAt: number; posts: MattermostPost[] }>>({});
  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const mentionCount = useMemo(
    () =>
      column.teamId
        ? (unreads.find((entry) => entry.team_id === column.teamId)?.mention_count ?? 0)
        : unreads.reduce((total, entry) => total + entry.mention_count, 0),
    [column.teamId, unreads],
  );
  const visiblePosts = useMemo(
    () => (column.unreadOnly ? postState.posts.slice(0, Math.max(0, mentionCount)) : postState.posts),
    [column.unreadOnly, mentionCount, postState.posts],
  );
  const teamOptions = useMemo<CustomSelectOption[]>(
    () => [{ value: "", label: text.allTeams }, ...teams.map((team) => ({ value: team.id, label: team.display_name || team.name }))],
    [teams, text.allTeams],
  );
  const mentionSearchTerms = useMemo(
    () => (username ? buildMentionSearchTerms(username) : ""),
    [username],
  );
  const shouldShowLoadingState =
    postState.posts.length === 0 &&
    (postState.status === "idle" || postState.status === "loading") &&
    teamIds.length > 0 &&
    Boolean(username);
  const specialMentionMemberTtlMs = realtimeEnabled ? SPECIAL_MENTION_MEMBER_TTL_WS_MS : SPECIAL_MENTION_MEMBER_TTL_MS;
  const specialMentionPostTtlMs = realtimeEnabled ? SPECIAL_MENTION_POST_TTL_WS_MS : SPECIAL_MENTION_POST_TTL_MS;

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

  const loadSpecialMentionPosts = useCallback(
    async (teamId: string) => {
      if (!username) {
        return [];
      }

      const teamMentionCount = unreads.find((entry) => entry.team_id === teamId)?.mention_count ?? 0;
      const includeCurrentChannel = currentTeamId === teamId && Boolean(currentChannelId);
      if (teamMentionCount <= 0 && !includeCurrentChannel) {
        recordSpecialMentionScan({ hits: 0, channelsScanned: 0 });
        return [];
      }

      const now = Date.now();
      const cachedMembers = specialMentionMembersCacheRef.current[teamId];
      let members: MattermostChannelMember[];
      if (cachedMembers && cachedMembers.expiresAt > now) {
        members = cachedMembers.members;
      } else {
        members = await getChannelMembersForCurrentUser(teamId);
        specialMentionMembersCacheRef.current[teamId] = {
          expiresAt: now + specialMentionMemberTtlMs,
          members,
        };
      }

      const candidateChannelIds = new Set(
        members
          .filter((member) => (member.mention_count ?? 0) > 0)
          .map((member) => member.channel_id),
      );
      if (includeCurrentChannel && currentChannelId) {
        candidateChannelIds.add(currentChannelId);
      }

      if (candidateChannelIds.size === 0) {
        recordSpecialMentionScan({ hits: 0, channelsScanned: 0 });
        return [];
      }

      let cacheHits = 0;
      let cacheMisses = 0;
      const channelPosts = await mapInBatches(
        Array.from(candidateChannelIds),
        CHANNEL_FANOUT_BATCH_SIZE,
        async (channelId) => {
          const cachedPosts = specialMentionPostsCacheRef.current[channelId];
          if (cachedPosts && cachedPosts.expiresAt > now) {
            cacheHits += 1;
            return cachedPosts.posts;
          }

          cacheMisses += 1;
          const posts = await getRecentPosts(channelId, 0, POSTS_PAGE_SIZE);
          specialMentionPostsCacheRef.current[channelId] = {
            expiresAt: Date.now() + specialMentionPostTtlMs,
            posts,
          };
          return posts;
        },
        candidateChannelIds.size > CHANNEL_FANOUT_BATCH_SIZE ? CHANNEL_FANOUT_GAP_MS : 0,
      );

      const posts = channelPosts
        .flat()
        .filter((post) => hasSpecialMention(post.message))
        .filter((post) => hasMentionForMentionsColumn(post.message, username));
      recordSpecialMentionScan({
        hits: posts.length,
        channelsScanned: candidateChannelIds.size,
        cacheHits,
        cacheMisses,
      });
      return posts;
    },
    [
      currentChannelId,
      currentTeamId,
      specialMentionMemberTtlMs,
      specialMentionPostTtlMs,
      unreads,
      username,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    if (paused) {
      return () => { cancelled = true; };
    }

    if (teamIds.length === 0 || !username) {
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
      setPostState((current) => ({
        ...current,
        status: current.posts.length > 0 ? current.status : "loading",
        error: null,
      }));

      try {
        const [results, specialMentionResults] = await Promise.all([
          mapInBatches(
            teamIds,
            TEAM_FANOUT_BATCH_SIZE,
            async (teamId) => ({
              teamId,
              posts: await searchPostsInTeam(teamId, mentionSearchTerms, 0, POSTS_PAGE_SIZE, { isOrSearch: true }),
            }),
            teamIds.length > TEAM_FANOUT_BATCH_SIZE ? TEAM_FANOUT_GAP_MS : 0,
          ),
          mapInBatches(
            teamIds,
            TEAM_FANOUT_BATCH_SIZE,
            async (teamId) => await loadSpecialMentionPosts(teamId),
            teamIds.length > TEAM_FANOUT_BATCH_SIZE ? TEAM_FANOUT_GAP_MS : 0,
          ),
        ]);
        if (cancelled) {
          return;
        }
        const posts = mergePosts(results.flatMap((entry) => entry.posts), specialMentionResults.flat());
        void ensureUsers(posts.map((post) => post.user_id));
        setPostState({
          status: "ready",
          posts,
          error: null,
          nextPage: 1,
          hasMore: results.some((entry) => entry.posts.length === POSTS_PAGE_SIZE),
          loadingMore: false,
        });
        finishRefresh();
      } catch (error) {
        if (cancelled) {
          return;
        }
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
    };

    void run();
    const intervalMs = column.teamId
      ? getSyncInterval(realtimeEnabled, pollingIntervalSeconds)
      : Math.max(getSyncInterval(realtimeEnabled, pollingIntervalSeconds), 120_000);
    let timer = window.setInterval(() => {
      void run();
    }, intervalMs);
    const handleVisibility = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        void run();
      }, intervalMs);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [column.teamId, ensureUsers, finishRefresh, loadSpecialMentionPosts, mentionSearchTerms, paused, pollingIntervalSeconds, realtimeEnabled, reconnectNonce, refreshNonce, teamIds, username]);

  useEffect(() => {
    if (!postedEvent || !postedEvent.mentionsUser) {
      return;
    }
    if (column.teamId && postedEvent.teamId !== column.teamId) {
      return;
    }

    void ensureUsers([postedEvent.post.user_id]);
    setPostState((current) => ({
      ...current,
      status: "ready",
      error: null,
      posts: mergePosts([postedEvent.post], current.posts),
    }));
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
        const channels = await getChannelsByIds(missingChannelIds);
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

        setMemberDirectory((current) => ({ ...current, ...nextMemberDirectory }));
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
        return null;
      }

      const channelLabel = getChannelLabel(channel, userDirectory, memberDirectory, null);
      if (channel.type === "D" || channel.type === "G") {
        const kindLabel = getChannelKindLabel(channel);
        return kindLabel === "Group DM" ? `Group DM / ${channelLabel}` : `DM / ${channelLabel}`;
      }

      const teamLabel = channel.team_id ? teamDirectory[channel.team_id]?.display_name || teamDirectory[channel.team_id]?.name : null;
      return teamLabel ? `${channelLabel} / ${teamLabel}` : channelLabel;
    },
    [channelDirectory, memberDirectory, teamDirectory, userDirectory],
  );

  const handleLoadMore = async () => {
    if (teamIds.length === 0 || !username || !mentionSearchTerms || postState.loadingMore || !postState.hasMore) {
      return;
    }

    setPostState((current) => ({ ...current, loadingMore: true, error: null }));

    try {
      const [results] = await Promise.all([
        mapInBatches(
          teamIds,
          TEAM_FANOUT_BATCH_SIZE,
          async (teamId) => ({
            teamId,
            posts: await searchPostsInTeam(teamId, mentionSearchTerms, postState.nextPage, POSTS_PAGE_SIZE, { isOrSearch: true }),
          }),
          teamIds.length > TEAM_FANOUT_BATCH_SIZE ? TEAM_FANOUT_GAP_MS : 0,
        ),
        new Promise((resolve) => window.setTimeout(resolve, MIN_LOAD_MORE_MS)),
      ]);
      const posts = mergePosts(results.flatMap((entry) => entry.posts), []);
      void ensureUsers(posts.map((post) => post.user_id));
      setPostState((current) => ({
        status: "ready",
        posts: mergePosts(current.posts, posts),
        error: null,
        nextPage: current.nextPage + 1,
        hasMore: results.some((entry) => entry.posts.length === POSTS_PAGE_SIZE) && current.posts.length + posts.length < POSTS_MAX_BUFFER,
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

  useEffect(() => {
    if (!isDebugEnabled()) {
      return;
    }

    window.__mattermostDeckDebugColumnState ??= {};
    window.__mattermostDeckDebugColumnState[column.id] = {
      type: "mentions",
      postStatus: postState.status,
      postIds: postState.posts.map((post) => post.id),
      postMessages: postState.posts.map((post) => post.message),
      mentionCount,
      teamId: column.teamId,
    };

    return () => {
      if (window.__mattermostDeckDebugColumnState) {
        delete window.__mattermostDeckDebugColumnState[column.id];
      }
    };
  }, [column.id, column.teamId, mentionCount, postState.posts, postState.status]);

  return (
    <section className="deck-column deck-column--mentions" style={getColumnAccentStyle(column.type, columnColors)}>
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2 title="Mentions">
            <span className="deck-title-with-icon">
              <ColumnTypeBadge type="mentions" />
              <span>Mentions</span>
            </span>
          </h2>
          <p title={selectedTeam ? selectedTeam.display_name || selectedTeam.name : text.allTeams}>
            {selectedTeam ? selectedTeam.display_name || selectedTeam.name : text.allTeams}
          </p>
        </div>
        <div className="deck-column-actions">
          <div className="deck-badge" title={text.mentionBadge(mentionCount, Boolean(column.teamId))}>
            {mentionCount}
          </div>
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
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move left" onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move right" onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              title="Refresh"
              onClick={() => {
                refreshStartedAtRef.current = Date.now();
                setIsRefreshing(true);
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
              title={paused ? "Resume polling" : "Pause polling"}
              aria-label={paused ? "Resume polling" : "Pause polling"}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Remove column" onClick={() => onRemove(column.id)}>
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
            <strong>Mentions</strong>
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

      {postState.status === "error" ? (
        <article className="deck-card">
          <strong>Failed to load mentions</strong>
          <p>{postState.error ?? "Unknown error"}</p>
        </article>
      ) : shouldShowLoadingState ? (
        <ColumnLoadingState
          title="Loading mentions"
          detail="Checking unread mentions and syncing recent mention posts."
        />
      ) : visiblePosts.length === 0 ? (
        <article className="deck-card">
          <strong>No mentions</strong>
          <p>{column.unreadOnly ? "No unread mentions are currently available." : "Mentions will appear here."}</p>
        </article>
      ) : (
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
        />
      )}
    </section>
  );
}

function useRuntimePerformanceSnapshot(): RuntimePerformanceSnapshot {
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
  }, []);

  return snapshot;
}

function ChannelWatchColumn({
  column,
  mode,
  currentUserId,
  currentTeamId,
  currentChannelId,
  currentTeamLabel,
  currentChannelLabel,
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
}: {
  column: DeckColumn;
  mode: "channel" | "dm";
  currentUserId: string | null;
  currentTeamId?: string;
  currentChannelId?: string;
  currentTeamLabel?: string | null;
  currentChannelLabel?: string | null;
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastViewedAt, setLastViewedAt] = useState<number | null>(null);
  const hasConfiguredTarget = mode === "dm" ? Boolean(column.channelId) : Boolean(column.teamId && column.channelId);
  const shouldShowLoadingState =
    hasConfiguredTarget &&
    postState.posts.length === 0 &&
    (postState.status === "idle" || postState.status === "loading");
  const [showControls, setShowControls] = useState(!hasConfiguredTarget);
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshStopTimerRef = useRef<number | null>(null);
  const markReadFiredRef = useRef(false);
  const teamDirectory = useMemo(() => Object.fromEntries(teams.map((team) => [team.id, team])), [teams]);
  const selectedTeam = column.teamId ? teamDirectory[column.teamId] : undefined;

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
          error: error instanceof Error ? error.message : "Failed to load channels.",
        });
        finishRefresh();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [column.channelId, column.id, column.teamId, ensureUsers, finishRefresh, mode, onUpdate]);

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
  const highlightTerms = useMemo(() => extractHighlightKeywords(highlightKeywords), [highlightKeywords]);
  const canWatchCurrentChannel = Boolean(currentChannelId) && (mode === "dm" || Boolean(currentTeamId));
  const currentWatchLabel = currentChannelLabel ?? (mode === "dm" ? text.directMessage : text.channelLabel);

  useEffect(() => {
    if (!isDebugEnabled()) {
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

  useEffect(() => {
    if (!selectedChannel) {
      return;
    }
    onRememberTarget({
      type: mode === "dm" ? "dmWatch" : "channelWatch",
      teamId: selectedTeam?.id ?? "",
      teamLabel: selectedTeam ? selectedTeam.display_name || selectedTeam.name : selectedChannelKindLabel ?? "Direct message",
      channelId: selectedChannel.id,
      channelLabel: selectedChannelLabel ?? (selectedChannel.display_name || selectedChannel.name),
    });
  }, [mode, onRememberTarget, selectedChannel, selectedChannelKindLabel, selectedChannelLabel, selectedTeam]);

  useEffect(() => {
    let cancelled = false;

    if (paused) {
      return () => { cancelled = true; };
    }

    if ((mode === "channel" && !column.teamId) || !column.channelId) {
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
      setPostState((current) => ({
        ...current,
        status: current.posts.length > 0 ? current.status : "loading",
        error: null,
      }));
      try {
        const posts = await getRecentPosts(column.channelId as string, 0, POSTS_PAGE_SIZE);
        if (cancelled) {
          return;
        }
        void ensureUsers(posts.map((post) => post.user_id));
        setPostState({
          status: "ready",
          posts,
          error: null,
          nextPage: 1,
          hasMore: posts.length === POSTS_PAGE_SIZE,
          loadingMore: false,
        });
        finishRefresh();
      } catch (error) {
        if (cancelled) {
          return;
        }
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
    };

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, getSyncInterval(realtimeEnabled, pollingIntervalSeconds));
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [column.channelId, column.teamId, ensureUsers, finishRefresh, mode, paused, pollingIntervalSeconds, realtimeEnabled, reconnectNonce, refreshNonce]);

  useEffect(() => {
    if (!postedEvent || postedEvent.channelId !== column.channelId) {
      return;
    }
    void ensureUsers([postedEvent.post.user_id]);
    setPostState((current) => ({
      ...current,
      status: "ready",
      error: null,
      posts: mergePosts([postedEvent.post], current.posts),
    }));
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
        error: error instanceof Error ? error.message : "Failed to load more posts.",
        loadingMore: false,
      }));
    }
  };

  return (
    <section className={`deck-column deck-column--${mode === "dm" ? "dm" : "channel"}`} style={getColumnAccentStyle(column.type, columnColors)}>
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2 title={selectedChannelLabel ?? (mode === "dm" ? "DM / Group" : "Channel Watch")}>
            <span className="deck-title-with-icon">
              <ColumnTypeBadge type={column.type} />
              <span>{selectedChannelLabel ?? (mode === "dm" ? "DM / Group" : "Channel Watch")}</span>
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
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            aria-label={showControls ? text.collapseControls("") : text.expandControls("")}
          >
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>

      {showControls ? (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-inline-actions">
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move left" onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move right" onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              title="Refresh"
              onClick={() => {
                refreshStartedAtRef.current = Date.now();
                setIsRefreshing(true);
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
              title={paused ? "Resume polling" : "Pause polling"}
              aria-label={paused ? "Resume polling" : "Pause polling"}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Remove column" onClick={() => onRemove(column.id)}>
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
              <span>{mode === "dm" ? "DM / Group" : text.channelLabel}</span>
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
          ) : !column.channelId ? (
            <article className="deck-card">
              <strong>{mode === "dm" ? text.selectADm : text.selectAChannel}</strong>
              <p>{channelState.error ?? (mode === "dm" ? text.selectDmDesc : text.selectChannelDesc)}</p>
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
          <strong>Start with a channel</strong>
          <p>Pin one watch target first, or add a few recommended columns for a better first pass.</p>
          <div className="deck-stack deck-stack--empty-actions">
            {canWatchCurrentChannel ? (
              <button
                type="button"
                className="deck-add-item"
                onClick={() => onUpdate(column.id, { teamId: currentTeamId, channelId: currentChannelId })}
              >
                <span>Watch current channel</span>
                <small>{currentWatchLabel}{currentTeamLabel ? ` / ${currentTeamLabel}` : ""}</small>
              </button>
            ) : null}
            <button type="button" className="deck-add-item deck-add-item--secondary" onClick={() => onAddColumn("mentions")}>
              <span>Recommended: Mentions</span>
              <small>Keep personal mentions visible.</small>
            </button>
            <button type="button" className="deck-add-item deck-add-item--secondary" onClick={() => onAddColumn("saved")}>
              <span>Recommended: Saved</span>
              <small>Keep follow-up posts close by.</small>
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
                <span>Use current channel</span>
                <small>{currentWatchLabel}{currentTeamLabel ? ` / ${currentTeamLabel}` : ""}</small>
              </button>
            ) : null}
            <button type="button" className="deck-add-item deck-add-item--secondary" onClick={() => onAddColumn("diagnostics")}>
              <span>Recommended: Diagnostics</span>
              <small>Track sync, reconnects, and render cost.</small>
            </button>
          </div>
        </article>
      ) : postState.status === "error" ? (
        <article className="deck-card">
          <strong>Failed to load posts</strong>
          <p>{postState.error ?? "Unknown error"}</p>
        </article>
      ) : shouldShowLoadingState ? (
        <ColumnLoadingState
          title={mode === "dm" ? "Loading direct messages" : "Loading channel posts"}
          detail={mode === "dm" ? "Fetching the latest direct message posts for this target." : "Fetching the latest channel posts for this pinned target."}
        />
      ) : postState.posts.length === 0 ? (
        <article className="deck-card">
          <strong>No posts yet</strong>
          <p>{mode === "dm" ? "This direct message does not have recent posts to show." : "This pinned channel does not have recent posts to show."}</p>
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
  return (
    <section className="deck-loading-state" aria-live="polite">
      <div className="deck-loading-spinner" aria-hidden="true" />
      <strong>{message}</strong>
      <p>Preparing your deck layout and syncing the first Mattermost data.</p>
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
    <article className="deck-loading-state deck-loading-state--column" aria-live="polite">
      <div className="deck-loading-spinner" aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
      <div className="deck-loading-skeletons" aria-hidden="true">
        <div className="deck-loading-skeleton" />
        <div className="deck-loading-skeleton" />
      </div>
    </article>
  );
}

function SearchLikeColumn({
  column,
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
}: {
  column: DeckColumn;
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(!(column.teamId && column.query?.trim()));
  const [draftQuery, setDraftQuery] = useState(column.query ?? "");
  const [savedSearches, setSavedSearches] = useState<string[]>([]);

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
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshStopTimerRef = useRef<number | null>(null);
  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const query = column.query?.trim() ?? "";
  const highlightTerms = useMemo(
    () => uniqueTerms([...extractSearchTerms(query), ...extractHighlightKeywords(highlightKeywords)]),
    [highlightKeywords, query],
  );
  const apiQuery = useMemo(() => expandSearchQueryForApi(query), [query]);
  const ready = Boolean(column.teamId && query);
  const shouldShowLoadingState =
    ready &&
    postState.posts.length === 0 &&
    (postState.status === "idle" || postState.status === "loading");
  const title = query || "Search";

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

  useEffect(() => {
    let cancelled = false;

    if (paused) {
      return () => { cancelled = true; };
    }

    if (!ready) {
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
      setPostState((current) => ({
        ...current,
        status: current.posts.length > 0 ? current.status : "loading",
        error: null,
      }));

      try {
        const posts = await searchPostsInTeam(column.teamId as string, apiQuery, 0, POSTS_PAGE_SIZE);
        if (cancelled) {
          return;
        }
        ensureUsers(posts.map((post) => post.user_id));
        setPostState({
          status: "ready",
          posts,
          error: null,
          nextPage: 1,
          hasMore: posts.length === POSTS_PAGE_SIZE,
          loadingMore: false,
        });
        finishRefresh();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPostState({
          status: "error",
          posts: [],
          error: error instanceof Error ? error.message : "Failed to load search results.",
          nextPage: 1,
          hasMore: false,
          loadingMore: false,
        });
        finishRefresh();
      }
    };

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, Math.max(getSyncInterval(false, pollingIntervalSeconds), SEARCH_SYNC_INTERVAL_FLOOR_MS));

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiQuery, column.teamId, ensureUsers, finishRefresh, paused, pollingIntervalSeconds, ready, reconnectNonce, refreshNonce]);

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
        error: error instanceof Error ? error.message : "Failed to load more results.",
        loadingMore: false,
      }));
    }
  };

  const handleApplyQuery = () => {
    onUpdate(column.id, { query: draftQuery.trim() || undefined });
  };

  return (
    <section className="deck-column deck-column--search" style={getColumnAccentStyle(column.type, columnColors)}>
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2 title={title}>
            <span className="deck-title-with-icon">
              <ColumnTypeBadge type={column.type} />
              <span>{title}</span>
            </span>
          </h2>
          <p title={selectedTeam ? selectedTeam.display_name || selectedTeam.name : "Pick a team"}>
            {selectedTeam ? selectedTeam.display_name || selectedTeam.name : "Pick a team"}
          </p>
        </div>
        <div className="deck-column-actions">
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => setShowControls((current) => !current)}
            aria-label={showControls ? "Collapse search controls" : "Expand search controls"}
          >
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>

      {showControls ? (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-inline-actions">
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move left" onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move right" onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              title="Refresh"
              onClick={() => {
                refreshStartedAtRef.current = Date.now();
                setIsRefreshing(true);
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
              title={paused ? "Resume polling" : "Pause polling"}
              aria-label={paused ? "Resume polling" : "Pause polling"}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Remove column" onClick={() => onRemove(column.id)}>
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
                title="Save search query"
                aria-label="Save search query"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </button>
            </div>
            {savedSearches.length > 0 && (
              <div className="deck-saved-searches">
                <span className="deck-saved-searches-label">Saved</span>
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
                        aria-label={`Remove saved search: ${q}`}
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
            <strong>Search syntax</strong>
            <p>
              Use quotes for exact phrases like <code>"error code"</code>, suffix <code>*</code> for prefix matches like <code>test*</code>,
              and filters such as <code>in:town-square</code>, <code>from:cab-member</code>, <code>before:2026-04-04</code>.
            </p>
          </article>
        </div>
      ) : null}

      {!ready ? (
        <article className="deck-card">
          <strong>Set a search</strong>
          <p>Choose a team and enter a query. The pane refreshes automatically after you apply it.</p>
        </article>
      ) : postState.status === "error" ? (
        <article className="deck-card">
          <strong>Failed to load results</strong>
          <p>{postState.error ?? "Unknown error"}</p>
        </article>
      ) : shouldShowLoadingState ? (
        <ColumnLoadingState
          title={column.type === "keywordWatch" ? "Loading keyword matches" : "Loading search results"}
          detail={column.type === "keywordWatch" ? "Searching recent posts that match your keyword watch query." : "Searching Mattermost posts for your query."}
        />
      ) : postState.posts.length === 0 ? (
        <article className="deck-card">
          <strong>No results</strong>
          <p>No matching posts found for this query.</p>
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
          renderBody={(post) => renderHighlightedTextFromTerms(buildSearchSnippet(post.message, query), highlightTerms)}
          onOpenPost={(post) => onOpenPost(post, {
            teamName: selectedTeam?.name,
            channelName: searchChannelDirectory[post.channel_id]?.name,
          })}
          postClickAction={postClickAction}
          showImagePreviews={showImagePreviews}
          language={language}
          reversedPostOrder={reversedPostOrder}
          highlightTerms={highlightTerms}
        />
      )}
    </section>
  );
}

function SavedPostsColumn({
  column,
  userDirectory,
  ensureUsers,
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
}: {
  column: DeckColumn;
  userDirectory: Record<string, MattermostUser>;
  ensureUsers: (userIds: string[]) => Promise<void>;
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
}): React.JSX.Element {
  const [savedChannelDirectory, setSavedChannelDirectory] = useState<Record<string, MattermostChannel>>({});
  const [postState, setPostState] = useState<PostState>({
    status: "idle",
    posts: [],
    error: null,
    nextPage: 1,
    hasMore: false,
    loadingMore: false,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const highlightTerms = useMemo(() => extractHighlightKeywords(highlightKeywords), [highlightKeywords]);
  const shouldShowLoadingState =
    postState.posts.length === 0 &&
    (postState.status === "idle" || postState.status === "loading");
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshStopTimerRef = useRef<number | null>(null);

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

    if (paused) {
      return () => { cancelled = true; };
    }

    const run = async () => {
      setPostState((current) => ({ ...current, status: current.posts.length > 0 ? current.status : "loading", error: null }));
      try {
        const posts = await getFlaggedPosts(0, POSTS_PAGE_SIZE);
        if (cancelled) {
          return;
        }
        ensureUsers(posts.map((post) => post.user_id));
        setPostState({
          status: "ready",
          posts,
          error: null,
          nextPage: 1,
          hasMore: posts.length === POSTS_PAGE_SIZE,
          loadingMore: false,
        });
        finishRefresh();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPostState({
          status: "error",
          posts: [],
          error: error instanceof Error ? error.message : "Failed to load saved posts.",
          nextPage: 1,
          hasMore: false,
          loadingMore: false,
        });
        finishRefresh();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [ensureUsers, finishRefresh, paused, refreshNonce]);

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
        error: error instanceof Error ? error.message : "Failed to load more saved posts.",
        loadingMore: false,
      }));
    }
  };

  return (
    <section className="deck-column deck-column--saved" style={getColumnAccentStyle(column.type, columnColors)}>
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2><span className="deck-title-with-icon"><ColumnTypeBadge type="saved" /><span>Saved</span></span></h2>
          <p>Flagged posts</p>
        </div>
        <div className="deck-column-actions">
          <button type="button" className="deck-icon-button deck-icon-button--ghost" onClick={() => setShowControls((current) => !current)}>
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>
      {showControls ? (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-inline-actions">
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move left" onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move right" onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button
              type="button"
              className="deck-icon-button deck-icon-button--ghost"
              title="Refresh"
              onClick={() => {
                refreshStartedAtRef.current = Date.now();
                setIsRefreshing(true);
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
              title={paused ? "Resume polling" : "Pause polling"}
              aria-label={paused ? "Resume polling" : "Pause polling"}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Remove column" onClick={() => onRemove(column.id)}>
              <CloseIcon />
            </button>
          </div>
        </div>
      ) : null}
      {postState.status === "error" ? (
        <article className="deck-card">
          <strong>Failed to load saved posts</strong>
          <p>{postState.error ?? "Unknown error"}</p>
        </article>
      ) : shouldShowLoadingState ? (
        <ColumnLoadingState
          title="Loading saved posts"
          detail="Fetching your flagged posts and syncing the latest saved items."
        />
      ) : postState.posts.length === 0 ? (
        <article className="deck-card">
          <strong>No saved posts</strong>
          <p>Flagged posts will appear here.</p>
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
}): React.JSX.Element {
  const text = useAppText();
  const [showControls, setShowControls] = useState(false);

  return (
    <section className="deck-column deck-column--diagnostics" style={getColumnAccentStyle(column.type, columnColors)}>
      <header className="deck-column-header">
        <div className="deck-column-heading">
          <h2><span className="deck-title-with-icon"><ColumnTypeBadge type="diagnostics" /><span>Diagnostics</span></span></h2>
          <p>Operational health at a glance</p>
        </div>
        <div className="deck-column-actions">
          <button type="button" className="deck-icon-button deck-icon-button--ghost" onClick={() => setShowControls((current) => !current)}>
            <ChevronIcon expanded={showControls} />
          </button>
        </div>
      </header>
      {showControls ? (
        <div className="deck-stack deck-stack--controls">
          <div className="deck-inline-actions">
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move left" onClick={() => onMove(column.id, "left")} disabled={!canMoveLeft}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Move right" onClick={() => onMove(column.id, "right")} disabled={!canMoveRight}>
              <ArrowIcon direction="right" />
            </button>
            <button type="button" className="deck-icon-button deck-icon-button--ghost" title="Remove column" onClick={() => onRemove(column.id)}>
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
            <strong>Status</strong>
            <p>{apiHealthStatus}</p>
            <span>{realtimeEnabled ? wsStatus : "polling"}</span>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>API TPS</strong>
            <p>{runtimeMetrics.api.recentTps.toFixed(1)}</p>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>Avg latency</strong>
            <p>{formatLatency(runtimeMetrics.api.averageLatencyMs)}</p>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>Error rate</strong>
            <p>{formatRate(runtimeMetrics.api.recentErrorRate)}</p>
            <span>{runtimeMetrics.api.recentFailedRequestsPerMinute} / {runtimeMetrics.api.recentRequestsPerMinute} recent</span>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>In flight</strong>
            <p>{runtimeMetrics.api.inFlightRequests}</p>
            <span>{runtimeMetrics.api.totalGetRequests} GET / {runtimeMetrics.api.totalPostRequests} POST / {runtimeMetrics.api.totalFailedRequests} failed</span>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>WS reconnects</strong>
            <p>{runtimeMetrics.diagnostics.websocket.reconnectCount.toLocaleString()}</p>
            <span>{runtimeMetrics.diagnostics.websocket.lastReconnectAt ? formatPostTime(runtimeMetrics.diagnostics.websocket.lastReconnectAt) : "n/a"}</span>
          </article>
          <article className="deck-card deck-card--metric">
            <strong>Render</strong>
            <p>{formatLatency(runtimeMetrics.diagnostics.render.p95CommitMs)}</p>
            <span>avg {formatLatency(runtimeMetrics.diagnostics.render.averageCommitMs)} / last {formatLatency(runtimeMetrics.diagnostics.render.lastCommitMs)}</span>
          </article>
        </div>
        <article className="deck-card">
          <strong>Recent sync log</strong>
          <ul className="deck-log-list">
            {syncLogs.length > 0 ? syncLogs.slice(0, 8).map((entry) => (
              <li key={`${entry.timestamp}-${entry.message}`} className={`deck-log-entry deck-log-entry--${entry.level}`}>
                <span className="deck-log-time">{formatPostTime(entry.timestamp)}</span>
                <span className="deck-log-text" title={entry.message}>{entry.message}</span>
              </li>
            )) : (
              <li className="deck-log-entry deck-log-entry--info">
                <span className="deck-log-time">-</span>
                <span className="deck-log-text" title={text.noRecentEvents}>{text.noRecentEvents}</span>
              </li>
            )}
          </ul>
          <p className="deck-card-caption">Detailed traces and endpoint analysis are available in Settings &gt; Performance.</p>
        </article>
      </div>
    </section>
  );
}

export function App({ routeKey, shadowRoot }: AppProps): React.JSX.Element {
  useEffect(() => {
    debugLog("app.mount", { routeKey, path: window.location.pathname });
    return () => {
      debugLog("app.unmount", { routeKey, path: window.location.pathname });
    };
  }, []);

  useEffect(() => {
    debugLog("app.routeKey", { routeKey, path: window.location.pathname });
  }, [routeKey]);

  const currentRoute = useMemo(() => readCurrentRoute(), [routeKey]);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [postedEvent, setPostedEvent] = useState<PostedEvent | null>(null);
  const [userDirectory, setUserDirectory] = useState<Record<string, MattermostUser>>({});
  const userDirectoryRef = useRef<Record<string, MattermostUser>>({});
  const [drawerOpen, setDrawerOpen] = useStoredBoolean(DRAWER_OPEN_STORAGE_KEY, true);
  const [contentMounted, setContentMounted] = useState(true);
  const unmountTimerRef = useRef<number | null>(null);
  const deckSettings = useDeckSettingsState();
  const text = useAppText();
  useEffect(() => { void i18n.changeLanguage(deckSettings.language); }, [deckSettings.language]);
  const realtimeEnabled = deckSettings.wsPat.trim().length > 0;
  const state = useDeckState(reconnectNonce, realtimeEnabled, deckSettings.pollingIntervalSeconds);
  const [columns, addColumn, removeColumn, updateColumn, moveColumn, replaceColumns] = useDeckLayout();
  const [recentTargets, rememberRecentTarget] = useRecentTargets();
  const [savedViews, saveView, removeView, getView] = useSavedViews();
  const [railWidth, setRailWidth] = useRailWidth(drawerOpen, deckSettings.preferredRailWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showViewsMenu, setShowViewsMenu] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showRailAddMenu, setShowRailAddMenu] = useState(false);
  const [viewReorderMode, setViewReorderMode] = useState(false);
  const [viewReorderDraft, setViewReorderDraft] = useState<DeckColumn[] | null>(null);
  const [railAddMenuPosition, setRailAddMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [isCompactHeader, setIsCompactHeader] = useState(false);
  const [pendingScrollColumnId, setPendingScrollColumnId] = useState<string | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
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
  const resizeStateRef = useRef<{ pointerId: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const wsStatus = useWebSocketStatus();
  const syncLogs = useSyncLogs();
  const runtimeMetrics = useRuntimePerformanceSnapshot();
  const mattermostThemeState = useMattermostThemeStyle(deckSettings.theme, routeKey);
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
  const connectionModeLabel = realtimeEnabled ? "Realtime" : "Polling";
  const syncStatusLabel = `${healthStatusLabel} / ${connectionModeLabel}`;
  const handleOpenPost = useCallback(
    (post: MattermostPost, target?: OpenPostTarget) => {
      const targetTeam = target?.teamName ?? currentRoute.teamName;
      if (!targetTeam) {
        return;
      }
      openMattermostThread(targetTeam, post.id, target?.channelName ?? currentRoute.channelName);
    },
    [currentRoute.channelName, currentRoute.teamName],
  );

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DEBUG_FLAG_KEY) !== "1") {
        return;
      }
      const handleDebugOpenThread = (event: Event) => {
        const customEvent = event as CustomEvent<{ teamName?: string; postId?: string; channelName?: string }>;
        const teamName = customEvent.detail?.teamName;
        const postId = customEvent.detail?.postId;
        const channelName = customEvent.detail?.channelName;
        if (!teamName || !postId) {
          return;
        }
        openMattermostThread(teamName, postId, channelName ?? readCurrentRoute().channelName);
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

  useEffect(() => {
    const root = document.getElementById(DECK_ROOT_ID);
    if (!root) return;
    root.style.transition = isResizing ? "none" : "";
  }, [isResizing]);

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
      element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" });
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

    const name = window.prompt("View name", "");
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
      replaceColumns(parsed.columns);
      setShowActionsMenu(false);
      setShowRailAddMenu(false);
    } catch {
      return;
    }
  };

  useEffect(() => {
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

      let result: unknown = null;
      if (action === "getState") {
        result = debugApi?.getState() ?? null;
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
      } else if (action === "getHighlightTexts" && debugShadowRoot) {
        result = Array.from(debugShadowRoot.querySelectorAll("mark.search-highlight"))
          .map((element) => element.textContent?.trim() ?? "")
          .filter(Boolean);
      } else if (action === "getLoadingState" && debugShadowRoot) {
        const loadingState = debugShadowRoot.querySelector(".deck-loading-state");
        result = {
          present: Boolean(loadingState),
          spinnerPresent: Boolean(debugShadowRoot.querySelector(".deck-loading-spinner")),
          skeletonCount: debugShadowRoot.querySelectorAll(".deck-loading-skeleton").length,
          text: loadingState?.querySelector("strong")?.textContent?.trim() ?? null,
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
    contentMounted,
    deckSettings.theme,
    handleAddColumn,
    mattermostThemeState.initialSource,
    mattermostThemeStyle,
    moveColumn,
    removeColumn,
    state.status,
    state.username,
    updateColumn,
  ]);

  const isInitialLoading = state.status === "loading" || columns === null;

  return (
    <React.Profiler id="mattermost-deck" onRender={(_, __, actualDuration) => recordRenderCommit(actualDuration)}>
    <ShadowRootContext.Provider value={shadowRoot}>
    <aside
      ref={shellRef}
      className={`deck-shell${drawerOpen ? "" : " deck-shell--collapsed"}`}
      aria-label="Mattermost Deck"
      data-theme={deckSettings.theme === "mattermost" ? "mattermost" : resolveTheme(deckSettings.theme)}
      data-column-color-enabled={deckSettings.columnColorEnabled ? "true" : "false"}
      style={shellStyle}
    >
      <input
        ref={importFileInputRef}
        type="file"
        accept="application/json,.json"
        className="deck-hidden-file-input"
        onChange={handleImportFileChange}
      />
      <button
        type="button"
        className={`deck-resizer${isResizing ? " deck-resizer--active" : ""}`}
        onPointerDown={handleResizeStart}
        aria-label={text.resizeLabel}
        title={text.resizeDrag}
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

      {!drawerOpen && <div className="deck-collapsed-banner">Mattermost Deck</div>}
      {contentMounted && (
        <div style={{ display: drawerOpen ? "contents" : "none" }}>
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
              {realtimeEnabled ? (
                <div
                  className={`deck-status-badge deck-status-badge--${apiHealthStatus}${isCompactHeader ? " deck-status-badge--compact" : ""}`}
                  title={syncStatusLabel}
                  aria-label={syncStatusLabel}
                >
                  <span className="deck-status-badge-dot" />
                  <span className="deck-status-badge-copy">
                    <StatusModeIcon realtimeEnabled={realtimeEnabled} />
                    {!isCompactHeader ? <span>{healthStatusLabel}</span> : null}
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
                  <span className="deck-status-badge-dot" />
                  <span className="deck-status-badge-copy">
                    <StatusModeIcon realtimeEnabled={realtimeEnabled} />
                    {!isCompactHeader ? <span>{healthStatusLabel}</span> : null}
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
                >
                  <ViewsIcon />
                  <span className="deck-button-label">Views</span>
                </button>
                {showViewsMenu ? (
                  <div className="deck-add-menu deck-add-menu--views">
                    <div className="deck-add-menu-title">Views</div>
                    <div className="deck-menu-row deck-menu-row--toolbar">
                      {!viewReorderMode ? (
                        <button type="button" className="deck-add-item" onClick={handleStartViewReorder}>
                          Reorder panes
                        </button>
                      ) : (
                        <>
                          <button type="button" className="deck-add-item" onClick={handleApplyViewReorder}>
                            Apply order
                          </button>
                          <button type="button" className="deck-add-item deck-add-item--secondary" onClick={handleCancelViewReorder}>
                            Cancel
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
                                aria-label={`Move ${meta.title} up`}
                                disabled={index === 0}
                              >
                                <ArrowIcon direction="left" />
                              </button>
                              <button
                                type="button"
                                className="deck-icon-button deck-icon-button--ghost"
                                onClick={() => handleMoveViewDraft(column.id, "down")}
                                aria-label={`Move ${meta.title} down`}
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
                              aria-label={`Close ${meta.title}`}
                            >
                              <CloseIcon />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <div className="deck-add-menu-title deck-add-menu-title--secondary">Saved sets</div>
                    <button type="button" className="deck-add-item" onClick={handleSaveCurrentView}>
                      Save current set
                    </button>
                    {savedViews.length > 0 ? (
                      <>
                        {savedViews.map((view) => (
                          <div key={view.id} className="deck-menu-row">
                            <button type="button" className="deck-add-item deck-add-item--recent" onClick={() => handleLoadSavedView(view.id)}>
                              <span>{view.name}</span>
                              <small>{view.columns.length} columns</small>
                            </button>
                            <button type="button" className="deck-icon-button deck-icon-button--ghost" onClick={() => removeView(view.id)} aria-label={`Remove ${view.name}`}>
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
                >
                  <PlusIcon />
                  <span className="deck-button-label">{text.addLabel}</span>
                </button>
                {showAddMenu ? (
                  <div className="deck-add-menu">
                    <div className="deck-add-menu-title">{text.choosePane}</div>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("mentions")}>
                      <ColumnMenuLabel type="mentions" label={text.addMentions} />
                    </button>
                    <button type="button" className="deck-add-item" onClick={() => handleAddColumn("channelWatch")}>
                      <ColumnMenuLabel type="channelWatch" label={text.addChannelWatch} />
                    </button>
                    {state.currentChannelId ? (
                      <button type="button" className="deck-add-item deck-add-item--secondary" onClick={handleAddCurrentChannelWatch}>
                        <span>Watch current channel</span>
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
                >
                  <HamburgerIcon />
                </button>
                {showActionsMenu ? (
                  <div className="deck-add-menu deck-add-menu--compact">
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
                            <span>Watch current channel</span>
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
                        <div className="deck-add-menu-title deck-add-menu-title--secondary">Views</div>
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
                                aria-label={`Close ${meta.title}`}
                              >
                                <CloseIcon />
                              </button>
                            </div>
                          );
                        })}
                        <div className="deck-add-menu-title deck-add-menu-title--secondary">Saved sets</div>
                        <button type="button" className="deck-add-item" onClick={handleSaveCurrentView}>
                          Save current set
                        </button>
                        {savedViews.length > 0 ? (
                          <>
                            {savedViews.map((view) => (
                              <div key={view.id} className="deck-menu-row">
                                <button type="button" className="deck-add-item deck-add-item--recent" onClick={() => handleLoadSavedView(view.id)}>
                                  <span>{view.name}</span>
                                  <small>{view.columns.length} columns</small>
                                </button>
                                <button type="button" className="deck-icon-button deck-icon-button--ghost" onClick={() => removeView(view.id)} aria-label={`Remove ${view.name}`}>
                                  <CloseIcon />
                                </button>
                              </div>
                            ))}
                          </>
                        ) : null}
                      </>
                    ) : null}
                    <div className="deck-add-menu-title deck-add-menu-title--secondary">Menu</div>
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
                    <div className="deck-add-menu-title deck-add-menu-title--secondary">Layout</div>
                    <button type="button" className="deck-add-item" onClick={handleExportLayout}>
                      Export layout
                    </button>
                    <button type="button" className="deck-add-item" onClick={handleImportLayout}>
                      Import layout
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="deck-scroll-wrap">
            <main
              className="deck-columns"
              style={{
                minWidth:
                  (columns?.length ?? 1) * (normalisePreferredColumnWidth(deckSettings.preferredColumnWidth) + 20) + 32,
              }}
            >
              {isInitialLoading ? (
                <div className="deck-column-motion">
                  <InitialLoadingState message={text.loading} />
                </div>
              ) : (columns ?? []).map((column, index, allColumns) => {
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
                          currentTeamId={state.currentTeamId}
                          currentChannelId={state.currentChannelId}
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
                          postClickAction={deckSettings.postClickAction}
                          compactMode={deckSettings.compactMode}
                          columnColors={deckSettings.columnColors}
                          showImagePreviews={deckSettings.showImagePreviews}
                          language={deckSettings.language}
                          reversedPostOrder={deckSettings.reversedPostOrder}
                          highlightKeywords={deckSettings.highlightKeywords}
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
                          currentTeamId={state.currentTeamId}
                          currentChannelId={state.currentChannelId}
                          currentTeamLabel={state.currentTeamLabel}
                          currentChannelLabel={state.currentChannelLabel}
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
                          currentTeamId={state.currentTeamId}
                          currentChannelId={state.currentChannelId}
                          currentTeamLabel={state.currentTeamLabel}
                          currentChannelLabel={state.currentChannelLabel}
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
                        />
                      </div>
                    );
                  case "search":
                  case "keywordWatch":
                    return (
                      <div key={column.id} ref={setColumnRef} className="deck-column-motion">
                        <SearchLikeColumn
                          column={column}
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
                        />
                      </div>
                    );
                  case "saved":
                    return (
                      <div key={column.id} ref={setColumnRef} className="deck-column-motion">
                        <SavedPostsColumn
                          column={column}
                          userDirectory={userDirectory}
                          ensureUsers={ensureUsers}
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
                        />
                      </div>
                    );
                  case "diagnostics":
                    return (
                      <div key={column.id} ref={setColumnRef} className="deck-column-motion">
                        <DiagnosticsColumn
                          column={column}
                          wsStatus={wsStatus}
                          syncLogs={syncLogs}
                          apiHealthStatus={apiHealthStatus}
                          realtimeEnabled={realtimeEnabled}
                          runtimeMetrics={runtimeMetrics}
                          canMoveLeft={index > 0}
                          canMoveRight={index < allColumns.length - 1}
                          onMove={moveColumn}
                          onRemove={removeColumn}
                          onOpenSettings={handleOpenSettings}
                          columnColors={deckSettings.columnColors}
                          language={deckSettings.language}
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
                >
                  <PlusIcon />
                </button>
              </div>
            </main>
          </div>
          {showRailAddMenu && railAddMenuPosition ? (
            <div
              ref={railAddOverlayMenuRef}
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
                  <span>Watch current channel</span>
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
    </React.Profiler>
  );
}
