import { describe, expect, it } from "vitest";
import { AdaptiveConcurrencyController } from "./adaptiveConcurrency.js";

function sampleLoad(controller: AdaptiveConcurrencyController, count: number, latencyMs = 100): void {
  for (let i = 0; i < count; i += 1) {
    controller.sample({ latencyMs, inFlight: controller.snapshot().limit });
  }
}

type LatencyState = {
  recentLatencies: number[];
  sortedLatencies: number[];
  baselineMs: number | null;
  smoothedMs: number | null;
  updateLatency: (latencyMs: number) => void;
};

function useCopyAndSortReference(controller: AdaptiveConcurrencyController): void {
  // Keep controller decisions identical while comparing its latency estimates
  // with the previous copy-and-sort implementation of the 32-sample window.
  const state = controller as unknown as LatencyState;
  state.updateLatency = latencyMs => {
    state.smoothedMs = state.smoothedMs === null ? latencyMs : state.smoothedMs * 0.8 + latencyMs * 0.2;
    state.recentLatencies.push(latencyMs);
    if (state.recentLatencies.length > 32) state.recentLatencies.shift();
    const sorted = [...state.recentLatencies].sort((a, b) => a - b);
    const lowLatency = sorted[Math.floor((sorted.length - 1) * 0.2)]!;
    if (state.baselineMs === null) state.baselineMs = lowLatency;
    else if (lowLatency < state.baselineMs) state.baselineMs = state.baselineMs * 0.8 + lowLatency * 0.2;
    else state.baselineMs = Math.min(lowLatency, state.baselineMs * 1.02);
  };
}

