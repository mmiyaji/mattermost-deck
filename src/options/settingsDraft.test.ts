import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../ui/settings";
import { PERFORMANCE_DEFAULTS, PERFORMANCE_LIMITS, type PerformanceSettings } from "../performanceSettings";
import { hasSettingsChanges } from "./settingsDraft";

describe("performance settings drafts", () => {
  it("tracks every performance field and clears dirty state after accepting a save", () => {
    for (const key of Object.keys(PERFORMANCE_DEFAULTS) as (keyof PerformanceSettings)[]) {
      const draft = { ...DEFAULT_SETTINGS, [key]: PERFORMANCE_LIMITS[key].max };
      expect(hasSettingsChanges(draft, DEFAULT_SETTINGS), key).toBe(true);
      expect(hasSettingsChanges(draft, { ...draft }), key).toBe(false);
    }
  });

  it("restores performance defaults while retaining unrelated edits", () => {
    const draft = { ...DEFAULT_SETTINGS, apiMaxConcurrentRequests: 8, highlightKeywords: "important" };
    const restored = { ...draft, ...PERFORMANCE_DEFAULTS };
    expect(restored.apiMaxConcurrentRequests).toBe(PERFORMANCE_DEFAULTS.apiMaxConcurrentRequests);
    expect(restored.highlightKeywords).toBe("important");
    expect(hasSettingsChanges(restored, DEFAULT_SETTINGS)).toBe(true);
    expect(hasSettingsChanges(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toBe(false);
  });
});
