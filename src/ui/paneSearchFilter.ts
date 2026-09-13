import type { MattermostPost, MattermostUser } from "../mattermost/api";

export function normalizePaneQuery(value: string): string {
  return value.normalize("NFC").toLowerCase().trim();
}

export function indexPanePosts(posts: MattermostPost[], users: Record<string, MattermostUser>): string[] {
  return posts.map(post => {
    const user = users[post.user_id];
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ");
    return normalizePaneQuery([post.message, user?.username ? `@${user.username}` : "", name, user?.nickname].filter(Boolean).join("\n"));
  });
}

export function filterPanePosts(posts: MattermostPost[], index: string[], query: string): MattermostPost[] {
  const normalized = normalizePaneQuery(query);
  return normalized ? posts.filter((_, i) => index[i]?.includes(normalized)) : posts;
}
