import { describe, expect, it } from "vitest";
import type { TeamUnread } from "../mattermost/api";
import {
  canSkipEmptyMentionTeamSearch,
  mentionTeamUnreadSignature,
  shouldReuseMentionTeamScan,
} from "./mentionScanPlan";

const unread = (overrides: Partial<TeamUnread> = {}): TeamUnread => ({
  team_id: "team-1",
  mention_count: 0,
  msg_count: 0,
  ...overrides,
});

describe("shouldReuseMentionTeamScan", () => {
  const entry = { signature: "same", completedAt: 1_000 };

  it("reuses a successful matching scan until the full scan interval expires", () => {
    expect(shouldReuseMentionTeamScan(entry, "same", 1_000, 500, false)).toBe(true);
    expect(shouldReuseMentionTeamScan(entry, "same", 1_499, 500, false)).toBe(true);
    expect(shouldReuseMentionTeamScan(entry, "same", 1_500, 500, false)).toBe(false);
  });

  it("requires a successful entry with unchanged inputs and no forced refresh", () => {
    expect(shouldReuseMentionTeamScan(undefined, "same", 1_100, 500, false)).toBe(false);
    expect(shouldReuseMentionTeamScan(entry, "changed", 1_100, 500, false)).toBe(false);
    expect(shouldReuseMentionTeamScan(entry, "same", 1_100, 500, true)).toBe(false);
  });

  it("rejects clock rollback and invalid completion times", () => {
    expect(shouldReuseMentionTeamScan(entry, "same", 999, 500, false)).toBe(false);
    for (const completedAt of [NaN, Infinity, -Infinity]) {
      expect(shouldReuseMentionTeamScan({ ...entry, completedAt }, "same", 1_100, 500, false)).toBe(false);
    }
    expect(shouldReuseMentionTeamScan(entry, "same", NaN, 500, false)).toBe(false);
    expect(shouldReuseMentionTeamScan(entry, "same", 1_100, 0, false)).toBe(false);
  });
});

describe("mentionTeamUnreadSignature", () => {
  it("distinguishes missing records and missing counters from known zeros", () => {
    expect(mentionTeamUnreadSignature(undefined)).toBeNull();
    expect(mentionTeamUnreadSignature(unread())).not.toBeNull();
    expect(mentionTeamUnreadSignature(unread())).not.toBe(
      mentionTeamUnreadSignature(unread({ thread_mention_count: 0 })),
    );
  });

  it("uses a deterministic order independent of response property order", () => {
    expect(mentionTeamUnreadSignature(unread())).toBe(
      mentionTeamUnreadSignature({ msg_count: 0, mention_count: 0, team_id: "team-1" }),
    );
  });

  it("changes when any meaningful server counter changes", () => {
    const counters = [
      "mention_count", "mention_count_root", "thread_mention_count",
      "thread_urgent_mention_count", "msg_count", "msg_count_root", "thread_count",
    ] as const;
    const base = unread(Object.fromEntries(counters.map((key) => [key, 0])));
    for (const key of counters) {
      expect(mentionTeamUnreadSignature({ ...base, [key]: 1 })).not.toBe(mentionTeamUnreadSignature(base));
    }
  });
});

describe("canSkipEmptyMentionTeamSearch", () => {
  it("requires explicit evidence that both ordinary and thread mentions are empty", () => {
    expect(canSkipEmptyMentionTeamSearch(undefined, true, false)).toBe(false);
    expect(canSkipEmptyMentionTeamSearch(unread(), true, false)).toBe(false);
    expect(canSkipEmptyMentionTeamSearch(unread({ thread_mention_count: 0 }), true, false)).toBe(true);
    expect(canSkipEmptyMentionTeamSearch(unread({ thread_count: 0 }), true, false)).toBe(true);
    expect(canSkipEmptyMentionTeamSearch(unread({ thread_count: 1 }), true, false)).toBe(false);
  });

  it("searches review and all-mention modes because they can contain read mentions", () => {
    const empty = unread({ thread_mention_count: 0 });
    expect(canSkipEmptyMentionTeamSearch(empty, false, false)).toBe(false);
    expect(canSkipEmptyMentionTeamSearch(empty, true, true)).toBe(false);
    expect(canSkipEmptyMentionTeamSearch(empty, false, true)).toBe(false);
  });

  it("does not discard explicit mention signals even when other counters say empty", () => {
    for (const overrides of [
      { mention_count: 1 },
      { mention_count_root: 1 },
      { thread_mention_count: 1 },
      { thread_urgent_mention_count: 1 },
    ]) {
      expect(canSkipEmptyMentionTeamSearch(unread({ thread_count: 0, ...overrides }), true, false)).toBe(false);
    }
  });
});
