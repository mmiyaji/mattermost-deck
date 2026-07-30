import { describe, expect, it } from "vitest";
import type {
  MattermostChannelMember,
  MattermostPost,
  MattermostUser,
  MattermostUserThread,
  TeamUnread,
} from "../mattermost/api";
import {
  applyMentionReadMarkers,
  buildMentionReadState,
  buildMentionSearchTerms,
  compactMentionReadState,
  filterActiveMentionPosts,
  filterUnreadMentionPosts,
  getEffectiveTeamMentionCount,
  getMattermostMentionKeys,
  getUnreadPostsFromThread,
  hasMentionRelevantPostChanged,
  invalidateMentionReadMarkers,
  isCollapsedThreadsEnabled,
  mergeMentionReadMarkers,
  mergeMentionReadStates,
  messageMatchesMentionKeys,
  postMatchesMentionCandidate,
  postMatchesImplicitMention,
  postMatchesRealtimeMentionCandidate,
  postMatchesServerMention,
} from "./mentionFeed";

function post(id: string, channelId: string, createAt: number, rootId?: string): MattermostPost {
  return {
    id,
    channel_id: channelId,
    user_id: "author",
    create_at: createAt,
    message: id,
    root_id: rootId,
  };
}

describe("mention feed", () => {
  it("detects edits that can change mention membership", () => {
    const previous = {
      ...post("edited", "channel", 1),
      message: "@alice",
      update_at: 1,
      props: { addedUserId: "alice-id" },
    };
    expect(hasMentionRelevantPostChanged(previous, {
      ...previous,
      message: "mention removed",
      update_at: 2,
    })).toBe(true);
    expect(hasMentionRelevantPostChanged(previous, {
      ...previous,
      props: { addedUserId: "bob-id" },
    })).toBe(true);
    expect(hasMentionRelevantPostChanged(previous, { ...previous })).toBe(false);
  });

  it("resolves all Mattermost collapsed-thread server modes and preference overrides", () => {
    expect(isCollapsedThreadsEnabled("disabled", "on")).toBe(false);
    expect(isCollapsedThreadsEnabled("always_on", "off")).toBe(true);
    expect(isCollapsedThreadsEnabled("default_on", undefined)).toBe(true);
    expect(isCollapsedThreadsEnabled("default_on", "off")).toBe(false);
    expect(isCollapsedThreadsEnabled("default_off", undefined)).toBe(false);
    expect(isCollapsedThreadsEnabled("default_off", "on")).toBe(true);
  });

  it("builds Mattermost-compatible mention terms including custom keys and an exact username", () => {
    const user: MattermostUser = {
      id: "me",
      username: "deck-user",
      first_name: "Deck",
      notify_props: {
        mention_keys: "customer,launch day",
        first_name: "true",
        channel: "true",
      },
    };

    expect(getMattermostMentionKeys(user)).toEqual([
      { key: "customer" },
      { key: "launch day" },
      { key: "Deck", caseSensitive: true },
      { key: "@channel" },
      { key: "@all" },
      { key: "@here" },
      { key: "@deck-user" },
    ]);
    expect(buildMentionSearchTerms(user)).toBe('customer "launch day" Deck @channel @all @here "@deck-user"');
  });

  it("matches custom words, first-name case rules, and exact @mentions", () => {
    const keys = getMattermostMentionKeys({
      id: "me",
      username: "deck",
      first_name: "Minamo",
      notify_props: { mention_keys: "release", first_name: "true", channel: "true" },
    });

    expect(messageMatchesMentionKeys("release is ready", keys)).toBe(true);
    expect(messageMatchesMentionKeys("Hi Minamo", keys)).toBe(true);
    expect(messageMatchesMentionKeys("Hi minamo", keys)).toBe(false);
    expect(messageMatchesMentionKeys("hello @deck", keys)).toBe(true);
    expect(messageMatchesMentionKeys("hello @deck-other", keys)).toBe(false);
  });

  it("omits @channel, @all, and @here when channel-wide notifications are disabled", () => {
    const keys = getMattermostMentionKeys({
      id: "me",
      username: "deck",
      notify_props: {
        mention_keys: "",
        channel: "false",
      },
    });

    expect(messageMatchesMentionKeys("@channel release", keys)).toBe(false);
    expect(messageMatchesMentionKeys("@all release", keys)).toBe(false);
    expect(messageMatchesMentionKeys("@here release", keys)).toBe(false);
    expect(messageMatchesMentionKeys("@deck release", keys)).toBe(true);
  });

  it("includes the user's mentionable group handles", () => {
    const user: MattermostUser = {
      id: "me",
      username: "deck",
      mention_group_names: ["release-team", "@incident.command"],
    };

    expect(getMattermostMentionKeys(user)).toEqual([
      { key: "@release-team" },
      { key: "@incident.command" },
      { key: "@deck" },
    ]);
    expect(buildMentionSearchTerms(user)).toBe(
      '@release-team @incident.command "@deck"',
    );
  });

  it("treats every other-user DM and GM post as a server mention", () => {
    const ordinaryPost = {
      ...post("plain message", "dm-channel", 200),
      message: "plain message without an at-token",
    };
    const selfPost = { ...ordinaryPost, id: "self", user_id: "me" };

    expect(postMatchesServerMention(ordinaryPost, "D", "me", [])).toBe(true);
    expect(postMatchesServerMention(ordinaryPost, "G", "me", [])).toBe(true);
    expect(postMatchesServerMention(selfPost, "D", "me", [])).toBe(false);
    expect(postMatchesServerMention(ordinaryPost, "O", "me", [])).toBe(false);
    expect(postMatchesMentionCandidate(
      ordinaryPost,
      undefined,
      "me",
      [],
      { channelMetadataAvailable: false, serverCountedChannel: true },
    )).toBe(true);
    expect(postMatchesMentionCandidate(
      {
        ...ordinaryPost,
        id: "edited-plain-message",
        message: "edited plain DM/GM message",
        update_at: 300,
      },
      undefined,
      "me",
      [],
      { channelMetadataAvailable: false, serverCountedChannel: true },
    )).toBe(true);
    expect(postMatchesMentionCandidate(
      ordinaryPost,
      undefined,
      "me",
      [],
      { channelMetadataAvailable: false, serverCountedChannel: false },
    )).toBe(false);
  });

  it("preserves posted and edited DM/GM mentions when channel_type is absent", () => {
    const plainDmPost = {
      ...post("plain-dm-posted", "dm-channel", 200),
      message: "plain direct message",
    };
    const plainDmEdit = {
      ...plainDmPost,
      id: "plain-dm-edited",
      message: "edited plain direct message",
      update_at: 300,
    };

    for (const realtimePost of [plainDmPost, plainDmEdit]) {
      expect(postMatchesRealtimeMentionCandidate(
        realtimePost,
        undefined,
        "me",
        [],
        true,
        false,
      )).toBe(true);
    }
    expect(postMatchesRealtimeMentionCandidate(
      { ...plainDmPost, id: "known-gm" },
      "G",
      "me",
      [],
      false,
      false,
    )).toBe(true);
    expect(postMatchesRealtimeMentionCandidate(
      { ...plainDmPost, id: "disabled-special", message: "@channel" },
      undefined,
      "me",
      [],
      true,
      false,
    )).toBe(false);
  });

  it("matches non-CRT root and participant reply notifications without an @-token", () => {
    const root = { ...post("root", "channel", 100), user_id: "me" };
    const firstReply = {
      ...post("first-reply", "channel", 200, "root"),
      message: "plain reply",
      user_id: "other",
    };
    const myReply = {
      ...post("my-reply", "channel", 250, "root"),
      user_id: "me",
    };
    const laterReply = {
      ...post("later-reply", "channel", 300, "root"),
      message: "another plain reply",
      user_id: "other",
    };

    expect(postMatchesImplicitMention(
      firstReply,
      root,
      [root, firstReply],
      {
        currentUserId: "me",
        collapsedReplyThreads: false,
        commentsNotify: "root",
      },
    )).toBe(true);
    expect(postMatchesImplicitMention(
      laterReply,
      { ...root, user_id: "root-author" },
      [myReply, laterReply],
      {
        currentUserId: "me",
        collapsedReplyThreads: false,
        commentsNotify: "any",
      },
    )).toBe(true);
    expect(postMatchesImplicitMention(
      laterReply,
      root,
      [root, laterReply],
      {
        currentUserId: "me",
        collapsedReplyThreads: true,
        commentsNotify: "any",
      },
    )).toBe(false);
  });

  it("matches the system post that adds the current user to a channel", () => {
    expect(postMatchesImplicitMention(
      {
        ...post("join", "channel", 100),
        type: "system_add_to_channel",
        props: { addedUserId: "me" },
      },
      undefined,
      [],
      {
        currentUserId: "me",
        collapsedReplyThreads: true,
        commentsNotify: "never",
      },
    )).toBe(true);
  });

  it("filters each channel by its own read marker instead of slicing the newest N results", () => {
    const members: MattermostChannelMember[] = [
      { channel_id: "channel-a", user_id: "me", last_viewed_at: 300 },
      { channel_id: "channel-b", user_id: "me", last_viewed_at: 100 },
    ];
    const newestButRead = post("read-a", "channel-a", 250);
    const olderButUnreadReply = post("unread-b", "channel-b", 200, "root-b");

    expect(filterUnreadMentionPosts(
      [newestButRead, olderButUnreadReply],
      buildMentionReadState(members, []),
    ).map(({ id }) => id)).toEqual(["unread-b"]);
  });

  it("hides posts from channels that are no longer active without hiding on metadata failure", () => {
    const activePost = post("active-post", "active-channel", 200);
    const removedPost = post("removed-post", "removed-channel", 300);

    expect(filterActiveMentionPosts(
      [activePost, removedPost],
      buildMentionReadState([], [], ["active-channel"]),
    ).map(({ id }) => id)).toEqual(["active-post"]);
    expect(filterActiveMentionPosts(
      [activePost, removedPost],
      buildMentionReadState([], []),
    ).map(({ id }) => id)).toEqual(["active-post", "removed-post"]);
  });

  it("reuses a shared active-channel directory across team read states", () => {
    const activeChannelIds = {
      "channel-a": true,
      "channel-b": true,
    } as const;
    const first = buildMentionReadState(
      [{ channel_id: "channel-a", user_id: "me", last_viewed_at: 100 }],
      [],
      activeChannelIds,
    );
    const second = buildMentionReadState(
      [{ channel_id: "channel-b", user_id: "me", last_viewed_at: 200 }],
      [],
      activeChannelIds,
    );
    const merged = mergeMentionReadStates([first, second]);

    expect(first.activeChannelIds).toBe(activeChannelIds);
    expect(second.activeChannelIds).toBe(activeChannelIds);
    expect(merged.activeChannelIds).toBe(activeChannelIds);
  });

  it("compacts read markers to the posts retained by the feed", () => {
    const readState = {
      channelLastViewedAt: {
        "channel-a": 100,
        "channel-b": 200,
        "channel-c": 300,
      },
      threadLastViewedAt: {
        "root-a": 110,
        "root-b": 220,
      },
      activeChannelIds: {
        "channel-a": true,
        "channel-b": true,
        "channel-c": true,
      } as Record<string, true>,
    };
    const retainedPosts = [
      post("root-a", "channel-a", 120),
      post("reply-b", "channel-b", 230, "root-b"),
    ];
    const compacted = compactMentionReadState(
      readState,
      retainedPosts,
    );

    expect(compacted).toEqual({
      channelLastViewedAt: {
        "channel-a": 100,
        "channel-b": 200,
      },
      threadLastViewedAt: { "root-b": 220 },
      activeChannelIds: {
        "channel-a": true,
        "channel-b": true,
      },
    });

    const runtimeCompacted = compactMentionReadState(
      readState,
      retainedPosts,
      { preserveActiveChannelIds: true },
    );
    expect(runtimeCompacted.channelLastViewedAt).toEqual(
      compacted.channelLastViewedAt,
    );
    expect(runtimeCompacted.threadLastViewedAt).toEqual(
      compacted.threadLastViewedAt,
    );
    expect(runtimeCompacted.activeChannelIds).toBe(
      readState.activeChannelIds,
    );
  });

  it("uses the thread read marker for replies when collapsed threads are available", () => {
    const members: MattermostChannelMember[] = [
      { channel_id: "channel-b", user_id: "me", last_viewed_at: 500 },
    ];
    const threads: MattermostUserThread[] = [{
      id: "root-b",
      reply_count: 2,
      last_reply_at: 400,
      last_viewed_at: 250,
      post: post("root-b", "channel-b", 100),
      unread_replies: 1,
      unread_mentions: 1,
    }];

    expect(filterUnreadMentionPosts(
      [post("reply-b", "channel-b", 300, "root-b")],
      buildMentionReadState(members, threads),
    ).map(({ id }) => id)).toEqual(["reply-b"]);

    expect(filterUnreadMentionPosts(
      [post("reply-b", "channel-b", 300, "root-b")],
      buildMentionReadState(
        [{ channel_id: "channel-b", user_id: "me", last_viewed_at: 100 }],
        [{ ...threads[0], last_viewed_at: 350, unread_replies: 0, unread_mentions: 0 }],
      ),
    )).toEqual([]);
  });

  it("applies realtime read markers monotonically without changing channel membership", () => {
    const state = buildMentionReadState(
      [
        { channel_id: "channel-a", user_id: "me", last_viewed_at: 300 },
        { channel_id: "channel-b", user_id: "me", last_viewed_at: 200 },
      ],
      [{
        id: "root-a",
        reply_count: 1,
        last_reply_at: 300,
        last_viewed_at: 250,
        post: post("root-a", "channel-a", 100),
        unread_replies: 1,
        unread_mentions: 1,
      }],
      ["channel-a", "channel-b"],
    );
    const markers = mergeMentionReadMarkers(
      {
        channelLastViewedAt: { "channel-a": 350 },
        threadLastViewedAt: {},
      },
      {
        channelLastViewedAt: {
          "channel-a": 325,
          "channel-b": 450,
        },
        threadLastViewedAt: { "root-a": 500 },
      },
    );

    expect(applyMentionReadMarkers(state, markers)).toEqual({
      channelLastViewedAt: {
        "channel-a": 350,
        "channel-b": 450,
      },
      threadLastViewedAt: { "root-a": 500 },
      activeChannelIds: {
        "channel-a": true,
        "channel-b": true,
      },
    });
  });

  it("invalidates only the read markers named by a post-unread event", () => {
    const current = {
      channelLastViewedAt: {
        "channel-a": 300,
        "channel-b": 400,
      },
      threadLastViewedAt: {
        "root-a": 500,
        "root-b": 600,
      },
    };

    expect(invalidateMentionReadMarkers(current, {
      channelIds: ["channel-a"],
      threadIds: [],
    })).toEqual({
      channelLastViewedAt: { "channel-b": 400 },
      threadLastViewedAt: {
        "root-a": 500,
        "root-b": 600,
      },
    });

    expect(invalidateMentionReadMarkers(current, {
      channelIds: [],
      threadIds: ["root-b"],
    })).toEqual({
      channelLastViewedAt: {
        "channel-a": 300,
        "channel-b": 400,
      },
      threadLastViewedAt: { "root-a": 500 },
    });
  });

  it("uses collapsed-thread mention totals without double counting channel replies", () => {
    const unread: TeamUnread = {
      team_id: "team",
      msg_count: 4,
      mention_count: 5,
      mention_count_root: 1,
      thread_count: 2,
      thread_mention_count: 2,
    };
    expect(getEffectiveTeamMentionCount(unread, false)).toBe(5);
    expect(getEffectiveTeamMentionCount(unread, true)).toBe(3);
    expect(getEffectiveTeamMentionCount({
      ...unread,
      mention_count_root: 0,
      thread_mention_count: 0,
    }, true)).toBe(0);
  });

  it("collects every unread reply from a server-reported mention thread", () => {
    const thread: MattermostUserThread = {
      id: "root",
      reply_count: 3,
      last_reply_at: 400,
      last_viewed_at: 150,
      post: post("root", "channel", 100),
      unread_replies: 2,
      unread_mentions: 1,
    };
    const posts = [
      thread.post,
      { ...post("old", "channel", 140, "root"), user_id: "other" },
      { ...post("self", "channel", 200, "root"), user_id: "me" },
      { ...post("new-one", "channel", 250, "root"), user_id: "other" },
      { ...post("new-two", "channel", 300, "root"), user_id: "other" },
    ];

    expect(getUnreadPostsFromThread(thread, posts, "me").map(({ id }) => id)).toEqual([
      "new-one",
      "new-two",
    ]);
    expect(
      getUnreadPostsFromThread(
        thread,
        [
          { ...posts[3], message: "@alice first" },
          { ...posts[4], message: "ordinary reply" },
        ],
        "me",
        [{ key: "@alice" }],
      ).map(({ id }) => id),
    ).toEqual(["new-one"]);
    expect(
      getUnreadPostsFromThread(
        thread,
        [{ ...posts[4], message: "plain direct-message reply" }],
        "me",
        [{ key: "@alice" }],
        "D",
      ).map(({ id }) => id),
    ).toEqual(["new-two"]);
  });
});
