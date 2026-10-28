import type { MattermostChannel, MattermostChannelMember } from "../mattermost/api";

/**
 * A channel stays a special-mention candidate for as long as its mentions sit
 * unread, so a deck that leaves them unread rescans the same channels on every
 * poll and pages the same posts back. The signature covers everything that can
 * change the outcome of a scan: the channel's newest post, the member's read
 * position and unread counters, and the mention rules themselves. While it
 * holds, a rescan can only find what the last one found, so it can be skipped.
 *
 * Skipping a scan must not republish what it found. A deleted post leaves every
 * signal here untouched, and the feed detects a deletion precisely by a held
 * post dropping out of the newest scan, so replaying one would keep it alive
 * forever. Omitting it instead costs a single batched lookup by id.
 */
export function mentionScanSignature(
  member: MattermostChannelMember,
  channel: MattermostChannel,
  filterSignature: string,
): string {
  return [
    filterSignature,
    channel.type,
    channel.last_post_at ?? 0,
    member.last_viewed_at ?? 0,
    member.msg_count ?? 0,
    member.mention_count ?? 0,
    member.mention_count_root ?? 0,
  ].join("|");
}

export function rememberMentionScan(
  cache: Map<string, string>,
  channelId: string,
  signature: string,
  maxChannels: number,
): void {
  // Re-inserting keeps the map in least-recently-scanned order for eviction.
  cache.delete(channelId);
  cache.set(channelId, signature);
  while (cache.size > Math.max(1, maxChannels)) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      break;
    }
    cache.delete(oldest.value);
  }
}
