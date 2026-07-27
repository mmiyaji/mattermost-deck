import { describe, expect, it } from "vitest";
import {
  appendPostedEvent,
  getDeletedPostId,
  hasMentionForDeck,
  isChannelReadStateEvent,
  isMentionMetadataEvent,
  isUnreadStateEvent,
  mentionsPayloadIncludesUser,
  parseUnreadStateChange,
  parsePostedEvent,
  resolvePostedEventTeamId,
  type PostedEvent,
} from "./websocket";

describe("mentionsPayloadIncludesUser", () => {
  it("matches exact user IDs from a serialized mentions payload", () => {
    expect(mentionsPayloadIncludesUser('["userida123","useridb456"]', "userida123")).toBe(true);
    expect(mentionsPayloadIncludesUser("userida123 useridb456", "useridb456")).toBe(true);
  });

  it("does not match partial usernames", () => {
    expect(mentionsPayloadIncludesUser('["joann"]', "ann")).toBe(false);
    expect(mentionsPayloadIncludesUser("joann", "ann")).toBe(false);
  });

  it("returns false for empty user IDs", () => {
    expect(mentionsPayloadIncludesUser('["alice"]', null)).toBe(false);
    expect(mentionsPayloadIncludesUser('["alice"]', "")).toBe(false);
  });
});

describe("hasMentionForDeck", () => {
  it("uses Mattermost username boundaries", () => {
    expect(hasMentionForDeck("hello @alice", "alice")).toBe(true);
    expect(hasMentionForDeck("hello @alice.smith", "alice")).toBe(false);
    expect(hasMentionForDeck("hello @here-bot", "alice")).toBe(false);
    expect(hasMentionForDeck("hello @alice-", "alice-")).toBe(true);
  });
});

describe("isUnreadStateEvent", () => {
  it("refreshes channel and thread read-state events", () => {
    expect(isUnreadStateEvent("multiple_channels_viewed")).toBe(true);
    expect(isUnreadStateEvent("channel_viewed")).toBe(true);
    expect(isUnreadStateEvent("thread_read_changed")).toBe(true);
    expect(isUnreadStateEvent("post_unread")).toBe(true);
    expect(isUnreadStateEvent("channel_deleted")).toBe(true);
    expect(isUnreadStateEvent("user_removed")).toBe(true);
    expect(isUnreadStateEvent("posted")).toBe(false);
  });

  it("parses bulk channel timestamps without requiring an API refresh", () => {
    expect(parseUnreadStateChange(
      "multiple_channels_viewed",
      {
        channel_times: {
          "channel-a": 1_234,
          "channel-b": "5678",
          invalid: "not-a-number",
        },
      },
    )).toEqual({
      eventType: "multiple_channels_viewed",
      channelLastViewedAt: {
        "channel-a": 1_234,
        "channel-b": 5_678,
      },
      threadLastViewedAt: {},
      channelIds: ["channel-a", "channel-b"],
      threadIds: [],
    });
  });

  it("classifies empty channel-read events separately from structural changes", () => {
    expect(isChannelReadStateEvent("channel_viewed")).toBe(true);
    expect(isChannelReadStateEvent("multiple_channels_viewed")).toBe(true);
    expect(isChannelReadStateEvent("thread_read_changed")).toBe(false);
    expect(isChannelReadStateEvent("channel_deleted")).toBe(false);
  });

  it("accepts serialized bulk timestamps and legacy channel payloads", () => {
    expect(parseUnreadStateChange(
      "multiple_channels_viewed",
      { channel_times: JSON.stringify({ "channel-a": 1_234 }) },
    ).channelLastViewedAt).toEqual({ "channel-a": 1_234 });

    expect(parseUnreadStateChange(
      "channel_viewed",
      { channel_id: "channel-b", last_viewed_at: 5_678 },
    )).toMatchObject({
      channelLastViewedAt: { "channel-b": 5_678 },
      channelIds: ["channel-b"],
    });
  });

  it("parses thread markers and retains affected IDs when a timestamp is absent", () => {
    expect(parseUnreadStateChange(
      "thread_read_changed",
      {
        thread: JSON.stringify({
          id: "thread-a",
          last_viewed_at: 9_999,
        }),
      },
    )).toMatchObject({
      threadLastViewedAt: { "thread-a": 9_999 },
      threadIds: ["thread-a"],
    });

    expect(parseUnreadStateChange(
      "channel_viewed",
      {},
      { channel_id: "legacy-channel" },
    )).toMatchObject({
      channelLastViewedAt: {},
      channelIds: ["legacy-channel"],
    });
  });
});

