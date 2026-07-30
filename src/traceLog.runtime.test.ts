import { afterEach, describe, expect, it, vi } from "vitest";

describe("trace log runtime lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
