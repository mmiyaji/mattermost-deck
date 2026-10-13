import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startVisiblePolling } from "./visiblePolling";

let doc: EventTarget & { hidden: boolean };
let win: EventTarget;
beforeEach(() => {
  vi.useFakeTimers();
  doc = Object.assign(new EventTarget(), { hidden: false });
  win = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function visibility(hidden: boolean) {
  doc.hidden = hidden;
  doc.dispatchEvent(new Event("visibilitychange"));
}

it("does no work during an eight-hour hidden period and resumes immediately", async () => {
  const run = vi.fn();
  const stop = startVisiblePolling(run, 2_000);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(run).toHaveBeenCalledTimes(3);
  visibility(true);
  await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1_000);
  expect(run).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
  visibility(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(4);
  stop();
  visibility(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(4);
  expect(vi.getTimerCount()).toBe(0);
});

it("starts hidden without scheduling and never overlaps a slow request on resume", async () => {
  doc.hidden = true;
  let finish!: () => void;
  const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const stop = startVisiblePolling(run, 2_000, { refreshOnOnline: true });
  expect(run).not.toHaveBeenCalled();
  visibility(false);
  visibility(true);
  visibility(false);
  win.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(run).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(run).toHaveBeenCalledTimes(2);
  stop();
  finish();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(vi.getTimerCount()).toBe(0);
  win.dispatchEvent(new Event("online"));
  expect(run).toHaveBeenCalledTimes(2);
});

it("recovers from errors without retaining timers while hidden", async () => {
  const run = vi.fn().mockRejectedValue(new Error("offline"));
  const stop = startVisiblePolling(run, 2_000, { refreshOnOnline: true });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(run).toHaveBeenCalledTimes(2);
  visibility(true);
  win.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  visibility(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(3);
  stop();
});

it("releases listeners and timers across repeated mounts and visibility changes", async () => {
  const addDocument = vi.spyOn(doc, "addEventListener");
  const removeDocument = vi.spyOn(doc, "removeEventListener");
  const addWindow = vi.spyOn(win, "addEventListener");
  const removeWindow = vi.spyOn(win, "removeEventListener");
  const run = vi.fn();
  for (let cycle = 0; cycle < 200; cycle++) {
    const stop = startVisiblePolling(run, 2_000, { refreshOnOnline: true });
    await vi.advanceTimersByTimeAsync(0);
    visibility(true);
    visibility(false);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  }
  expect(removeDocument.mock.calls).toEqual(addDocument.mock.calls);
  expect(removeWindow.mock.calls).toEqual(addWindow.mock.calls);
  const calls = run.mock.calls.length;
  visibility(false);
  win.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1_000);
  expect(run).toHaveBeenCalledTimes(calls);
});
