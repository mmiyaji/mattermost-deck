import { describe, expect, it } from "vitest";
import type { DeckColumn } from "./layout";
import { mentionFeedOwnerKey, reconcileMentionFeedOwners } from "./mentionFeedOwners";

const pane = (id: string, teamId?: string): DeckColumn => ({ id, type: "mentions", teamId });
const key = (team?: string) => mentionFeedOwnerKey("server", "user", team);
describe("mention feed ownership", () => {
  it("retains its collector across reordering, row moves and added views", () => {
    const original = [pane("source"), { ...pane("review"), mentionReview: true }];
    const elected = reconcileMentionFeedOwners(new Map(), original, "server", "user");
    const reordered = [{ ...pane("new-review"), mentionReview: true }, { ...original[1], row: 1 as const }, original[0]];
    expect(reconcileMentionFeedOwners(elected, reordered, "server", "user").get(key())).toBe("source");
  });
  it("hands off only when the collector is removed or changes feed", () => {
    const elected = reconcileMentionFeedOwners(new Map(), [pane("source"), pane("review")], "server", "user");
    expect(reconcileMentionFeedOwners(elected, [pane("review")], "server", "user").get(key())).toBe("review");
    const changedTeam = reconcileMentionFeedOwners(elected, [pane("source", "team"), pane("review")], "server", "user");
    expect(changedTeam.get(key())).toBe("review");
    expect(changedTeam.get(key("team"))).toBe("source");
  });
  it("isolates server, account and team identities and removes unused scopes", () => {
    const elected = reconcileMentionFeedOwners(new Map(), [pane("source"), pane("review"), pane("team", "team")], "server", "user");
    const otherUser = reconcileMentionFeedOwners(elected, [pane("review"), pane("source")], "server", "other-user");
    expect(otherUser.has(key())).toBe(false);
    expect(otherUser.get(mentionFeedOwnerKey("server", "other-user"))).toBe("review");
    const otherServer = reconcileMentionFeedOwners(elected, [pane("review"), pane("source")], "other-server", "user");
    expect(otherServer.get(mentionFeedOwnerKey("other-server", "user"))).toBe("review");
    expect(reconcileMentionFeedOwners(elected, [], "server", "user").size).toBe(0);
  });
});
