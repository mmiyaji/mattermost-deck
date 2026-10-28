import { describe, expect, it } from "vitest";
import type { MattermostChannel, MattermostChannelMember } from "../mattermost/api";
import { mentionScanSignature, rememberMentionScan } from "./mentionScanCache";

const channel = (overrides: Partial<MattermostChannel> = {}): MattermostChannel => ({
  id: "channel-1",
  name: "channel-1",
  display_name: "Channel 1",
  type: "O",
  last_post_at: 1_000,
  ...overrides,
});

const member = (overrides: Partial<MattermostChannelMember> = {}): MattermostChannelMember => ({
  channel_id: "channel-1",
  user_id: "user-1",
  last_viewed_at: 500,
  msg_count: 10,
  mention_count: 1,
  mention_count_root: 1,
  ...overrides,
});

describe("mentionScanSignature", () => {
  it("is stable while nothing a scan reads has moved", () => {
    expect(mentionScanSignature(member(), channel(), "filters")).toBe(
      mentionScanSignature(member(), channel(), "filters"),
    );
  });

  it("changes when the channel gains a post", () => {
    // A reply the user is implicitly mentioned in moves no member counter, so
    // the channel's own newest-post stamp is what keeps the cache honest.
    expect(mentionScanSignature(member(), channel({ last_post_at: 1_001 }), "filters")).not.toBe(
      mentionScanSignature(member(), channel(), "filters"),
    );
  });

  it("changes when the read position or unread counters move", () => {
    const base = mentionScanSignature(member(), channel(), "filters");
    for (const moved of [
      member({ last_viewed_at: 600 }),
      member({ msg_count: 11 }),
      member({ mention_count: 2 }),
      member({ mention_count_root: 2 }),
    ]) {
      expect(mentionScanSignature(moved, channel(), "filters")).not.toBe(base);
    }
  });

  it("changes when the mention rules or the channel type change", () => {
    const base = mentionScanSignature(member(), channel(), "filters");
    expect(mentionScanSignature(member(), channel(), "other-filters")).not.toBe(base);
    expect(mentionScanSignature(member(), channel({ type: "D" }), "filters")).not.toBe(base);
  });

  it("treats missing counters as zero rather than running them together", () => {
    const sparse = { channel_id: "channel-1", user_id: "user-1" } satisfies MattermostChannelMember;
    expect(mentionScanSignature(sparse, channel({ last_post_at: undefined }), "filters")).toBe(
      mentionScanSignature(
        member({ last_viewed_at: 0, msg_count: 0, mention_count: 0, mention_count_root: 0 }),
        channel({ last_post_at: 0 }),
        "filters",
      ),
    );
  });
});

describe("rememberMentionScan", () => {
  it("replaces an entry without growing the cache", () => {
    const cache = new Map<string, string>();
    rememberMentionScan(cache, "channel-1", "a", 4);
    rememberMentionScan(cache, "channel-1", "b", 4);
    expect(cache.size).toBe(1);
    expect(cache.get("channel-1")).toBe("b");
  });

  it("evicts the least recently scanned channel past the bound", () => {
    const cache = new Map<string, string>();
    for (const id of ["c1", "c2", "c3"]) rememberMentionScan(cache, id, id, 2);
    expect(Array.from(cache.keys())).toEqual(["c2", "c3"]);
  });

  it("counts a rescan as recent use", () => {
    const cache = new Map<string, string>();
    for (const id of ["c1", "c2"]) rememberMentionScan(cache, id, id, 2);
    rememberMentionScan(cache, "c1", "c1-again", 2);
    rememberMentionScan(cache, "c3", "c3", 2);
    expect(Array.from(cache.keys())).toEqual(["c1", "c3"]);
  });
});
