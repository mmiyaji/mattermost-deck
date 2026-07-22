import { describe, expect, it } from "vitest";
import {
  calculateResponsiveRailWidth,
  MAX_RESPONSIVE_RAIL_SHARE,
  MIN_MATTERMOST_WIDTH,
  MIN_RESPONSIVE_RAIL_WIDTH,
} from "./railLayout";

describe("calculateResponsiveRailWidth", () => {
  it("keeps the requested width when Mattermost has enough room", () => {
    expect(calculateResponsiveRailWidth(720, 1_920)).toBe(720);
  });

  it("reduces the rendered Deck width to preserve the Mattermost work area", () => {
    const railWidth = calculateResponsiveRailWidth(900, 1_200);

    expect(railWidth).toBe(480);
    expect(1_200 - railWidth).toBe(MIN_MATTERMOST_WIDTH);
  });

  it("uses the compact Deck floor when the full Mattermost minimum no longer fits", () => {
    expect(calculateResponsiveRailWidth(720, 900)).toBe(MIN_RESPONSIVE_RAIL_WIDTH);
  });

  it("keeps Mattermost at sixty percent on very narrow viewports", () => {
    const viewportWidth = 600;
    const railWidth = calculateResponsiveRailWidth(720, viewportWidth);

    expect(railWidth).toBe(viewportWidth * MAX_RESPONSIVE_RAIL_SHARE);
    expect(viewportWidth - railWidth).toBe(360);
  });

  it("does not enlarge a narrower user-selected Deck width", () => {
    expect(calculateResponsiveRailWidth(360, 1_920)).toBe(360);
  });

  it("restores the requested width after any number of responsive reductions", () => {
    const requestedWidth = 900;
    const viewportWidths = [1_800, 1_200, 1_000, 800, 1_000, 1_200, 1_800];

    expect(viewportWidths.map((viewportWidth) => (
      calculateResponsiveRailWidth(requestedWidth, viewportWidth)
    ))).toEqual([900, 480, 280, 280, 280, 480, 900]);
  });

  it("always allocates the remaining viewport width to Mattermost", () => {
    for (const viewportWidth of [2_400, 1_800, 1_200, 1_000, 900, 600, 320]) {
      const railWidth = calculateResponsiveRailWidth(1_400, viewportWidth);
      const mattermostWidth = viewportWidth - railWidth;

      expect(railWidth + mattermostWidth).toBe(viewportWidth);
      expect(railWidth).toBeLessThanOrEqual(viewportWidth);
      if (viewportWidth >= MIN_MATTERMOST_WIDTH + MIN_RESPONSIVE_RAIL_WIDTH) {
        expect(mattermostWidth).toBeGreaterThanOrEqual(MIN_MATTERMOST_WIDTH);
      } else {
        expect(railWidth).toBeLessThanOrEqual(viewportWidth * MAX_RESPONSIVE_RAIL_SHARE);
      }
    }
  });
});
