import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startVisibleInterval } from "./visibleInterval";

let doc: EventTarget & { hidden: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setHidden(hidden: boolean): void {
  doc.hidden = hidden;
  doc.dispatchEvent(new Event("visibilitychange"));
}

it("stops the route fallback while hidden and reconciles once on resume", () => {
  const run = vi.fn();
  const stop = startVisibleInterval(run, 5_000);

  vi.advanceTimersByTime(5_000);
  expect(run).toHaveBeenCalledTimes(1);
  setHidden(true);
  vi.advanceTimersByTime(8 * 60 * 60 * 1_000);
  expect(run).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);

  setHidden(false);
  expect(run).toHaveBeenCalledTimes(2);
  setHidden(false);
  expect(run).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(5_000);
  expect(run).toHaveBeenCalledTimes(3);

  stop();
  expect(vi.getTimerCount()).toBe(0);
  setHidden(false);
  vi.advanceTimersByTime(10_000);
  expect(run).toHaveBeenCalledTimes(3);
});

it("starts without polling when initially hidden and removes its listener on dispose", () => {
  doc.hidden = true;
  const run = vi.fn();
  const addListener = vi.spyOn(doc, "addEventListener");
  const removeListener = vi.spyOn(doc, "removeEventListener");
  const stop = startVisibleInterval(run, 5_000);

  expect(run).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  setHidden(false);
  expect(run).toHaveBeenCalledTimes(1);
  stop();
  expect(removeListener.mock.calls).toEqual(addListener.mock.calls);
  expect(vi.getTimerCount()).toBe(0);
});
