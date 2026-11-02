import { describe, expect, it } from "vitest";
import { isInitialPostWindow } from "./postListWindow";

describe("initial post viewport", () => {
  it.each([false, true])("renders only a bounded newest edge before observers (compact=%s)", compact => {
    for (const reversed of [false, true]) {
      const selected = Array.from({ length: 500 }, (_, index) => index).filter(index => isInitialPostWindow(index, 500, compact, 0, reversed));
      expect(selected.length).toBeGreaterThan(4);
      expect(selected.length).toBeLessThanOrEqual(compact ? 80 : 24);
      expect(selected).toContain(reversed ? 499 : 0);
      expect(selected).not.toContain(reversed ? 0 : 499);
    }
  });
  it("caps initial work for exceptionally tall viewports and handles short feeds", () => {
    expect(Array.from({ length: 500 }, (_, index) => index).filter(index => isInitialPostWindow(index, 500, false, 100_000, false))).toHaveLength(24);
    expect([0, 1, 2].every(index => isInitialPostWindow(index, 3, false, 600, true))).toBe(true);
  });
});
