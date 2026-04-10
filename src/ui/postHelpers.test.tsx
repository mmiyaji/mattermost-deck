import { describe, expect, it } from "vitest";
import type { MattermostPost } from "../mattermost/api.js";
import { buildPostListEntries, buildSearchSnippet, mergePosts } from "./postHelpers.js";

function makePost(id: string, createAt: number, overrides: Partial<MattermostPost> = {}): MattermostPost {
  return {
    id,
    user_id: "user-1",
    channel_id: "channel-1",
    create_at: createAt,
    message: `message-${id}`,
    ...overrides,
  };
}

describe("mergePosts", () => {
  it("dedupes posts by id and keeps the newest-first order", () => {
    const newest = makePost("newest", 300);
    const middle = makePost("middle", 200);
    const older = makePost("older", 100);

    const result = mergePosts([middle, older], [newest, middle], 10);

    expect(result.map((post) => post.id)).toEqual(["newest", "middle", "older"]);
  });

  it("applies the limit after merging", () => {
    const result = mergePosts(
      [makePost("p1", 500), makePost("p2", 400)],
      [makePost("p3", 300), makePost("p4", 200)],
      3,
    );

    expect(result.map((post) => post.id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("buildPostListEntries", () => {
  it("inserts an unread separator before the first already-read post", () => {
    const posts = [
      makePost("latest", 500),
      makePost("middle", 400),
      makePost("older", 300),
    ];

    const entries = buildPostListEntries(posts, 350);

    expect(entries.map((entry) => entry.type)).toEqual(["post", "post", "unread-separator", "post"]);
  });
});

describe("buildSearchSnippet", () => {
  it("returns a focused snippet around the first match", () => {
    const message = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
    const snippet = buildSearchSnippet(message, "theta", 24);

    expect(snippet).toContain("theta");
    expect(snippet.startsWith("...")).toBe(true);
  });
});