describe("AdaptiveConcurrencyController", () => {
  it.each([
    { name: "equal samples", values: Array.from({ length: 640 }, () => 100) },
    { name: "duplicate-heavy samples", values: Array.from({ length: 640 }, (_, index) => [100, 80, 100, 80, 160, 100, 160, 80][index % 8]!) },
    { name: "slow and fast periods", values: Array.from({ length: 640 }, (_, index) => index < 160 ? 100 : index < 320 ? 400 : index < 480 ? 60 : 180) },
    { name: "varying fractional samples", values: Array.from({ length: 640 }, (_, index) => 50.25 + (index * 73) % 497) },
  ])("matches the copy/sort reference for $name and keeps both windows bounded", ({ values }) => {
    const controller = new AdaptiveConcurrencyController(8);
    const reference = new AdaptiveConcurrencyController(8);
    useCopyAndSortReference(reference);
    const state = controller as unknown as LatencyState;
    for (const [index, latencyMs] of values.entries()) {
      if (index === 211 || index === 432) {
        const max = index === 211 ? 6 : 8;
        controller.configure(max); reference.configure(max);
      }
      const sample = { latencyMs, inFlight: index % 17 === 0 ? 0 : 8, congested: index > 0 && index % 137 === 0 };
      controller.sample(sample); reference.sample(sample);
      expect(controller.snapshot()).toEqual(reference.snapshot());
      expect(state.recentLatencies.length).toBeLessThanOrEqual(32);
      expect(state.sortedLatencies).toEqual([...state.recentLatencies].sort((a, b) => a - b));
    }
  });

  it("resets a prior cooldown when the maximum changes while preserving learned latency", () => {
    const controller = new AdaptiveConcurrencyController(8, 8);
    sampleLoad(controller, 16);
    controller.sample({ latencyMs: 1000, inFlight: 8, congested: true });
    const learned = controller.snapshot();
    controller.configure(7);
    expect(controller.snapshot()).toMatchObject({ limit: 4, maxLimit: 7, baselineMs: learned.baselineMs, smoothedMs: learned.smoothedMs });
    sampleLoad(controller, 7);
    expect(controller.snapshot().limit).toBe(4);
    sampleLoad(controller, 1);
    expect(controller.snapshot()).toMatchObject({ limit: 5, reason: "healthy-load" });
  });

  it("preserves the cooldown when the configured maximum is unchanged", () => {
    const controller = new AdaptiveConcurrencyController(8, 8);
    sampleLoad(controller, 16);
    controller.sample({ latencyMs: 1000, inFlight: 8, congested: true });
    const learned = controller.snapshot();
    controller.configure(8);
    expect(controller.snapshot()).toEqual(learned);
    sampleLoad(controller, 8);
    expect(controller.snapshot()).toMatchObject({ limit: 4, reason: "cooldown", baselineMs: learned.baselineMs, smoothedMs: learned.smoothedMs });
    sampleLoad(controller, 7);
    expect(controller.snapshot().limit).toBe(4);
    sampleLoad(controller, 1);
    expect(controller.snapshot().limit).toBe(5);
  });

  it("accepts a bounded initial limit and still backs off and recovers safely", () => {
    expect(new AdaptiveConcurrencyController(8, 8).snapshot().limit).toBe(8);
    expect(new AdaptiveConcurrencyController(4, 20).snapshot().limit).toBe(4);
    expect(new AdaptiveConcurrencyController(8, 3.9).snapshot().limit).toBe(3);
    for (const initial of [0, -1, NaN, Infinity]) {
      expect(new AdaptiveConcurrencyController(8, initial).snapshot().limit).toBe(1);
    }
    const controller = new AdaptiveConcurrencyController(8, 8);
    controller.sample({ latencyMs: 1000, inFlight: 8, congested: true });
    expect(controller.snapshot().limit).toBe(4);
    sampleLoad(controller, 100);
    expect(controller.snapshot().limit).toBe(8);
  });

  it("preserves learned state and probing progress when the ceiling is unchanged", () => {
    const controller = new AdaptiveConcurrencyController(8);
    sampleLoad(controller, 7);
    const beforeConfigure = controller.snapshot();
    controller.configure(8);
    expect(controller.snapshot()).toEqual(beforeConfigure);
    sampleLoad(controller, 1);
    expect(controller.snapshot().limit).toBe(3);
    controller.sample({ latencyMs: 1000, inFlight: 3, congested: true });
    const afterCongestion = controller.snapshot();
    controller.configure(8);
    expect(controller.snapshot()).toEqual(afterCongestion);
  });

  it("gradually probes upward only after enough healthy saturated samples", () => {
    const controller = new AdaptiveConcurrencyController(8);
    expect(controller.snapshot().limit).toBe(2);
    sampleLoad(controller, 7);
    expect(controller.snapshot().limit).toBe(2);
    sampleLoad(controller, 1);
    expect(controller.snapshot()).toMatchObject({ limit: 3, reason: "healthy-load" });
    sampleLoad(controller, 40);
    expect(controller.snapshot().limit).toBe(8);
  });

  it("does not increase the limit for idle or intermittently saturated traffic", () => {
    const controller = new AdaptiveConcurrencyController(8);
    for (let i = 0; i < 100; i += 1) {
      controller.sample({ latencyMs: 100, inFlight: i % 2 === 0 ? 2 : 1 });
    }
    expect(controller.snapshot()).toMatchObject({ limit: 2, reason: "under-utilized" });
  });

  it.each(["timeout", "429"])("promptly backs off on explicit %s congestion", () => {
    const controller = new AdaptiveConcurrencyController(8);
    sampleLoad(controller, 48);
    controller.sample({ latencyMs: 30_000, inFlight: 8, congested: true });
    expect(controller.snapshot()).toMatchObject({ limit: 4, reason: "congestion", baselineMs: 100 });
    controller.sample({ latencyMs: 100, inFlight: 4, congested: true });
    expect(controller.snapshot().limit).toBe(2);
    controller.sample({ latencyMs: 100, inFlight: 2, congested: true });
    controller.sample({ latencyMs: 100, inFlight: 1, congested: true });
    expect(controller.snapshot().limit).toBe(1);
  });

  it("reduces sustained latency pressure while tolerating one slow response", () => {
    const controller = new AdaptiveConcurrencyController(8);
    sampleLoad(controller, 48);
    sampleLoad(controller, 1, 1000);
    expect(controller.snapshot().limit).toBe(8);
    sampleLoad(controller, 16);
    expect(controller.snapshot().limit).toBe(8);
    sampleLoad(controller, 6, 400);
    expect(controller.snapshot().limit).toBeLessThan(8);
    expect(controller.snapshot().limit).toBeGreaterThanOrEqual(1);
  });

  it("recovers after congestion and after slow responses return to normal", () => {
    const controller = new AdaptiveConcurrencyController(8);
    sampleLoad(controller, 48);
    sampleLoad(controller, 12, 500);
    const reducedLimit = controller.snapshot().limit;
    expect(reducedLimit).toBeLessThan(8);
    sampleLoad(controller, 100);
    expect(controller.snapshot().limit).toBe(8);
    controller.sample({ latencyMs: 1000, inFlight: 8, congested: true });
    sampleLoad(controller, 7);
    expect(controller.snapshot().limit).toBe(4);
    sampleLoad(controller, 64);
    expect(controller.snapshot().limit).toBe(8);
  });

  it("rebases after a lasting change to response latency", () => {
    const controller = new AdaptiveConcurrencyController(4);
    sampleLoad(controller, 16);
    sampleLoad(controller, 400, 400);
    expect(controller.snapshot().limit).toBe(4);
    sampleLoad(controller, 120, 100);
    expect(controller.snapshot().limit).toBe(4);
    expect(controller.snapshot().baselineMs).toBeCloseTo(100);
  });

  it("honors configured ceilings and immediately applies live changes", () => {
    const controller = new AdaptiveConcurrencyController(3);
    sampleLoad(controller, 200);
    expect(controller.snapshot().limit).toBe(3);
    controller.configure(1);
    expect(controller.snapshot()).toMatchObject({ limit: 1, maxLimit: 1 });
    sampleLoad(controller, 100);
    expect(controller.snapshot().limit).toBe(1);
    controller.configure(6);
    expect(controller.snapshot()).toMatchObject({ limit: 2, maxLimit: 6 });
    sampleLoad(controller, 100);
    expect(controller.snapshot().limit).toBe(6);
    controller.configure(4);
    expect(controller.snapshot()).toMatchObject({ limit: 4, maxLimit: 4 });
  });

  it("ignores invalid samples and sanitizes invalid maxima", () => {
    const controller = new AdaptiveConcurrencyController(8);
    const initial = controller.snapshot();
    for (const latencyMs of [0, -1, NaN, Infinity]) {
      controller.sample({ latencyMs, inFlight: 2 });
    }
    for (const inFlight of [-1, NaN, Infinity]) {
      controller.sample({ latencyMs: 100, inFlight });
    }
    expect(controller.snapshot()).toEqual(initial);
    for (const max of [0, -1, NaN, Infinity]) {
      expect(new AdaptiveConcurrencyController(max).snapshot()).toMatchObject({ limit: 1, maxLimit: 1 });
      controller.configure(max);
      expect(controller.snapshot()).toMatchObject({ limit: 1, maxLimit: 1 });
    }
    expect(new AdaptiveConcurrencyController(3.9).snapshot().maxLimit).toBe(3);
  });
});
