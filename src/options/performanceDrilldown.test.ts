import { describe, expect, it } from "vitest";
import type { TraceLogEntry } from "../traceLog";
import { normalizePerformanceRequests, analyzePerformance } from "./performanceAnalysis";
import { EMPTY_REQUEST_FILTER, filterPerformanceRequests, PERFORMANCE_REQUEST_PAGE_SIZE } from "./performanceDrilldown";

const start = 1_700_000_040_000;
const entry = (id: string, timestamp: number, payload: Record<string, unknown>, event = "request.complete"): TraceLogEntry => ({ id, timestamp, source: "api", level: "info", event, payload });
const rows = () => normalizePerformanceRequests([
  entry("ok", start, { method: "GET", path: "/users/me", status: 200, durationMs: 10, queueWaitMs: 0 }),
  entry("limited", start + 59_999, { method: "POST", fullPath: "/teams/team/posts/search?term=me", status: 429, durationMs: 100, queueWaitMs: 80, reason: "mention-team-search" }),
  entry("network", start + 60_000, { method: "GET", path: "/channels/channel/posts", durationMs: 20_000, queueWaitMs: 0, error: "network timeout" }, "request.error"),
]);

describe("performance request drilldown", () => {
  it("keeps failed metric and filtered rows in agreement including transport failures", () => {
    const samples = rows();
    const failed = filterPerformanceRequests(samples, { ...EMPTY_REQUEST_FILTER, failedOnly: true });
    expect(failed.map(row => row.key)).toEqual(["network", "limited"]);
    expect(analyzePerformance(samples.map(row => row.entry)).failures).toBe(failed.length);
    expect(failed[0]).toMatchObject({ status: null, network: null, queueWait: 0, error: "network timeout" });
  });
  it("selects the precise chart minute and combines failure/status/query filters", () => {
    expect(filterPerformanceRequests(rows(), { ...EMPTY_REQUEST_FILTER, minuteStart: start }).map(row => row.key)).toEqual(["limited", "ok"]);
    expect(filterPerformanceRequests(rows(), { ...EMPTY_REQUEST_FILTER, minuteStart: start, failedOnly: true, status: "429", query: "MENTION-TEAM" }).map(row => row.key)).toEqual(["limited"]);
    expect(filterPerformanceRequests(rows(), { ...EMPTY_REQUEST_FILTER, minuteStart: start + 60_000 }).map(row => row.key)).toEqual(["network"]);
  });
  it("distinguishes unknown HTTP status from HTTP 0 or an invalid status", () => {
    const samples = normalizePerformanceRequests([
      entry("no-response", start, { status: 0 }, "request.error"),
      entry("invalid", start, { status: 999 }),
      entry("string", start, { status: "500" }),
      entry("http", start, { status: 500 }),
    ]);
    expect(samples.map(row => row.status)).toEqual([null, null, null, 500]);
    expect(samples.map(row => row.failed)).toEqual([true, false, false, true]);
    expect(filterPerformanceRequests(samples, { ...EMPTY_REQUEST_FILTER, failedOnly: true, status: "no-http" }).map(row => row.key)).toEqual(["no-response"]);
  });
  it("deduplicates identified events and excludes ancillary diagnostics", () => {
    const repeated = entry("same", start, { status: 500 });
    const samples = normalizePerformanceRequests([repeated, repeated, entry("rate", start, { waitMs: 100 }, "request.rate_limit_wait")]);
    expect(samples).toHaveLength(1);
    expect(analyzePerformance([repeated, repeated]).samples).toBe(1);
  });
  it("represents an empty result without inventing requests and caps rendered page size", () => {
    expect(filterPerformanceRequests([], EMPTY_REQUEST_FILTER)).toEqual([]);
    expect(filterPerformanceRequests(rows(), { ...EMPTY_REQUEST_FILTER, query: "missing" })).toEqual([]);
    expect(PERFORMANCE_REQUEST_PAGE_SIZE).toBe(50);
  });
});
