import { expect, it } from "vitest";
import { movePaneRelative, initialisePaneRows, balancePaneRows } from "./paneOrder";
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

it("initialises legacy rows once and retains uneven assignments", () => {
  const initial = initialisePaneRows(panes);
  expect(initial.map(p => p.row)).toEqual([0,0,1]);
  const moved = movePaneRelative(initial, 'a', 'c', true, 1);
  expect(moved.map(p => [p.id,p.row])).toEqual([['b',0],['c',1],['a',1]]);
  expect(moved[0]).toBe(initial[1]);
  expect(moved[1]).toBe(initial[2]);
  expect(initialisePaneRows(moved)).toEqual(moved);
  expect(balancePaneRows(moved).map(p => p.row)).toEqual([0,0,1]);
});
it("moves into an empty row and preserves row assignments in single-row reorders", () => {
  const initial = panes.map(p => ({...p, row: 1 as const}));
  const moved = movePaneRelative(initial, 'c', null, true, 0);
  expect(moved.map(p => [p.id,p.row])).toEqual([['c',0],['a',1],['b',1]]);
  const single = movePaneRelative(moved, 'c', 'b', true);
  expect(single.map(p => [p.id,p.row])).toEqual([['a',1],['b',1],['c',0]]);
});
