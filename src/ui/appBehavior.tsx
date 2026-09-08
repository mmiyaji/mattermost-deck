import React from "react";
import type {
  MattermostChannel,
  MattermostPost,
} from "../mattermost/api";
import type { PostedEvent } from "../mattermost/websocket";
import {
  postMatchesImplicitMention,
  type ImplicitMentionSettings,
} from "./mentionFeed";
import { mergePosts } from "./postHelpers";

export function getLoadedPostRefreshLimit(
  nextPage: number,
  pageSize: number,
  maxPosts: number,
): number {
  return Math.min(maxPosts, Math.max(pageSize, nextPage * pageSize));
}

export function appendPostPage(
  currentPosts: MattermostPost[],
  incomingPosts: MattermostPost[],
  pageSize: number,
  maxPosts: number,
): { posts: MattermostPost[]; hasMore: boolean } {
  const posts = mergePosts(currentPosts, incomingPosts, maxPosts);
  return {
    posts,
    hasMore: incomingPosts.length === pageSize && posts.length < maxPosts,
  };
}

export function replacePolledPostWindow(
  latestPosts: MattermostPost[],
  currentPosts: MattermostPost[],
  options: {
    maxPosts: number;
    requestStartedAt?: number;
    deletedPostIds?: ReadonlySet<string>;
  },
): MattermostPost[] {
  const deletedPostIds = options.deletedPostIds;
  const filteredLatest = latestPosts.filter(
    (post) => !deletedPostIds?.has(post.id),
  );
  if (options.requestStartedAt === undefined) {
    return filteredLatest.slice(0, options.maxPosts);
  }

  // The refreshed window is authoritative. Preserve only realtime posts that
  // arrived after the request began so a response race cannot drop them.
  const concurrentPosts = currentPosts.filter(
    (post) =>
      Math.max(post.create_at, post.update_at ?? post.create_at) >=
        (options.requestStartedAt as number) &&
      !deletedPostIds?.has(post.id),
  );
  return mergePosts(concurrentPosts, filteredLatest, options.maxPosts);
}

export function shouldSafeStopDeckState(state: {
  status: "loading" | "ready" | "error";
  userId: string | null;
  sessionExpired: boolean;
}): boolean {
  return (
    state.sessionExpired ||
    (state.status === "error" && !state.userId)
  );
}

export function postedEventNeedsChannelMetadata(
  event: Pick<PostedEvent, "channelType" | "teamId">,
): boolean {
  return (
    !event.channelType ||
    (
      event.channelType !== "D" &&
      event.channelType !== "G" &&
      !event.teamId
    )
  );
}

export function withPostedEventChannelMetadata(
  event: PostedEvent,
  channel: Pick<MattermostChannel, "team_id" | "type">,
): PostedEvent {
  return {
    ...event,
    channelType: event.channelType || channel.type,
    teamId: event.teamId || channel.team_id || undefined,
  };
}

function resolvePostedEventMentionScope(
  event: Pick<PostedEvent, "channelId" | "channelType" | "teamId">,
  columnTeamId: string | undefined,
  channelDirectory: Record<string, MattermostChannel>,
  knownPost: boolean,
): { resolved: boolean; inScope: boolean } {
  if (!columnTeamId || knownPost) {
    return { resolved: true, inScope: true };
  }

  const channel = channelDirectory[event.channelId];
  const channelType = event.channelType || channel?.type;
  if (channelType === "D" || channelType === "G") {
    // Mattermost exposes DMs and GMs in every team-scoped mentions feed.
    return { resolved: true, inScope: true };
  }

  const teamId = event.teamId || channel?.team_id;
  if (teamId) {
    return {
      resolved: true,
      inScope: teamId === columnTeamId,
    };
  }

  if (channel) {
    // A successfully resolved non-DM channel without a team cannot belong to
    // a team-scoped feed.
    return { resolved: true, inScope: false };
  }

  // Keep the event out of the WeakSet until its channel lookup completes.
  // The same event can then be reconsidered when metadata becomes available.
  return { resolved: false, inScope: false };
}

export function takeScopedMentionPostedEvents(
  postedEvents: PostedEvent[],
  processedEvents: WeakSet<PostedEvent>,
  options: {
    columnTeamId: string | undefined;
    channelDirectory: Record<string, MattermostChannel>;
    knownPostIds: ReadonlySet<string>;
  },
): PostedEvent[] {
  const scopedEvents: PostedEvent[] = [];
  for (const event of postedEvents) {
    if (processedEvents.has(event)) {
      continue;
    }

    const scope = resolvePostedEventMentionScope(
      event,
      options.columnTeamId,
      options.channelDirectory,
      options.knownPostIds.has(event.post.id),
    );
    if (!scope.resolved) {
      continue;
    }

    processedEvents.add(event);
    if (scope.inScope) {
      scopedEvents.push(event);
    }
  }
  return scopedEvents;
}

export function postMatchesBoundedImplicitMention(
  post: MattermostPost,
  rootPost: MattermostPost | undefined,
  threadPosts: MattermostPost[],
  settings: ImplicitMentionSettings,
  truncated: boolean,
): boolean {
  if (
    postMatchesImplicitMention(
      post,
      rootPost,
      threadPosts,
      settings,
    )
  ) {
    return true;
  }

  return (
    truncated &&
    settings.commentsNotify === "any" &&
    !settings.collapsedReplyThreads &&
    Boolean(post.root_id) &&
    post.user_id !== settings.currentUserId
  );
}

export function PendingPostMeta(): React.JSX.Element {
  return <span aria-hidden="true">&nbsp;</span>;
}
