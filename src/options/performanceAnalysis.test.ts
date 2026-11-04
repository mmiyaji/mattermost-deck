import { describe, expect, it } from "vitest";
import { analyzePerformance, recommendPerformanceDraft } from "./performanceAnalysis";
import { PERFORMANCE_PRESETS } from "../performanceSettings";
import type { TraceLogEntry } from "../traceLog";

const request = (payload: Record<string, unknown>, timestamp = 1_700_000_000_000, event = "request.complete"): TraceLogEntry => ({ timestamp, source: "api", level: "info", event, payload });
describe("retained performance analysis", () => {
  it("suggests a bounded High preset for fresh queue or client rate waits with healthy network", () => {
    const now = 1_700_000_600_000;
    const rows = Array.from({ length: 12 }, (_, index) => request({ durationMs: 700, queueWaitMs: 600 }, now - 180_000 + index * 15_000));
    rows.push(request({ waitMs: 500 }, now - 30_000, "request.rate_limit_wait"));
    const advice = recommendPerformanceDraft(rows, now);
    expect(advice).toMatchObject({ preset: "high", count: 12, rateWaits: 1, values: PERFORMANCE_PRESETS.high });
  });
  it("suggests Standard for slow network response, without recommending more load", () => {
    const now = 1_700_000_600_000;
    const rows = Array.from({ length: 12 }, (_, index) => request({ durationMs: 1800, queueWaitMs: 50 }, now - 180_000 + index * 15_000));
    expect(recommendPerformanceDraft(rows, now)).toMatchObject({ preset: "low", values: PERFORMANCE_PRESETS.low });
  });
  it("withholds tuning advice for HTTP 429, errors, too few samples, or stale samples", () => {
    const now = 1_700_000_600_000;
    const rows = Array.from({ length: 12 }, (_, index) => request({ durationMs: 700, queueWaitMs: 600 }, now - 180_000 + index * 15_000));
    expect(recommendPerformanceDraft(rows.slice(0, 8), now)).toBeNull();
    expect(recommendPerformanceDraft(rows.map((row, index) => index === 0 ? { ...row, payload: { ...row.payload, status: 429 } } : row), now)).toBeNull();
    expect(recommendPerformanceDraft(rows.map((row, index) => index === 0 ? { ...row, event: "request.error" } : row), now)).toBeNull();
    expect(recommendPerformanceDraft(rows, now + 25 * 60 * 60_000)).toBeNull();
  });
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
