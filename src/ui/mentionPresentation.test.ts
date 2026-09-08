import { describe, expect, it } from "vitest";
import type { MattermostPost } from "../mattermost/api";
import {
  countMentionPresentationChanges,
  shouldCaptureMentionDisplaySnapshot,
  summariseMentionPresentationChanges,
} from "./mentionPresentation";

function post(
  id: string,
  overrides: Partial<MattermostPost> = {},
): MattermostPost {
  return {
    id,
    user_id: "author",
    channel_id: "channel",
    create_at: 100,
    message: `message-${id}`,
    ...overrides,
  };
}

describe("countMentionPresentationChanges", () => {
  it("counts additions, updates, and removals once per post ID", () => {
    const displayed = [
      post("unchanged"),
      post("updated", { message: "before", update_at: 100 }),
      post("removed"),
    ];
    const refreshed = [
      post("unchanged"),
      post("updated", { message: "after", update_at: 200 }),
      post("added"),
    ];

    expect(
      countMentionPresentationChanges(displayed, refreshed),
    ).toBe(3);
    expect(
      summariseMentionPresentationChanges(displayed, refreshed),
    ).toEqual({
      count: 3,
      hasAdditionsOrUpdates: true,
    });
  });

  it("distinguishes removal-only refreshes from incoming changes", () => {
    expect(
      summariseMentionPresentationChanges(
        [post("retained"), post("removed")],
        [post("retained")],
      ),
    ).toEqual({
      count: 1,
      hasAdditionsOrUpdates: false,
    });
  });

  it("counts one post only once when several displayed fields change", () => {
    const displayed = [
      post("updated", {
        message: "before",
        update_at: 100,
        edit_at: 100,
        type: "custom_before",
      }),
    ];
    const refreshed = [
      post("updated", {
        message: "after",
        update_at: 200,
        edit_at: 200,
        type: "custom_after",
      }),
    ];

    expect(
      countMentionPresentationChanges(displayed, refreshed),
    ).toBe(1);
  });

  it("ignores list ordering and duplicate occurrences of the same ID", () => {
    const first = post("first");
    const second = post("second");
    const displayed = [first, second, first];
    const refreshed = [second, second, first];

    expect(
      countMentionPresentationChanges(displayed, refreshed),
    ).toBe(0);
  });

  it("ignores non-layout props omitted from compact mention cache snapshots", () => {
    const displayed = [post("cached")];
    const refreshed = [
      post("cached", {
        props: { addedUserId: "user-1" },
      }),
    ];

    expect(
      countMentionPresentationChanges(displayed, refreshed),
    ).toBe(0);
  });

  it("counts attachment hydration because it changes row height", () => {
    expect(
      countMentionPresentationChanges(
        [post("cached")],
        [post("cached", { file_ids: ["file-1"] })],
      ),
    ).toBe(1);
  });

  it("compares every post within the bounded 500-row mention feed", () => {
    const displayed = Array.from({ length: 500 }, (_, index) =>
      post(`post-${index}`, { create_at: index }),
    );
    const refreshed = [...displayed]
      .reverse()
      .map((entry) => (
        entry.id === "post-250"
          ? { ...entry, message: "updated" }
          : entry
      ));

    expect(
      countMentionPresentationChanges(displayed, refreshed),
    ).toBe(1);
  });
});

describe("shouldCaptureMentionDisplaySnapshot", () => {
  it("does not freeze realtime-only posts before an initial or retried load is verified", () => {
    expect(shouldCaptureMentionDisplaySnapshot({
      refreshActive: true,
      hasSnapshot: false,
      visiblePostCount: 2,
      hasVerifiedLiveResult: false,
      hasVisibleCachedBaseline: false,
    })).toBe(false);
  });

  it("holds a verified cache steady while its first live refresh completes", () => {
    expect(shouldCaptureMentionDisplaySnapshot({
      refreshActive: true,
      hasSnapshot: false,
      visiblePostCount: 2,
      hasVerifiedLiveResult: false,
      hasVisibleCachedBaseline: true,
    })).toBe(true);
  });

  it("holds the current result steady during later refreshes", () => {
    expect(shouldCaptureMentionDisplaySnapshot({
      refreshActive: true,
      hasSnapshot: false,
      visiblePostCount: 100,
      hasVerifiedLiveResult: true,
      hasVisibleCachedBaseline: false,
    })).toBe(true);
  });

  it("does not replace an existing snapshot or capture an empty or idle view", () => {
    const stableBaseline = {
      refreshActive: true,
      hasSnapshot: false,
      visiblePostCount: 2,
      hasVerifiedLiveResult: true,
      hasVisibleCachedBaseline: false,
    };

    expect(shouldCaptureMentionDisplaySnapshot({
      ...stableBaseline,
      hasSnapshot: true,
    })).toBe(false);
    expect(shouldCaptureMentionDisplaySnapshot({
      ...stableBaseline,
      visiblePostCount: 0,
    })).toBe(false);
    expect(shouldCaptureMentionDisplaySnapshot({
      ...stableBaseline,
      refreshActive: false,
    })).toBe(false);
  });
});
