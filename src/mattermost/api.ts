export interface MattermostUser {
  id: string;
  username: string;
}

export interface MattermostTeam {
  id: string;
  name: string;
  display_name: string;
}

export interface MattermostChannel {
  id: string;
  name: string;
  display_name: string;
  type: string;
}

export interface MattermostPost {
  id: string;
  user_id: string;
  channel_id: string;
  create_at: number;
  message: string;
}

interface MattermostPostList {
  order: string[];
  posts: Record<string, MattermostPost>;
}

export interface TeamUnread {
  team_id: string;
  msg_count: number;
  mention_count: number;
}

export interface CurrentRoute {
  teamName: string | null;
  channelName: string | null;
}

async function apiGet<T>(pathname: string): Promise<T> {
  const response = await fetch(`/api/v4${pathname}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`GET ${pathname} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function readCurrentRoute(): CurrentRoute {
  const path = window.location.pathname.split("/").filter(Boolean);
  if (path.length < 3) {
    return {
      teamName: null,
      channelName: null,
    };
  }

  return {
    teamName: path[0] ?? null,
    channelName: path[2] ?? null,
  };
}

export async function getCurrentUser(): Promise<MattermostUser> {
  return await apiGet<MattermostUser>("/users/me");
}

export async function getTeamsForCurrentUser(): Promise<MattermostTeam[]> {
  return await apiGet<MattermostTeam[]>("/users/me/teams");
}

export async function getTeamByName(teamName: string): Promise<MattermostTeam> {
  return await apiGet<MattermostTeam>(`/teams/name/${teamName}`);
}

export async function getChannelsForCurrentUser(teamId: string): Promise<MattermostChannel[]> {
  return await apiGet<MattermostChannel[]>(`/users/me/teams/${teamId}/channels`);
}

export async function getChannelByName(
  teamId: string,
  channelName: string,
): Promise<MattermostChannel> {
  return await apiGet<MattermostChannel>(`/teams/${teamId}/channels/name/${channelName}`);
}

export async function getRecentPosts(channelId: string, perPage = 15): Promise<MattermostPost[]> {
  const payload = await apiGet<MattermostPostList>(
    `/channels/${channelId}/posts?page=0&per_page=${perPage}`,
  );

  return payload.order
    .map((postId) => payload.posts[postId])
    .filter((post): post is MattermostPost => Boolean(post));
}

export async function getTeamUnread(userId: string): Promise<TeamUnread[]> {
  return await apiGet<TeamUnread[]>(`/users/${userId}/teams/unread`);
}
