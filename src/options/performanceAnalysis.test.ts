import { describe, expect, it } from "vitest";
import { analyzePerformance } from "./performanceAnalysis";
import type { TraceLogEntry } from "../traceLog";

const request = (payload: Record<string, unknown>, timestamp = 1_700_000_000_000, event = "request.complete"): TraceLogEntry => ({ timestamp, source: "api", level: "info", event, payload });
describe("retained performance analysis", () => {
  it("separates queue wait from total duration and flags queue dominance", () => {
    const a = analyzePerformance([request({ durationMs: 1500, queueWaitMs: 1200, queueDepth: 41 })]);
    expect(a).toMatchObject({ total: 1500, wait: 1200, network: 300, status: "queue", peakOutstanding: 41 });
    expect(a.buckets.at(-1)).toMatchObject({ count: 1, wait: 1200, network: 300 });
  });
  it("counts transport failures alongside HTTP failures without double counting ancillary logs", () => {
    const a = analyzePerformance([
      request({ durationMs: 100, queueWaitMs: 0, failed: true, status: 429 }),
      request({ durationMs: 200, queueWaitMs: 0 }, undefined, "request.error"),
      request({ waitMs: 100 }, undefined, "request.rate_limit_wait"),
    ]);
    expect(a).toMatchObject({ samples: 2, failures: 2, status: "errors", pairedSamples: 1, rateWaits: 1 });
    expect(a.buckets.at(-1)).toMatchObject({ count: 2, errors: 2 });
  });
  it("does not interpret missing or invalid timing as a zero-latency success", () => {
    expect(analyzePerformance([])).toMatchObject({ status: "empty", total: null, peakOutstanding: null });
    expect(analyzePerformance([request({ durationMs: 2500 })])).toMatchObject({ status: "unknown", wait: null, network: null });
    expect(analyzePerformance([request({ durationMs: 100, queueWaitMs: 300 })])).toMatchObject({ pairedSamples: 0, status: "unknown" });
  });
  it("uses the last retained record for time buckets and leaves gaps unmeasured", () => {
    const a = analyzePerformance([request({ durationMs: 1500, queueWaitMs: 100 })]);
    expect(a.status).toBe("network");
    expect(a.buckets[0]).toMatchObject({ count: 0, wait: null, network: null });
    expect(a.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });
});
