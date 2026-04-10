import { describe, expect, it } from "vitest";
import { shouldGroupAdjacentPosts, POST_GROUPING_MAX_GAP_MS } from "./postGrouping";
import type { MattermostPost } from "../mattermost/api";

function makePost(overrides: Partial<MattermostPost> = {}): MattermostPost {
  return {
    id: overrides.id ?? "post-1",
    user_id: overrides.user_id ?? "user-1",
    channel_id: overrides.channel_id ?? "channel-1",
    create_at: overrides.create_at ?? 1_000,
    message: overrides.message ?? "message",
    root_id: overrides.root_id,
    file_ids: overrides.file_ids,
  };
}

describe("shouldGroupAdjacentPosts", () => {
  it("groups root posts from the same user in the same channel within the time window", () => {
    const previous = makePost({ id: "a", create_at: 10_000 });
    const current = makePost({ id: "b", create_at: 10_000 + POST_GROUPING_MAX_GAP_MS - 1 });

    expect(shouldGroupAdjacentPosts(previous, current)).toBe(true);
  });

  it("groups replies from the same user in the same thread within the time window", () => {
    const previous = makePost({ id: "a", root_id: "root-1", channel_id: "channel-1", create_at: 10_000 });
    const current = makePost({ id: "b", root_id: "root-1", channel_id: "channel-1", create_at: 12_000 });

    expect(shouldGroupAdjacentPosts(previous, current)).toBe(true);
  });

  it("does not group posts from different users", () => {
    const previous = makePost({ id: "a", user_id: "user-1" });
    const current = makePost({ id: "b", user_id: "user-2" });

    expect(shouldGroupAdjacentPosts(previous, current)).toBe(false);
  });

  it("does not group posts from different threads", () => {
    const previous = makePost({ id: "a", root_id: "root-1" });
    const current = makePost({ id: "b", root_id: "root-2" });

    expect(shouldGroupAdjacentPosts(previous, current)).toBe(false);
  });

  it("does not group posts outside the time window", () => {
    const previous = makePost({ id: "a", create_at: 10_000 });
    const current = makePost({ id: "b", create_at: 10_000 + POST_GROUPING_MAX_GAP_MS + 1 });

    expect(shouldGroupAdjacentPosts(previous, current)).toBe(false);
  });
});
