import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_DEFAULTS,
  PERFORMANCE_LIMITS,
  RESPONSIVE_PERFORMANCE_PRESET,
  normalizePerformanceSettings,
  type PerformanceSettings,
} from "./performanceSettings";

describe("responsive performance preset", () => {
  it("provides relaxed rates within the supported normalized limits", () => {
    expect(RESPONSIVE_PERFORMANCE_PRESET).toEqual({
      apiGlobalRequestsPerMinute: 360,
      apiGetRequestsPerMinute: 300,
      apiPostRequestsPerMinute: 90,
      apiMinStartGapMs: 60,
    });
    const normalized = normalizePerformanceSettings(RESPONSIVE_PERFORMANCE_PRESET);
    for (const [key, value] of Object.entries(RESPONSIVE_PERFORMANCE_PRESET)) {
      const field = key as keyof PerformanceSettings;
      expect(normalized[field]).toBe(value);
      expect(value).toBeGreaterThanOrEqual(PERFORMANCE_LIMITS[field].min);
      expect(value).toBeLessThanOrEqual(PERFORMANCE_LIMITS[field].max);
    }
    expect(normalized.apiMaxConcurrentRequests).toBe(3);
  });

  it("preserves custom values outside its four rate fields", () => {
    const custom = { ...PERFORMANCE_DEFAULTS };
    for (const field of Object.keys(PERFORMANCE_LIMITS) as (keyof PerformanceSettings)[]) {
      custom[field] = PERFORMANCE_LIMITS[field].max;
    }
    const normalized = normalizePerformanceSettings({ ...custom, ...RESPONSIVE_PERFORMANCE_PRESET });
    for (const field of Object.keys(PERFORMANCE_DEFAULTS) as (keyof PerformanceSettings)[]) {
      expect(normalized[field]).toBe(RESPONSIVE_PERFORMANCE_PRESET[field] ?? custom[field]);
    }
    expect(PERFORMANCE_DEFAULTS.apiMaxConcurrentRequests).toBe(3);
    expect(PERFORMANCE_DEFAULTS.apiGlobalRequestsPerMinute).toBe(180);
  });
});
