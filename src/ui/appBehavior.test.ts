import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  MattermostChannel,
  MattermostPost,
} from "../mattermost/api";
import type { PostedEvent } from "../mattermost/websocket";
import {
  appendPostPage,
  getLoadedPostRefreshLimit,
  PendingPostMeta,
  postedEventNeedsChannelMetadata,
  postMatchesBoundedImplicitMention,
  replacePolledPostWindow,
  shouldSafeStopDeckState,
  takeScopedMentionPostedEvents,
  withPostedEventChannelMetadata,
} from "./appBehavior";

function post(
  id: string,
  userId: string,
  createAt: number,
  rootId = "",
): MattermostPost {
  return {
    id,
    channel_id: "channel",
    user_id: userId,
    message: "plain reply",
    create_at: createAt,
    update_at: createAt,
    root_id: rootId,
    type: "",
    props: {},
  };
}

function postedEvent(overrides: Partial<PostedEvent> = {}): PostedEvent {
  return {
    eventType: "posted",
    channelId: "channel",
    post: post("reply", "other", 200, "root"),
    mentionsUser: false,
    ...overrides,
  };
}

describe("App realtime behavior", () => {
  it("refreshes every loaded page without resetting the next page cursor", () => {
    expect(getLoadedPostRefreshLimit(1, 20, 100)).toBe(20);
    expect(getLoadedPostRefreshLimit(4, 20, 100)).toBe(80);
    expect(getLoadedPostRefreshLimit(8, 20, 100)).toBe(100);
  });

  it("computes pagination capacity after deduplication", () => {
    const current = [post("one", "me", 3), post("two", "me", 2)];
    const incoming = [post("two", "me", 2), post("three", "me", 1)];
    const result = appendPostPage(current, incoming, 2, 3);

    expect(result.posts.map((entry) => entry.id)).toEqual(["one", "two", "three"]);
    expect(result.hasMore).toBe(false);
  });

  it("treats a polled window as authoritative while retaining concurrent realtime posts", () => {
    const current = [
      post("concurrent", "me", 300),
      { ...post("edited-concurrently", "me", 100), update_at: 300 },
      post("removed", "me", 100),
    ];
    const refreshed = replacePolledPostWindow([], current, {
      maxPosts: 100,
      requestStartedAt: 200,
      deletedPostIds: new Set(["deleted"]),
    });

    expect(refreshed.map((entry) => entry.id)).toEqual([
      "concurrent",
      "edited-concurrently",
    ]);
    expect(replacePolledPostWindow([], current, { maxPosts: 100 })).toEqual([]);
  });

  it("safe-stops when route-context refresh expires an existing session", () => {
    expect(shouldSafeStopDeckState({
      status: "error",
      userId: "existing-user",
      sessionExpired: true,
    })).toBe(true);
    expect(shouldSafeStopDeckState({
      status: "error",
      userId: "existing-user",
      sessionExpired: false,
    })).toBe(false);
  });

  it("retains an unresolved team-scoped event for channel-metadata retry", () => {
    const event = postedEvent();
    const processed = new WeakSet<PostedEvent>();

    expect(takeScopedMentionPostedEvents(
      [event],
      processed,
      {
        columnTeamId: "team",
        channelDirectory: {},
        knownPostIds: new Set(),
      },
    )).toEqual([]);
    expect(processed.has(event)).toBe(false);

    const directChannel = {
      id: "channel",
      team_id: "",
      type: "D",
      name: "me__other",
      display_name: "",
    } satisfies MattermostChannel;
    expect(takeScopedMentionPostedEvents(
      [event],
      processed,
      {
        columnTeamId: "team",
        channelDirectory: { channel: directChannel },
        knownPostIds: new Set(),
      },
    )).toEqual([event]);
    expect(processed.has(event)).toBe(true);
  });

  it("enriches incomplete DM events before mention matching", () => {
    const event = postedEvent();
    expect(postedEventNeedsChannelMetadata(event)).toBe(true);

    const enriched = withPostedEventChannelMetadata(event, {
      team_id: "",
      type: "D",
    });
    expect(enriched).not.toBe(event);
    expect(enriched.channelType).toBe("D");
    expect(enriched.teamId).toBeUndefined();
    expect(postedEventNeedsChannelMetadata(enriched)).toBe(false);
  });

  it("matches root-owner replies and conservatively keeps truncated any-comment threads", () => {
    const reply = post("reply", "other", 300, "root");
    const myRoot = post("root", "me", 100);

    expect(postMatchesBoundedImplicitMention(
      reply,
      myRoot,
      [reply],
      {
        currentUserId: "me",
        collapsedReplyThreads: false,
        commentsNotify: "root",
      },
      false,
    )).toBe(true);
    expect(postMatchesBoundedImplicitMention(
      reply,
      post("root", "root-owner", 100),
      [reply],
      {
        currentUserId: "me",
        collapsedReplyThreads: false,
        commentsNotify: "any",
      },
      true,
    )).toBe(true);
    expect(postMatchesBoundedImplicitMention(
      reply,
      post("root", "root-owner", 100),
      [reply],
      {
        currentUserId: "me",
        collapsedReplyThreads: false,
        commentsNotify: "any",
      },
      false,
    )).toBe(false);
  });

  it("reserves an aria-hidden metadata line while channel details load", () => {
    const html = renderToStaticMarkup(PendingPostMeta());
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("\u00a0");
  });
});
