export interface PerformanceSettings {
  apiMaxConcurrentRequests: number;
  apiMinStartGapMs: number;
  apiGlobalRequestsPerMinute: number;
  apiGetRequestsPerMinute: number;
  apiPostRequestsPerMinute: number;
  apiRequestTimeoutSeconds: number;
  apiQueueTimeoutSeconds: number;
  mentionThreadCacheSeconds: number;
  mentionReconcileMinIntervalSeconds: number;
  mentionFullScanIntervalSeconds: number;
  mentionTeamConcurrency: number;
}

export const PERFORMANCE_DEFAULTS: PerformanceSettings = {
  apiMaxConcurrentRequests: 3,
  apiMinStartGapMs: 120,
  apiGlobalRequestsPerMinute: 180,
  apiGetRequestsPerMinute: 150,
  apiPostRequestsPerMinute: 45,
  apiRequestTimeoutSeconds: 20,
  apiQueueTimeoutSeconds: 30,
  mentionThreadCacheSeconds: 60,
  mentionReconcileMinIntervalSeconds: 10,
  mentionFullScanIntervalSeconds: 120,
  mentionTeamConcurrency: 2,
};

export const PERFORMANCE_LIMITS: Record<keyof PerformanceSettings, { min: number; max: number }> = {
  apiMaxConcurrentRequests: { min: 1, max: 8 },
  apiMinStartGapMs: { min: 0, max: 2000 },
  apiGlobalRequestsPerMinute: { min: 30, max: 1200 },
  apiGetRequestsPerMinute: { min: 15, max: 1200 },
  apiPostRequestsPerMinute: { min: 10, max: 600 },
  apiRequestTimeoutSeconds: { min: 5, max: 60 },
  apiQueueTimeoutSeconds: { min: 10, max: 120 },
  mentionThreadCacheSeconds: { min: 10, max: 600 },
  mentionReconcileMinIntervalSeconds: { min: 1, max: 120 },
  mentionFullScanIntervalSeconds: { min: 30, max: 1800 },
  mentionTeamConcurrency: { min: 1, max: 4 },
};

export function normalizePerformanceSettings(input: Partial<Record<keyof PerformanceSettings, unknown>> = {}): PerformanceSettings {
  const result = { ...PERFORMANCE_DEFAULTS };
  for (const key of Object.keys(result) as (keyof PerformanceSettings)[]) {
    const raw = input[key];
    const value = typeof raw === "number" || (typeof raw === "string" && raw.trim()) ? Number(raw) : NaN;
    const { min, max } = PERFORMANCE_LIMITS[key];
    result[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : PERFORMANCE_DEFAULTS[key];
  }
  return result;
}
