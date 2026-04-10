import type { MattermostPost } from "../mattermost/api";

export const POST_GROUPING_MAX_GAP_MS = 5 * 60 * 1000;

function getThreadKey(post: MattermostPost): string {
  return post.root_id?.trim() ? `thread:${post.root_id}` : `channel:${post.channel_id}`;
}

export function shouldGroupAdjacentPosts(
  previousPost: MattermostPost | null | undefined,
  currentPost: MattermostPost,
  maxGapMs = POST_GROUPING_MAX_GAP_MS,
): boolean {
  if (!previousPost) {
    return false;
  }

  if (previousPost.user_id !== currentPost.user_id) {
    return false;
  }

  if (getThreadKey(previousPost) !== getThreadKey(currentPost)) {
    return false;
  }

  return Math.abs(previousPost.create_at - currentPost.create_at) <= maxGapMs;
}
