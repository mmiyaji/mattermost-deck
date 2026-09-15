import { expect, it } from "vitest";
import { movePaneRelative } from "./paneOrder";
import type { DeckColumn } from "./layout";

const panes: DeckColumn[] = [
  { id: "a", type: "channelWatch", channelId: "channel", width: 360 },
  { id: "b", type: "favorites" },
  { id: "c", type: "search", query: "release" },
];
it("moves in both directions without changing pane settings or duplicating entries", () => {
  const next = movePaneRelative(panes, "a", "c", true);
  expect(next.map(p => p.id)).toEqual(["b", "c", "a"]);
  expect(next[2]).toBe(panes[0]);
  expect(movePaneRelative(next, "a", "b", false)).toEqual(panes);
});
it("ignores stale targets, self-drops, and unchanged adjacent drops", () => {
  expect(movePaneRelative(panes, "a", "missing", false)).toBe(panes);
  expect(movePaneRelative(panes, "missing", "a", false)).toBe(panes);
  expect(movePaneRelative(panes, "a", "a", true)).toBe(panes);
  expect(movePaneRelative(panes, "a", "b", false)).toBe(panes);
});
