import type { TeamUnread } from "../mattermost/api";

/** A failed or incomplete scan must never produce a reusable entry. */
export function shouldReuseMentionTeamScan(
  entry: { signature: string; completedAt: number } | undefined,
  signature: string,
  now: number,
  fullScanIntervalMs: number,
  force: boolean,
): boolean {
  return !force && entry !== undefined && entry.signature === signature &&
    Number.isFinite(entry.completedAt) && now >= entry.completedAt &&
    now - entry.completedAt < fullScanIntervalMs;
}

/** Preserve unknown counters so receiving an explicit zero invalidates the scan. */
export function mentionTeamUnreadSignature(unread: TeamUnread | undefined): string | null {
  if (!unread) return null;
  return JSON.stringify([
    unread.mention_count,
    unread.mention_count_root,
    unread.thread_mention_count,
    unread.thread_urgent_mention_count,
    unread.msg_count,
    unread.msg_count_root,
    unread.thread_count,
  ]);
}

export function canSkipEmptyMentionTeamSearch(
  unread: TeamUnread | undefined,
  unreadOnly: boolean,
  hasReview: boolean,
): boolean {
  if (!unreadOnly || hasReview || !unread || unread.mention_count !== 0) return false;
  // Older servers can omit CRT counters. Lack of data is not evidence of an
  // empty team; either an explicit thread mention count or no threads is needed.
  if (unread.thread_mention_count !== 0 && unread.thread_count !== 0) return false;
  return [
    unread.mention_count_root,
    unread.thread_mention_count,
    unread.thread_urgent_mention_count,
  ].every((count) => count === undefined || count === 0);
}
