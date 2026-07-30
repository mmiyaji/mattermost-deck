import type { MattermostPost } from "../mattermost/api";

function indexPostsById(
  posts: readonly MattermostPost[],
): Map<string, MattermostPost> {
  const postsById = new Map<string, MattermostPost>();
  for (const post of posts) {
    postsById.set(post.id, post);
  }
  return postsById;
}

function hasPresentationChanged(
  displayed: MattermostPost,
  refreshed: MattermostPost,
): boolean {
  const displayedFileIds = displayed.file_ids ?? [];
  const refreshedFileIds = refreshed.file_ids ?? [];
  return (
    displayed.user_id !== refreshed.user_id ||
    displayed.channel_id !== refreshed.channel_id ||
    displayed.create_at !== refreshed.create_at ||
    displayed.update_at !== refreshed.update_at ||
    displayed.edit_at !== refreshed.edit_at ||
    displayed.delete_at !== refreshed.delete_at ||
    displayed.message !== refreshed.message ||
    displayed.root_id !== refreshed.root_id ||
    displayed.type !== refreshed.type ||
    displayedFileIds.length !== refreshedFileIds.length ||
    displayedFileIds.some(
      (fileId, index) => fileId !== refreshedFileIds[index],
    )
  );
}

export interface MentionPresentationChangeSummary {
  count: number;
  hasAdditionsOrUpdates: boolean;
}

/**
 * Summarises the rows that would change when a refreshed mentions result
 * replaces the currently displayed result. Each post ID contributes at most
 * one change, whether it was added, removed, or updated. List ordering alone
 * is ignored.
 *
 * `props` is intentionally excluded because compact mention cache snapshots
 * omit it. File IDs are retained in the comparison because hydrating an
 * attachment changes row height and must wait for explicit presentation.
 */
export function summariseMentionPresentationChanges(
  displayedPosts: readonly MattermostPost[],
  refreshedPosts: readonly MattermostPost[],
): MentionPresentationChangeSummary {
  const displayedById = indexPostsById(displayedPosts);
  const refreshedById = indexPostsById(refreshedPosts);
  const postIds = new Set([
    ...displayedById.keys(),
    ...refreshedById.keys(),
  ]);
  let changeCount = 0;
  let hasAdditionsOrUpdates = false;

  for (const postId of postIds) {
    const displayed = displayedById.get(postId);
    const refreshed = refreshedById.get(postId);
    if (
      !displayed ||
      !refreshed ||
      hasPresentationChanged(displayed, refreshed)
    ) {
      changeCount += 1;
      if (refreshed) {
        hasAdditionsOrUpdates = true;
      }
    }
  }

  return {
    count: changeCount,
    hasAdditionsOrUpdates,
  };
}

export function countMentionPresentationChanges(
  displayedPosts: readonly MattermostPost[],
  refreshedPosts: readonly MattermostPost[],
): number {
  return summariseMentionPresentationChanges(
    displayedPosts,
    refreshedPosts,
  ).count;
}
