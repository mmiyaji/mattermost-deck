import type { PerformanceRequest } from "./performanceAnalysis";

export interface PerformanceRequestFilter {
  failedOnly: boolean;
  minuteStart: number | null;
  minuteEnd?: number;
  status: string;
  query: string;
}
export const EMPTY_REQUEST_FILTER: PerformanceRequestFilter = { failedOnly: false, minuteStart: null, status: "all", query: "" };
export const PERFORMANCE_REQUEST_PAGE_SIZE = 50;

/** The bucket interval is half-open, exactly like the charts' aggregate model. */
export function filterPerformanceRequests(requests: PerformanceRequest[], filter: PerformanceRequestFilter): PerformanceRequest[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return requests.filter(request => {
    if (filter.failedOnly && !request.failed) return false;
    if (filter.minuteStart !== null && (request.entry.timestamp < filter.minuteStart || request.entry.timestamp >= (filter.minuteEnd ?? filter.minuteStart + 60_000))) return false;
    if (filter.status === "no-http" ? request.status !== null : filter.status !== "all" && String(request.status) !== filter.status) return false;
    return !query || [request.path, request.method, request.reason, request.error, request.purpose, request.priority].some(value => value.toLocaleLowerCase().includes(query));
  }).sort((first, second) => second.entry.timestamp - first.entry.timestamp);
}
