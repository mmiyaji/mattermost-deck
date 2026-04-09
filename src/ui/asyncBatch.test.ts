import { describe, expect, it, vi } from "vitest";
import { mapInBatches } from "./asyncBatch";

describe("mapInBatches", () => {
  it("preserves item order while processing in batches", async () => {
    const values = await mapInBatches([1, 2, 3, 4, 5], 2, async (value) => value * 10);
    expect(values).toEqual([10, 20, 30, 40, 50]);
  });

  it("waits between batches when a gap is configured", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = mapInBatches([1, 2, 3], 1, async (value) => value, 250);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual([1, 2, 3]);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 250);
  });
});
