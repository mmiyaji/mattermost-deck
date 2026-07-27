import { describe, expect, it, vi } from "vitest";
import type {
  MattermostPost,
  MattermostUserThread,
  MattermostUserThreads,
} from "../mattermost/api";
import { collectUnreadMentionThreads } from "./mentionThreadCollector";

function thread(
  id: string,
  unreadMentions = 0,
): MattermostUserThread {
  const post: MattermostPost = {
    id,
    user_id: "author",
    channel_id: "channel",
    create_at: Number(id.replace(/\D/g, "")) || 1,
    message: id,
  };
  return {
    id,
    post,
    reply_count: 1,
    last_reply_at: post.create_at,
    last_viewed_at: 0,
    unread_replies: 1,
    unread_mentions: unreadMentions,
  };
}

function page(threads: MattermostUserThread[]): MattermostUserThreads {
  return {
    total: threads.length,
    total_unread_threads: threads.length,
    total_unread_mentions: threads.reduce(
      (total, item) => total + (item.unread_mentions ?? 0),
      0,
    ),
    threads,
  };
}

describe("collectUnreadMentionThreads", () => {
  it("continues past 500 ordinary unread threads to find mention threads", async () => {
    const first = page(
      Array.from({ length: 200 }, (_, index) =>
        thread(`ordinary-a-${index}`)),
    );
    const second = page(
      Array.from({ length: 200 }, (_, index) =>
        thread(`ordinary-b-${index}`)),
    );
    const third = page([
      ...Array.from({ length: 100 }, (_, index) =>
        thread(`ordinary-c-${index}`)),
      thread("mention-after-500", 1),
    ]);
    const loadPage = vi
      .fn<(before: string) => Promise<MattermostUserThreads>>()
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(third);

    const result = await collectUnreadMentionThreads(
      first,
      loadPage,
      { perPage: 200, maxMentionThreads: 500 },
    );

    expect(result.map((item) => item.id)).toEqual([
      "mention-after-500",
    ]);
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it("stops paging as soon as the mention-thread budget is full", async () => {
    const first = page([
      thread("mention-1", 1),
      thread("mention-2", 1),
      ...Array.from({ length: 198 }, (_, index) =>
        thread(`ordinary-${index}`)),
    ]);
    const loadPage = vi.fn<
      (before: string) => Promise<MattermostUserThreads>
    >();

    const result = await collectUnreadMentionThreads(
      first,
      loadPage,
      { perPage: 200, maxMentionThreads: 2 },
    );

    expect(result.map((item) => item.id)).toEqual([
      "mention-1",
      "mention-2",
    ]);
    expect(loadPage).not.toHaveBeenCalled();
  });

  it("stops when a server repeats the same cursor page", async () => {
    const first = page(
      Array.from({ length: 200 }, (_, index) =>
        thread(`ordinary-${index}`)),
    );
    const loadPage = vi.fn(
      async () => first,
    );

    await collectUnreadMentionThreads(
      first,
      loadPage,
      { perPage: 200, maxMentionThreads: 500 },
    );

    expect(loadPage).toHaveBeenCalledTimes(1);
  });
});
