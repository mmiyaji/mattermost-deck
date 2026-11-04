import type { TraceLogEntry } from "../traceLog";
import { PERFORMANCE_PRESETS, type PerformanceSettings } from "../performanceSettings";

export interface PerformanceRequest {
  key: string;
  entry: TraceLogEntry;
  total: number | null;
  wait: number | null;
  queueWait: number | null;
  network: number | null;
  failed: boolean;
  status: number | null;
  method: string;
  path: string;
  reason: string;
  error: string;
  purpose: string;
  priority: string;
}
const metricNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const text = (value: unknown): string => typeof value === "string" ? value : "";

/** One model drives both aggregate counts and request-level inspection. */
export function normalizePerformanceRequests(entries: TraceLogEntry[]): PerformanceRequest[] {
  const seen = new Set<string>();
  return entries.flatMap((entry, index) => {
    if (entry.source !== "api" || !["request.complete", "request.error"].includes(entry.event)) return [];
    if (entry.id && seen.has(entry.id)) return [];
    if (entry.id) seen.add(entry.id);
    const total = metricNumber(entry.payload?.durationMs);
    const wait = metricNumber(entry.payload?.queueWaitMs);
    const paired = total !== null && wait !== null && wait <= total && entry.event !== "request.error";
    const rawStatus = entry.payload?.status;
    const status = typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null;
    return [{ key: entry.id ?? `${entry.timestamp}:${entry.event}:${index}`, entry, total,
      wait: paired ? wait : null, queueWait: wait, network: paired ? total - wait : null,
      failed: entry.event === "request.error" || entry.payload?.failed === true || (status !== null && status >= 400),
      status, method: text(entry.payload?.method) || "—", path: text(entry.payload?.fullPath) || text(entry.payload?.path) || "—",
      reason: text(entry.payload?.reason), error: text(entry.payload?.error), purpose: text(entry.payload?.purpose), priority: text(entry.payload?.priority) }];
  });
}

export function analyzePerformance(entries: TraceLogEntry[]) {
  const samples = normalizePerformanceRequests(entries);
  const requests = samples.map(sample => sample.entry);
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
  const depths = requests.flatMap(e => { const depth = metricNumber(e.payload?.queueDepth); return depth === null ? [] : [depth]; });
  return { samples: samples.length, pairedSamples: paired.length, failures, wait, network,
    total: avg(totals), p95: totals.length ? totals[Math.ceil(totals.length * .95) - 1] : null,
    rateWaits: rateWaits.length, status,
    peakOutstanding: depths.length ? Math.max(...depths) : null,
    start: entries.length ? Math.min(...entries.map(e => e.timestamp)) : null, end, buckets };
}

/** Conservative advice only from a fresh, paired, sufficiently broad request sample. */
export function recommendPerformanceDraft(entries: TraceLogEntry[], now = Date.now()): { preset: "low" | "high"; count: number; waitMs: number; rateWaits: number; values: PerformanceSettings } | null {
  const samples = normalizePerformanceRequests(entries);
  const paired = samples.filter(sample => sample.network !== null);
  const start = paired.length ? Math.min(...paired.map(sample => sample.entry.timestamp)) : null;
  const end = paired.length ? Math.max(...paired.map(sample => sample.entry.timestamp)) : null;
  if (paired.length < 10 || start === null || end === null || end - start < 120_000 || now - end > 24 * 60 * 60_000 || end > now + 60_000) return null;
  // Client rate-limit waits are distinct from HTTP 429 and can support a bounded increase when transport is healthy.
  if (samples.some(sample => sample.failed || sample.status === 429)) return null;
  const waits = paired.map(sample => sample.wait!).sort((a, b) => a - b);
  const networks = paired.map(sample => sample.network!).sort((a, b) => a - b);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const waitMs = mean(waits);
  const rateWaits = entries.filter(entry => entry.source === "api" && entry.event === "request.rate_limit_wait").length;
  const slowNetwork = networks[Math.ceil(networks.length * .95) - 1] >= 1000;
  const queueHeavy = waitMs >= 500 && waitMs > mean(networks);
  const preset = slowNetwork ? "low" : queueHeavy ? "high" : null;
  if (!preset) return null;
  return { preset, count: paired.length, waitMs: Math.round(waitMs), rateWaits, values: PERFORMANCE_PRESETS[preset] };
}
