import type {
  MattermostChannelMember,
  MattermostPost,
  MattermostUser,
  MattermostUserThread,
  TeamUnread,
} from "../mattermost/api";
import { hasSpecialMattermostMention } from "../mattermost/mentions";

export interface MattermostMentionKey {
  key: string;
  caseSensitive?: boolean;
}

export interface MentionReadState {
  channelLastViewedAt: Record<string, number>;
  threadLastViewedAt: Record<string, number>;
  activeChannelIds: Record<string, true> | null;
}

export type MentionReadMarkers = Pick<
  MentionReadState,
  "channelLastViewedAt" | "threadLastViewedAt"
>;

export interface ImplicitMentionSettings {
  currentUserId: string;
  collapsedReplyThreads: boolean;
  commentsNotify: string | undefined;
}

export function isCollapsedThreadsEnabled(
  serverMode: string | undefined,
  preferenceValue: string | undefined,
): boolean {
  switch (serverMode) {
    case "disabled":
      return false;
    case "always_on":
      return true;
    case "default_on":
      return preferenceValue !== "off";
    case "default_off":
      return preferenceValue === "on";
    default:
      return preferenceValue === "on";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteSearchTerm(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function getMattermostMentionKeys(user: MattermostUser): MattermostMentionKey[] {
  const keys: MattermostMentionKey[] = [];
  const configuredKeys = user.notify_props?.mention_keys
    ?.split(",")
    .map((key) => key.trim())
    .filter(Boolean) ?? [];

  for (const key of configuredKeys) {
    keys.push({ key });
  }

  if (user.notify_props?.first_name === "true" && user.first_name?.trim()) {
    keys.push({ key: user.first_name.trim(), caseSensitive: true });
  }

  if (user.notify_props?.channel === "true") {
    keys.push({ key: "@channel" }, { key: "@all" }, { key: "@here" });
  }

  for (const groupName of user.mention_group_names ?? []) {
    const trimmedName = groupName.trim().replace(/^@/, "");
    if (trimmedName) {
      keys.push({ key: `@${trimmedName}` });
    }
  }

  const usernameKey = `@${user.username}`;
  if (!keys.some(({ key }) => key.toLocaleLowerCase() === usernameKey.toLocaleLowerCase())) {
    keys.push({ key: usernameKey });
  }

  const seen = new Set<string>();
  return keys.filter(({ key, caseSensitive }) => {
    const normalized = `${caseSensitive ? "1" : "0"}:${caseSensitive ? key : key.toLocaleLowerCase()}`;
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

export function buildMentionSearchTerms(user: MattermostUser): string {
  const usernameKey = `@${user.username}`.toLocaleLowerCase();
  return getMattermostMentionKeys(user)
    .map(({ key }) => {
      if (key.toLocaleLowerCase() === usernameKey || /\s/.test(key)) {
        return quoteSearchTerm(key);
      }
      return key;
    })
    .join(" ");
}

export function messageMatchesMentionKeys(message: string, keys: MattermostMentionKey[]): boolean {
  return keys.some(({ key, caseSensitive }) => {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      return false;
    }

    const flags = caseSensitive ? "" : "i";
    if (trimmedKey.startsWith("@")) {
      return new RegExp(`(^|[^a-z0-9._-])${escapeRegExp(trimmedKey)}(?![a-z0-9._-])`, flags).test(message);
    }

    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(trimmedKey)}(?![\\p{L}\\p{N}_])`, `${flags}u`).test(message);
  });
}

export function hasMentionRelevantPostChanged(
  previous: MattermostPost,
  current: MattermostPost,
): boolean {
  return previous.message !== current.message ||
    previous.type !== current.type ||
    previous.root_id !== current.root_id ||
    previous.update_at !== current.update_at ||
    previous.edit_at !== current.edit_at ||
    previous.delete_at !== current.delete_at ||
    JSON.stringify(previous.props ?? {}) !== JSON.stringify(current.props ?? {});
}

export function postMatchesServerMention(
  post: MattermostPost,
  channelType: string | undefined,
  currentUserId: string,
  mentionKeys: MattermostMentionKey[],
): boolean {
  if (channelType === "D" || channelType === "G") {
    // Mattermost treats every post from another user in a DM or GM as a
    // mention, even when the message contains no @-token.
    return post.user_id !== currentUserId;
  }

  return messageMatchesMentionKeys(post.message, mentionKeys);
}

export function postMatchesMentionCandidate(
  post: MattermostPost,
  channelType: string | undefined,
  currentUserId: string,
  mentionKeys: MattermostMentionKey[],
  options: {
    channelMetadataAvailable: boolean;
    serverCountedChannel: boolean;
  },
): boolean {
  if (!options.channelMetadataAvailable && options.serverCountedChannel) {
    return post.user_id !== currentUserId;
  }
  return postMatchesServerMention(
    post,
    channelType,
    currentUserId,
    mentionKeys,
  );
}

export function postMatchesRealtimeMentionCandidate(
  post: MattermostPost,
  channelType: string | undefined,
  currentUserId: string,
  mentionKeys: MattermostMentionKey[],
  serverMentionsUser: boolean,
  channelWideMentionsEnabled: boolean,
): boolean {
  const isDisabledChannelWideMention =
    !channelWideMentionsEnabled &&
    hasSpecialMattermostMention(post.message);
  const usableServerMention =
    serverMentionsUser && !isDisabledChannelWideMention;

  return (
    postMatchesMentionCandidate(
      post,
      channelType,
      currentUserId,
      mentionKeys,
      {
        channelMetadataAvailable: Boolean(channelType),
        serverCountedChannel: usableServerMention,
      },
    ) ||
    usableServerMention
  );
}

export function postMatchesImplicitMention(
  post: MattermostPost,
  rootPost: MattermostPost | undefined,
  threadPosts: MattermostPost[],
  settings: ImplicitMentionSettings,
): boolean {
  if (
    post.type === "system_add_to_channel" &&
    post.props?.addedUserId === settings.currentUserId
  ) {
    return true;
  }

  if (
    settings.collapsedReplyThreads ||
    !post.root_id ||
    post.user_id === settings.currentUserId
  ) {
    return false;
  }

  const commentsNotify = settings.commentsNotify;
  if (commentsNotify !== "root" && commentsNotify !== "any") {
    return false;
  }

  if (
    rootPost?.id === post.root_id &&
    rootPost.user_id === settings.currentUserId
  ) {
    return true;
  }

  return commentsNotify === "any" && threadPosts.some(
    (threadPost) =>
      threadPost.user_id === settings.currentUserId &&
      threadPost.create_at < post.create_at,
  );
}

export function buildMentionReadState(
  members: MattermostChannelMember[],
  threads: MattermostUserThread[],
  activeChannelIds: string[] | Record<string, true> | null = null,
): MentionReadState {
  return {
    channelLastViewedAt: Object.fromEntries(
      members.map((member) => [member.channel_id, Math.max(0, member.last_viewed_at ?? 0)]),
    ),
    threadLastViewedAt: Object.fromEntries(
      threads.map((thread) => [thread.id, Math.max(0, thread.last_viewed_at ?? 0)]),
    ),
    activeChannelIds:
      activeChannelIds === null
        ? null
        : Array.isArray(activeChannelIds)
          ? Object.fromEntries(
              activeChannelIds.map((channelId) => [channelId, true]),
            )
          : activeChannelIds,
  };
}

export function mergeMentionReadStates(states: MentionReadState[]): MentionReadState {
  const channelLastViewedAt: Record<string, number> = {};
  const threadLastViewedAt: Record<string, number> = {};
  let activeChannelIds: Record<string, true> | null = null;

  for (const state of states) {
    Object.assign(channelLastViewedAt, state.channelLastViewedAt);
    Object.assign(threadLastViewedAt, state.threadLastViewedAt);
    if (state.activeChannelIds !== null) {
      // Each mention scan obtains one server-wide active-channel snapshot.
      // A later known snapshot supersedes an older one; unioning snapshots
      // would retain channels that the user has since left.
      activeChannelIds = state.activeChannelIds;
    }
  }

  return {
    channelLastViewedAt,
    threadLastViewedAt,
    activeChannelIds,
  };
}

export function compactMentionReadState(
  readState: MentionReadState,
  posts: MattermostPost[],
  options: { preserveActiveChannelIds?: boolean } = {},
): MentionReadState {
  const channelIds = new Set(posts.map((post) => post.channel_id));
  const threadIds = new Set(
    posts
      .map((post) => post.root_id)
      .filter((rootId): rootId is string => Boolean(rootId)),
  );

  return {
    channelLastViewedAt: Object.fromEntries(
      [...channelIds].flatMap((channelId) => {
        const viewedAt = readState.channelLastViewedAt[channelId];
        return viewedAt === undefined ? [] : [[channelId, viewedAt]];
      }),
    ),
    threadLastViewedAt: Object.fromEntries(
      [...threadIds].flatMap((threadId) => {
        const viewedAt = readState.threadLastViewedAt[threadId];
        return viewedAt === undefined ? [] : [[threadId, viewedAt]];
      }),
    ),
    activeChannelIds:
      readState.activeChannelIds === null
        ? null
        : options.preserveActiveChannelIds
          ? readState.activeChannelIds
          : Object.fromEntries(
              [...channelIds]
                .filter(
                  (channelId) =>
                    readState.activeChannelIds?.[channelId] === true,
                )
                .map((channelId) => [channelId, true] as const),
            ),
  };
}

function mergeViewedAtMaps(
  current: Record<string, number>,
  incoming: Record<string, number>,
): Record<string, number> {
  const merged = { ...current };
  for (const [id, viewedAt] of Object.entries(incoming)) {
    merged[id] = Math.max(merged[id] ?? 0, viewedAt);
  }
  return merged;
}

export function mergeMentionReadMarkers(
  current: MentionReadMarkers,
  incoming: MentionReadMarkers,
): MentionReadMarkers {
  return {
    channelLastViewedAt: mergeViewedAtMaps(
      current.channelLastViewedAt,
      incoming.channelLastViewedAt,
    ),
    threadLastViewedAt: mergeViewedAtMaps(
      current.threadLastViewedAt,
      incoming.threadLastViewedAt,
    ),
  };
}

function omitViewedAtMarkers(
  current: Record<string, number>,
  affectedIds: string[],
): Record<string, number> {
  if (affectedIds.length === 0) {
    return current;
  }

  const affected = new Set(affectedIds);
  return Object.fromEntries(
    Object.entries(current).filter(([id]) => !affected.has(id)),
  );
}

export function invalidateMentionReadMarkers(
  current: MentionReadMarkers,
  affected: {
    channelIds: string[];
    threadIds: string[];
  },
): MentionReadMarkers {
  return {
    channelLastViewedAt: omitViewedAtMarkers(
      current.channelLastViewedAt,
      affected.channelIds,
    ),
    threadLastViewedAt: omitViewedAtMarkers(
      current.threadLastViewedAt,
      affected.threadIds,
    ),
  };
}

export function applyMentionReadMarkers(
  state: MentionReadState,
  markers: MentionReadMarkers,
): MentionReadState {
  return {
    ...state,
    ...mergeMentionReadMarkers(state, markers),
  };
}

export function filterActiveMentionPosts(
  posts: MattermostPost[],
  readState: MentionReadState,
): MattermostPost[] {
  if (readState.activeChannelIds === null) {
    return posts;
  }
  return posts.filter((post) => readState.activeChannelIds?.[post.channel_id] === true);
}

export function isMentionPostUnread(post: MattermostPost, readState: MentionReadState): boolean {
  if (
    readState.activeChannelIds !== null &&
    readState.activeChannelIds[post.channel_id] !== true
  ) {
    return false;
  }
  if (post.root_id) {
    const threadLastViewedAt = readState.threadLastViewedAt[post.root_id];
    if (threadLastViewedAt !== undefined) {
      return post.create_at > threadLastViewedAt;
    }
  }

  const channelLastViewedAt = readState.channelLastViewedAt[post.channel_id];
  if (channelLastViewedAt === undefined) {
    // Missing membership data must not hide a post. This is the conservative
    // fallback for older Mattermost versions and transient API failures.
    return true;
  }
  return post.create_at > channelLastViewedAt;
}

export function filterUnreadMentionPosts(posts: MattermostPost[], readState: MentionReadState): MattermostPost[] {
  return posts.filter((post) => isMentionPostUnread(post, readState));
}

export function getEffectiveTeamMentionCount(
  unread: TeamUnread,
  collapsedReplyThreads: boolean,
): number {
  const channelCount = Math.max(0, unread.mention_count ?? 0);
  const collapsedThreadCount =
    Math.max(0, unread.mention_count_root ?? 0) +
    Math.max(0, unread.thread_mention_count ?? 0);

  return collapsedReplyThreads ? collapsedThreadCount : channelCount;
}

export function getUnreadPostsFromThread(
  thread: MattermostUserThread,
  posts: MattermostPost[],
  currentUserId: string,
  mentionKeys?: MattermostMentionKey[],
  channelType?: string,
): MattermostPost[] {
  const lastViewedAt = Math.max(0, thread.last_viewed_at ?? 0);
  return posts.filter(
    (post) =>
      Boolean(post.root_id) &&
      post.root_id === thread.id &&
      post.user_id !== currentUserId &&
      post.create_at > lastViewedAt &&
      (!mentionKeys ||
        postMatchesServerMention(post, channelType, currentUserId, mentionKeys)),
  );
}
