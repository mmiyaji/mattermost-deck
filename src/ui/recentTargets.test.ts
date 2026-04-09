import { describe, expect, it } from "vitest";
import { dedupeRecentTargets, getRecentTargetKey, type RecentChannelTarget } from "./recentTargets";

function makeTarget(overrides: Partial<RecentChannelTarget> = {}): RecentChannelTarget {
  return {
    type: "channelWatch",
    teamId: "team-a",
    teamLabel: "Team A",
    channelId: "channel-a",
    channelLabel: "Town Square",
    ...overrides,
  };
}

describe("getRecentTargetKey", () => {
  it("uses channelId only", () => {
    expect(getRecentTargetKey(makeTarget({ teamId: "" }))).toBe("channel-a");
    expect(getRecentTargetKey(makeTarget({ teamId: "team-b" }))).toBe("channel-a");
  });
});

describe("dedupeRecentTargets", () => {
  it("dedupes the same channel even when teamId differs", () => {
    const targets = dedupeRecentTargets([
      makeTarget({ teamId: "" }),
      makeTarget({ teamId: "team-a" }),
    ]);

    expect(targets).toEqual([makeTarget({ teamId: "" })]);
  });

  it("keeps the first occurrence for a duplicated channel", () => {
    const first = makeTarget({ channelLabel: "Current channel" });
    const second = makeTarget({ teamId: "", channelLabel: "Fallback label" });

    expect(dedupeRecentTargets([first, second])).toEqual([first]);
  });

  it("truncates to the most recent six unique channels", () => {
    const targets = Array.from({ length: 10 }, (_, index) =>
      makeTarget({
        channelId: `channel-${index}`,
        channelLabel: `Channel ${index}`,
      }),
    );

    expect(dedupeRecentTargets(targets)).toHaveLength(6);
    expect(dedupeRecentTargets(targets).map((target) => target.channelId)).toEqual([
      "channel-0",
      "channel-1",
      "channel-2",
      "channel-3",
      "channel-4",
      "channel-5",
    ]);
  });
});
