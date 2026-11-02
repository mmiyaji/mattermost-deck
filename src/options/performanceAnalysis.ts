import type { TraceLogEntry } from "../traceLog";

export function analyzePerformance(entries: TraceLogEntry[]) {
  const requests = entries.filter(e => e.source === "api" && (e.event === "request.complete" || e.event === "request.error"));
  const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const samples = requests.map(e => {
    const total = number(e.payload?.durationMs);
    const wait = number(e.payload?.queueWaitMs);
    // A request that failed before starting has no measured network duration.
    const paired = total !== null && wait !== null && wait <= total && e.event !== "request.error";
    return { entry: e, total, wait: paired ? wait : null, network: paired ? total - wait : null,
      failed: e.event === "request.error" || e.payload?.failed === true || Number(e.payload?.status) >= 400 };
  });
  const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const totals = samples.flatMap(s => s.total === null ? [] : [s.total]).sort((a, b) => a - b);
  const paired = samples.filter(s => s.network !== null);
  const wait = avg(paired.map(s => s.wait!));
  const network = avg(paired.map(s => s.network!));
  const failures = samples.filter(s => s.failed).length;
  const rateWaits = entries.filter(e => e.source === "api" && e.event === "request.rate_limit_wait");
  const end = entries.length ? Math.max(...entries.map(e => e.timestamp)) : null;
  // Anchor to the latest retained record so paused recordings remain inspectable.
  const bucketEnd = end === null ? 0 : (Math.floor(end / 60_000) + 1) * 60_000;
  const buckets = Array.from({ length: 20 }, (_, i) => {
    const start = bucketEnd - (20 - i) * 60_000;
    const rows = samples.filter(s => s.entry.timestamp >= start && s.entry.timestamp < start + 60_000);
    const pairs = rows.filter(s => s.network !== null);
    return { start, count: rows.length, errors: rows.filter(s => s.failed).length,
      wait: avg(pairs.map(s => s.wait!)), network: avg(pairs.map(s => s.network!)) };
  });
  const status: "empty" | "errors" | "queue" | "network" | "clear" | "unknown" = !samples.length ? "empty" : failures ? "errors" : !paired.length ? "unknown" : wait !== null && wait >= 500 && wait > (network ?? 0) ? "queue" : network !== null && network >= 1000 ? "network" : "clear";
  const depths = requests.flatMap(e => { const depth = number(e.payload?.queueDepth); return depth === null ? [] : [depth]; });
  return { samples: samples.length, pairedSamples: paired.length, failures, wait, network,
    total: avg(totals), p95: totals.length ? totals[Math.ceil(totals.length * .95) - 1] : null,
    rateWaits: rateWaits.length, status,
    peakOutstanding: depths.length ? Math.max(...depths) : null,
    start: entries.length ? Math.min(...entries.map(e => e.timestamp)) : null, end, buckets };
}
