import { describe, expect, it, vi } from "vitest";
import { mapInBatches } from "./asyncBatch";

describe("mapInBatches", () => {
  it("preserves item order while processing in batches", async () => {
    const values = await mapInBatches([1, 2, 3, 4, 5], 2, async (value) => value * 10);
    expect(values).toEqual([10, 20, 30, 40, 50]);
  });

  it("does not start the next batch after cancellation", async () => {
    let cancelled = false;
    const mapper = vi.fn(async (value: number) => {
      if (value === 2) {
        cancelled = true;
      }
      return value * 10;
    });

    const values = await mapInBatches(
      [1, 2, 3, 4],
      2,
      mapper,
      0,
      () => cancelled,
    );

    expect(values).toEqual([10, 20]);
    expect(mapper).toHaveBeenCalledTimes(2);
    expect(mapper.mock.calls.map(([value]) => value)).toEqual([1, 2]);
  });

  it("does not invoke the mapper when already cancelled", async () => {
    const mapper = vi.fn(async (value: number) => value * 10);

    const values = await mapInBatches(
      [1, 2, 3],
      2,
      mapper,
      0,
      () => true,
    );

    expect(values).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
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