describe("getDeletedPostId", () => {
  it("reads deleted post IDs from both supported event payload shapes", () => {
    expect(getDeletedPostId(
      "post_deleted",
      JSON.stringify({ id: "post-from-json" }),
    )).toBe("post-from-json");
    expect(getDeletedPostId(
      "post_deleted",
      undefined,
      "post-from-field",
    )).toBe("post-from-field");
    expect(getDeletedPostId("posted", JSON.stringify({ id: "ignored" }))).toBeNull();
    expect(getDeletedPostId("post_deleted", "{bad-json")).toBeNull();
  });
});

describe("isMentionMetadataEvent", () => {
  it("refreshes only current-user mention and CRT preference changes", () => {
    expect(isMentionMetadataEvent(
      "preferences_changed",
      {
        preferences: JSON.stringify([{
          user_id: "alice-id",
          category: "display_settings",
          name: "collapsed_reply_threads",
        }]),
      },
      "alice-id",
    )).toBe(true);
    expect(isMentionMetadataEvent(
      "preferences_changed",
      {
        preferences: JSON.stringify([{
          user_id: "alice-id",
          category: "display_settings",
          name: "theme",
        }]),
      },
      "alice-id",
    )).toBe(false);
    expect(isMentionMetadataEvent(
      "preferences_deleted",
      undefined,
      "alice-id",
      "alice-id",
    )).toBe(true);
    expect(isMentionMetadataEvent(
      "user_updated",
      { user: JSON.stringify({ id: "alice-id" }) },
      "alice-id",
    )).toBe(true);
    expect(isMentionMetadataEvent(
      "user_updated",
      { user: JSON.stringify({ id: "bob-id" }) },
      "alice-id",
    )).toBe(false);
    expect(isMentionMetadataEvent("config_changed")).toBe(true);
    expect(isMentionMetadataEvent("group_member_add")).toBe(true);
    expect(isMentionMetadataEvent("group_member_deleted")).toBe(true);
    expect(isMentionMetadataEvent("posted")).toBe(false);
  });
});

describe("resolvePostedEventTeamId", () => {
  it("uses data.team_id when the Mattermost broadcast team is empty", () => {
    expect(resolvePostedEventTeamId("", "team-from-data")).toBe("team-from-data");
    expect(resolvePostedEventTeamId("team-from-broadcast", "team-from-data")).toBe(
      "team-from-broadcast",
    );
    expect(resolvePostedEventTeamId("", "")).toBeUndefined();
  });
});

describe("parsePostedEvent", () => {
  it("delivers edited posts with their updated mention state", () => {
    expect(parsePostedEvent(
      {
        event: "post_edited",
        data: {
          post: JSON.stringify({
            id: "edited-post",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 1,
            message: "mention removed",
          }),
          mentions: "[]",
        },
        broadcast: { channel_id: "channel-id" },
      },
      "alice",
      "alice-id",
    )).toMatchObject({
      eventType: "post_edited",
      channelId: "channel-id",
      mentionsUser: false,
      post: { id: "edited-post", message: "mention removed" },
    });
  });
});

describe("appendPostedEvent", () => {
  function event(id: string): PostedEvent {
    return {
      eventType: "posted",
      channelId: `channel-${id}`,
      mentionsUser: true,
      post: {
        id,
        user_id: "author",
        channel_id: `channel-${id}`,
        create_at: 1,
        message: id,
      },
    };
  }

  it("keeps rapid events, deduplicates updates, and enforces the bound", () => {
    let queue: PostedEvent[] = [];
    queue = appendPostedEvent(queue, event("a"), 2);
    queue = appendPostedEvent(queue, event("b"), 2);
    expect(queue.map(({ post }) => post.id)).toEqual(["a", "b"]);

    queue = appendPostedEvent(queue, {
      ...event("a"),
      post: { ...event("a").post, message: "updated" },
    }, 2);
    expect(queue.map(({ post }) => [post.id, post.message])).toEqual([
      ["b", "b"],
      ["a", "updated"],
    ]);

    queue = appendPostedEvent(queue, event("c"), 2);
    expect(queue.map(({ post }) => post.id)).toEqual(["a", "c"]);
  });
});
