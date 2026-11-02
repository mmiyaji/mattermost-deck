import { describe, expect, it } from "vitest";
import { AdaptiveConcurrencyController } from "./adaptiveConcurrency.js";

function sampleLoad(controller: AdaptiveConcurrencyController, count: number, latencyMs = 100): void {
  for (let i = 0; i < count; i += 1) {
    controller.sample({ latencyMs, inFlight: controller.snapshot().limit });
  }
}

describe("AdaptiveConcurrencyController", () => {
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
