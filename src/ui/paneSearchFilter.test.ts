import { describe, expect, it } from "vitest";
import type { MattermostUser } from "../mattermost/api";
import { filterPanePosts, indexPanePosts } from "./paneSearchFilter";

const posts = [
  { id: "a", channel_id: "c", user_id: "u", message: "リリースの確認 Release [v2]", create_at: 2 },
  { id: "b", channel_id: "c", user_id: "v", message: "Cafe\u0301 notes", create_at: 1 },
];
const users = { u: { username: "alice", first_name: "花子", nickname: "Hana" } as MattermostUser };

describe("pane-local search", () => {
  const index = indexPanePosts(posts, users);
  it("preserves the original array when cleared", () => {
    expect(filterPanePosts(posts, index, "  ")).toBe(posts);
  });
  it("matches Japanese and case-insensitive literal text", () => {
    expect(filterPanePosts(posts, index, "リリース")).toEqual([posts[0]]);
    expect(filterPanePosts(posts, index, "RELEASE")).toEqual([posts[0]]);
    expect(filterPanePosts(posts, index, "[v2]")).toEqual([posts[0]]);
  });
  it("matches canonically equivalent Unicode", () => {
    expect(filterPanePosts(posts, index, "Café")).toEqual([posts[1]]);
  });
  it("matches loaded author names without requiring user records", () => {
    for (const query of ["Alice", "@alice", "花子", "hana"]) expect(filterPanePosts(posts, index, query)).toEqual([posts[0]]);
    expect(filterPanePosts(posts, index, "notes")).toEqual([posts[1]]);
  });
  it("preserves ordering and reports no matches", () => {
    expect(filterPanePosts(posts, index, "e")).toEqual(posts);
    expect(filterPanePosts(posts, index, "missing")).toEqual([]);
  });
});
