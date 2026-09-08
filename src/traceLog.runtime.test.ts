import { afterEach, describe, expect, it, vi } from "vitest";

describe("trace log runtime lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps logs bounded when storage fails and persists again after recovery", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const set = vi.fn(async (): Promise<void> => { throw new Error("quota exceeded"); });
    vi.stubGlobal("chrome", {
      storage: {
        local: {get: vi.fn(async () => ({})), set},
        onChanged: {addListener: vi.fn(), removeListener: vi.fn()},
      },
    });
    const traceLog = await import("./traceLog.js");
    try {
      for (let index = 0; index < 10; index++) await Promise.resolve();
      traceLog.setTraceCaptureEnabled(true);
      for (let index = 0; index < 2_000; index++) {
        traceLog.addTraceEntry({source: "api", level: "info", event: `request-${index}`});
      }
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(300);
      expect(traceLog.getTraceEntries()).toHaveLength(500);
      expect(traceLog.getTraceEntries()[0].event).toBe("request-1999");
      expect(vi.getTimerCount()).toBe(0);
      set.mockImplementation(async () => undefined);
      traceLog.addTraceEntry({source: "api", level: "info", event: "recovered"});
      await vi.advanceTimersByTimeAsync(300);
      expect(set).toHaveBeenLastCalledWith({
        "mattermostDeck.traceEntries.v1": expect.arrayContaining([expect.objectContaining({event: "recovered"})]),
      });
      set.mockImplementation(async () => { throw new Error("context invalidated"); });
      traceLog.clearTraceEntries();
      traceLog.setTraceCaptureEnabled(false);
      await vi.advanceTimersByTimeAsync(300);
      expect(traceLog.getTraceEntries()).toEqual([]);
    } finally { traceLog.disposeTraceLogRuntime(); }
  });

  it("removes its storage listener and pending flush when disposed", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const get = vi.fn(async () => ({}));
    const set = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      storage: {
        local: { get, set },
        onChanged: {
          addListener,
          removeListener,
        },
      },
    });

    const traceLog = await import("./traceLog.js");
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve();
    }
    expect(addListener).toHaveBeenCalledTimes(1);

    traceLog.setTraceCaptureEnabled(true);
    await Promise.resolve();
    traceLog.addTraceEntry({
      source: "content",
      level: "info",
      event: "runtime-test",
    });
    await Promise.resolve();
    const storageWritesBeforeDispose = set.mock.calls.length;

    traceLog.disposeTraceLogRuntime();
    expect(removeListener).toHaveBeenCalledWith(
      addListener.mock.calls[0]?.[0],
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(set).toHaveBeenCalledTimes(
      storageWritesBeforeDispose,
    );

    traceLog.addTraceEntry({
      source: "content",
      level: "info",
      event: "ignored-after-dispose",
    });
    expect(traceLog.getTraceEntries()).toEqual([]);
  });
});
