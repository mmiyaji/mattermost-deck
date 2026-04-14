import React from "react";
import type { MattermostPost, MattermostUser } from "../mattermost/api";
import { extractHighlightKeywords, tokenizePostText } from "./postText";

const COMPACT_AUTHOR_COLORS = [
  "#57c7ff",
  "#7ee787",
  "#f2cc60",
  "#ff9e64",
  "#f7768e",
  "#bb9af7",
  "#4fd6be",
  "#9ece6a",
  "#e0af68",
  "#7dcfff",
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function formatPostTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return new Intl.DateTimeFormat(
    "ja-JP",
    isToday ? { hour: "2-digit", minute: "2-digit" } : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" },
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
  return new Intl.DateTimeFormat("ja-JP", { month: "2-digit", day: "2-digit" }).format(date);
}

export type PostListEntry =
  | { type: "separator"; key: string; label: string }
  | { type: "unread-separator"; key: string }
  | { type: "post"; key: string; post: MattermostPost };

export function buildPostListEntries(posts: MattermostPost[], lastViewedAt?: number | null): PostListEntry[] {
  const entries: PostListEntry[] = [];
  let unreadInserted = false;
  posts.forEach((post, index) => {
    const previous = posts[index - 1];
    if (previous && !isSameCalendarDay(previous.create_at, post.create_at)) {
      entries.push({ type: "separator", key: `separator:${post.id}`, label: getPostDayLabel(previous.create_at) });
    }
    if (!unreadInserted && lastViewedAt != null && lastViewedAt > 0 && post.create_at <= lastViewedAt) {
      unreadInserted = true;
      if (index > 0) {
        entries.push({ type: "unread-separator", key: "unread-separator" });
      }
    }
    entries.push({ type: "post", key: post.id, post });
  });
  return entries;
}

export function binarySearchOffsets(offsets: number[], value: number): number {
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

export function getCompactAuthorColor(userId: string, currentUserId?: string | null): string {
  if (currentUserId && userId === currentUserId) {
    return "var(--deck-accent-strong)";
  }
  return COMPACT_AUTHOR_COLORS[hashString(userId) % COMPACT_AUTHOR_COLORS.length] ?? COMPACT_AUTHOR_COLORS[0];
}

export function summarisePost(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty message)";
  }
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSearchTerms(query: string): string[] {
  return query.match(/"([^"]+)"|(\S+)/g)?.map((part) => part.replace(/^"|"$/g, "").trim()).filter((part) => part.length > 0) ?? [];
}

export function expandSearchQueryForApi(query: string): string {
  return query.replace(/"[^"]+"|\S+/g, (token) => {
    if (token.startsWith("\"") && token.endsWith("\"")) return token;
    if (token.includes(":") || token.includes("*")) return token;
    return /^[\p{L}\p{N}_-]+$/u.test(token) ? `*${token}*` : token;
  });
}

export function buildSearchSnippet(message: string, query: string, limit = 160): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty message)";
  }
  const terms = extractSearchTerms(query);
  const lower = normalized.toLowerCase();
  const matchPositions = terms.map((term) => lower.indexOf(term.toLowerCase())).filter((index) => index >= 0).sort((left, right) => left - right);
  if (matchPositions.length === 0 || normalized.length <= limit) {
    return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
  }
  const pivot = matchPositions[0];
  const start = Math.max(0, pivot - Math.floor(limit * 0.35));
  const end = Math.min(normalized.length, start + limit);
  const adjustedStart = Math.max(0, end - limit);
  const snippet = normalized.slice(adjustedStart, end).trim();
  return `${adjustedStart > 0 ? "..." : ""}${snippet}${end < normalized.length ? "..." : ""}`;
}

export function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(term);
  }
  return result;
}

export function buildDefaultHighlightTerms(defaultTerm?: string | null): string[] {
  const fallback = defaultTerm?.trim();
  if (!fallback) {
    return [];
  }

  return uniqueTerms([`@${fallback}`, "@all", "@here", "@channel"]);
}

export function resolveHighlightTerms(highlightKeywords: string, defaultTerm?: string | null): string[] {
  const configured = extractHighlightKeywords(highlightKeywords);
  if (configured.length > 0) {
    return configured;
  }
  return buildDefaultHighlightTerms(defaultTerm);
}

function renderTextHighlights(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) {
    return text;
  }
  const pattern = new RegExp(`(${terms.map((term) => escapeRegExp(term)).join("|")})`, "gi");
  const segments = text.split(pattern);
  return segments.map((segment, index) =>
    terms.some((term) => segment.toLowerCase() === term.toLowerCase()) ? (
      <mark key={`${segment}-${index}`} className="search-highlight">{segment}</mark>
    ) : (
      <React.Fragment key={`${segment}-${index}`}>{segment}</React.Fragment>
    ),
  );
}

export function renderHighlightedTextFromTerms(text: string, terms: string[]): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let index = 0;
  for (const token of tokenizePostText(text)) {
    if (token.type === "url" && token.href) {
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
      nodes.push(<span key={`token-${index}`} className="deck-inline-ellipsis" title={token.raw}>{token.display}</span>);
    } else {
      nodes.push(<React.Fragment key={`token-${index}`}>{renderTextHighlights(token.raw, terms)}</React.Fragment>);
    }
    index += 1;
  }
  return nodes.length > 0 ? nodes : renderTextHighlights(text, terms);
}

export function getUserLabel(user: MattermostUser | undefined, fallbackId: string): string {
  if (!user) {
    return fallbackId.slice(0, 8);
  }
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (displayName) {
    return displayName;
  }
  return user.nickname?.trim() || `@${user.username}`;
}

export function getUserAvatarUrl(userId: string): string {
  return `/api/v4/users/${encodeURIComponent(userId)}/image`;
}

export function mergePosts(primary: MattermostPost[], secondary: MattermostPost[], limit = 100): MattermostPost[] {
  const deduped = new Map<string, MattermostPost>();
  for (const post of [...primary, ...secondary]) {
    if (!deduped.has(post.id)) {
      deduped.set(post.id, post);
    }
  }
  return [...deduped.values()].sort((left, right) => right.create_at - left.create_at).slice(0, limit);
}
