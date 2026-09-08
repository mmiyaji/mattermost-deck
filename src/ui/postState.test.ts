import { describe, expect, it } from "vitest";
import { reuseUnchangedPostState, type PostState } from "./postState";
import { replacePolledPostWindow } from "./appBehavior";

function fixture(): PostState {
  return {
    status: "ready", error: null, nextPage: 1, hasMore: true, loadingMore: false,
    posts: [{
      id: "post", channel_id: "channel", user_id: "user", create_at: 1,
      update_at: 1, message: "hello", root_id: "", type: "", props: {}, file_ids: [],
    }],
  };
}

describe("unchanged polled post state", () => {
  it("reuses the state for an identical response, including an empty result", () => {
    for (const current of [fixture(), { ...fixture(), posts: [] }]) {
      expect(reuseUnchangedPostState(current, structuredClone(current))).toBe(current);
    }
  });

  it.each([
    ["message", "edited"], ["update_at", 2], ["delete_at", 3],
    ["file_ids", ["attachment"]], ["props", { attachments: [{ text: "changed" }] }],
    ["metadata", { reactions: [{ user_id: "other", emoji_name: "heart" }] }],
    ["root_id", "thread"], ["user_id", "other"],
  ])("does not suppress a changed %s, even with the same post id", (key, value) => {
    const current = fixture();
    const incoming = structuredClone(current);
    Object.assign(incoming.posts[0], { [key]: value });
    expect(reuseUnchangedPostState(current, incoming)).toBe(incoming);
  });

  it("preserves additions, deletions, and order changes", () => {
    const current = fixture();
    const second = { ...current.posts[0], id: "second" };
    for (const posts of [[], [...current.posts, second], [second]]) {
      const incoming = { ...current, posts };
      expect(reuseUnchangedPostState(current, incoming)).toBe(incoming);
    }
    const pair = { ...current, posts: [...current.posts, second] };
    const reversed = { ...pair, posts: [...pair.posts].reverse() };
    expect(reuseUnchangedPostState(pair, reversed)).toBe(reversed);
  });

  it.each([
    { status: "error" as const }, { error: "offline" }, { nextPage: 2 },
    { hasMore: false }, { loadingMore: true },
  ])("keeps state transitions while retaining unchanged posts: %j", change => {
    const current = fixture();
    const incoming = { ...structuredClone(current), ...change };
    const result = reuseUnchangedPostState(current, incoming);
    expect(result).not.toBe(current);
    expect(result).toEqual(incoming);
    expect(result.posts).toBe(current.posts);
  });

  it("preserves authoritative removals and posts received during a request", () => {
    const current = fixture();
    current.posts.push({ ...current.posts[0], id: "new", create_at: 300, update_at: 300 });
    const posts = replacePolledPostWindow([], current.posts, {
      maxPosts: 100, requestStartedAt: 200,
    });
    const result = reuseUnchangedPostState(current, { ...current, posts });
    expect(result.posts.map(post => post.id)).toEqual(["new"]);
  });
});
