import type { MattermostPost } from "../mattermost/api";

export interface PostState {
  status: "idle" | "loading" | "ready" | "error";
  posts: MattermostPost[];
  error: string | null;
  nextPage: number;
  hasMore: boolean;
  loadingMore: boolean;
}

export function reuseUnchangedPosts(
  current: MattermostPost[],
  incoming: MattermostPost[],
): MattermostPost[] {
  if (current === incoming) return current;
  if (current.length !== incoming.length) return incoming;
  // Posts are JSON API payloads. Compare the complete payload, not just id or
  // update_at: reactions, files, props, and other metadata may change as well.
  // A different object key order merely misses the optimization; it cannot
  // hide an update. Keep the comparison bounded by the existing pane buffer.
  return current.every((post, index) => post === incoming[index] ||
    JSON.stringify(post) === JSON.stringify(incoming[index])) ? current : incoming;
}

export function reuseUnchangedPostState(current: PostState, incoming: PostState): PostState {
  const posts = reuseUnchangedPosts(current.posts, incoming.posts);
  if (
    posts === current.posts && current.status === incoming.status &&
    current.error === incoming.error && current.nextPage === incoming.nextPage &&
    current.hasMore === incoming.hasMore && current.loadingMore === incoming.loadingMore
  ) return current;
  return posts === incoming.posts ? incoming : { ...incoming, posts };
}
