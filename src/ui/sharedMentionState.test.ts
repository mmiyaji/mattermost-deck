import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSharedMentionCell, sharedMentionCell, sharedMentionStateKey, subscribeToSharedMentionCell } from "./sharedMentionState";

// Each test owns a key, since the registry outlives a single test.
let next = 0;
const freshKey = () => sharedMentionStateKey(`context-${next++}`, "postState");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("shared mention state cells", () => {
  it("shares one cell per key and notifies every subscriber", () => {
    const key = freshKey(), cell = sharedMentionCell(key, 0);
    expect(sharedMentionCell(key, 99)).toBe(cell);
    const first = vi.fn(), second = vi.fn();
    subscribeToSharedMentionCell(key, cell, first);
    subscribeToSharedMentionCell(key, cell, second);
    setSharedMentionCell(cell, 1);
    expect([first, second].map(listener => listener.mock.calls.length)).toEqual([1, 1]);
    expect(sharedMentionCell(key, 0).value).toBe(1);
  });
  it("applies a functional update against the current value and skips an unchanged one", () => {
    const key = freshKey(), cell = sharedMentionCell(key, { count: 1 });
    const listener = vi.fn();
    subscribeToSharedMentionCell(key, cell, listener);
    setSharedMentionCell(cell, previous => ({ count: previous.count + 1 }));
    expect(cell.value).toEqual({ count: 2 });
    setSharedMentionCell(cell, cell.value);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it("keeps a cell while any view still subscribes", () => {
    const key = freshKey(), cell = sharedMentionCell(key, 0);
    const release = subscribeToSharedMentionCell(key, cell, vi.fn());
    subscribeToSharedMentionCell(key, cell, vi.fn());
    release();
    vi.advanceTimersByTime(5_000);
    expect(sharedMentionCell(key, 0)).toBe(cell);
  });
  it("discards a cell a second after its last view, and reuses it for a remount inside that second", () => {
    const key = freshKey(), cell = sharedMentionCell(key, 0);
    const release = subscribeToSharedMentionCell(key, cell, vi.fn());
    setSharedMentionCell(cell, 7);
    release();
    vi.advanceTimersByTime(999);
    expect(sharedMentionCell(key, 0)).toBe(cell);
    subscribeToSharedMentionCell(key, cell, vi.fn());
    vi.advanceTimersByTime(5_000);
    expect(sharedMentionCell(key, 0).value).toBe(7);
  });
  it("drops the cell once nothing re-subscribes, so the next view starts from its initial value", () => {
    const key = freshKey(), cell = sharedMentionCell(key, 0);
    const release = subscribeToSharedMentionCell(key, cell, vi.fn());
    setSharedMentionCell(cell, 7);
    release();
    vi.advanceTimersByTime(1_000);
    const replacement = sharedMentionCell(key, 0);
    expect(replacement).not.toBe(cell);
    expect(replacement.value).toBe(0);
  });
  // Regression: two releases used to leave two timers, and the stale one deleted the key
  // without checking identity, so panes stopped sharing state and refetched in parallel.
  it("survives staggered releases without a stale timer dropping the live cell", () => {
    const key = freshKey(), cell = sharedMentionCell(key, 0);
    const releaseFirst = subscribeToSharedMentionCell(key, cell, vi.fn());
    const releaseSecond = subscribeToSharedMentionCell(key, cell, vi.fn());
    setSharedMentionCell(cell, 99);
    releaseFirst();
    vi.advanceTimersByTime(10);
    releaseSecond();
    vi.advanceTimersByTime(995);
    // The first release's timer would have fired here and taken the cell with it.
    const reused = sharedMentionCell(key, 0);
    expect(reused).toBe(cell);
    expect(reused.value).toBe(99);
    const listener = vi.fn();
    subscribeToSharedMentionCell(key, reused, listener);
    vi.advanceTimersByTime(5_000);
    expect(sharedMentionCell(key, 0)).toBe(reused);
    setSharedMentionCell(reused, 100);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
