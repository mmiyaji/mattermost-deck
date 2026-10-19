import { describe, expect, it } from "vitest";
import {
  calculateThreadAwareRailLayout,
  calculateHostConstrainedRailLayout,
  clampUserRailWidth,
  COLLAPSED_RESPONSIVE_RAIL_WIDTH,
  calculateResponsiveRailWidth,
  MAX_RESPONSIVE_RAIL_SHARE,
  MIN_MANUAL_MATTERMOST_WIDTH,
  MIN_MATTERMOST_WIDTH,
  MIN_RESPONSIVE_RAIL_WIDTH,
  MIN_USABLE_COMPACT_RAIL_WIDTH,
  measureMattermostHostInsets,
} from "./railLayout";

describe("measureMattermostHostInsets", () => {
  it("uses the visible left and right gaps when the center overflows the root", () => {
    expect(measureMattermostHostInsets(
      { left: 0, right: 641, width: 641 },
      { left: 305, right: 690, width: 385 },
    )).toEqual({ baseChromeWidth: 305, minimumCenterWidth: 385 });
  });

  it("does not treat a normal flexible center width as its minimum", () => {
    expect(measureMattermostHostInsets(
      { left: 0, right: 1_024, width: 1_024 },
      { left: 305, right: 700, width: 395 },
    )).toEqual({ baseChromeWidth: 629 });
  });
});

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

  it("allows an explicit manual width to use the legacy 320px Mattermost safety area", () => {
    const railWidth = calculateResponsiveRailWidth(
      900,
      1_440,
      MIN_MANUAL_MATTERMOST_WIDTH,
    );

    expect(railWidth).toBe(900);
    expect(1_440 - railWidth).toBe(540);
  });

  it("still keeps 320px of Mattermost visible at the manual width boundary", () => {
    const railWidth = calculateResponsiveRailWidth(
      1_400,
      1_000,
      MIN_MANUAL_MATTERMOST_WIDTH,
    );

    expect(railWidth).toBe(680);
    expect(1_000 - railWidth).toBe(MIN_MANUAL_MATTERMOST_WIDTH);
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

describe("calculateThreadAwareRailLayout", () => {
  it("keeps the normal width when Mattermost has no visible right sidebar", () => {
    expect(calculateThreadAwareRailLayout(720, 1_920, {
      mattermostWidth: 1_200,
      centerWidth: 900,
      rightSidebarWidth: 0,
    })).toEqual({
      width: 720,
      mode: "normal",
    });
  });

  it("subtracts the full right-pane width so the pre-open center is preserved", () => {
    const viewportWidth = 2_400;
    const requestedWidth = 900;
    const baseChromeWidth = 289;
    const rightSidebarWidth = 500;
    const layout = calculateThreadAwareRailLayout(requestedWidth, viewportWidth, {
      mattermostWidth: viewportWidth - requestedWidth,
      centerWidth: viewportWidth - requestedWidth - baseChromeWidth,
      baseChromeWidth,
      rightSidebarWidth,
    });

    expect(layout).toEqual({
      width: 400,
      mode: "compact",
    });
    const centerBeforePane = viewportWidth - requestedWidth - baseChromeWidth;
    const centerAfterPane = (
      viewportWidth -
      layout.width -
      baseChromeWidth -
      rightSidebarWidth
    );
    expect(centerAfterPane).toBe(centerBeforePane);
  });

  it("uses 280px at the exact usable compact boundary", () => {
    expect(calculateThreadAwareRailLayout(780, 2_200, {
      mattermostWidth: 1_420,
      centerWidth: 631,
      rightSidebarWidth: 500,
      baseChromeWidth: 289,
    })).toEqual({
      width: MIN_RESPONSIVE_RAIL_WIDTH,
      mode: "compact",
    });
  });

  it("keeps a slightly narrower compact Deck near the collapse boundary", () => {
    expect(calculateThreadAwareRailLayout(779, 2_200, {
      mattermostWidth: 1_421,
      centerWidth: 632,
      rightSidebarWidth: 500,
      baseChromeWidth: 289,
    })).toEqual({ width: 279, mode: "compact" });
  });

  it("collapses at 1800px instead of reducing the original Mattermost center", () => {
    const layout = calculateThreadAwareRailLayout(560, 1_800, {
      mattermostWidth: 1_240,
      centerWidth: 951,
      rightSidebarWidth: 500,
      baseChromeWidth: 289,
    });

    expect(layout).toEqual({
      width: COLLAPSED_RESPONSIVE_RAIL_WIDTH,
      mode: "collapsed",
    });
    expect(1_800 - layout.width - 289 - 500).toBeGreaterThanOrEqual(951);
  });

  it("keeps one target while the opening pane reflows Mattermost internals", () => {
    const transientLayouts = [
      {
        mattermostWidth: 1_240,
        centerWidth: 951,
        rightSidebarWidth: 500,
        baseChromeWidth: 289,
      },
      {
        mattermostWidth: 1_400,
        centerWidth: 711,
        rightSidebarWidth: 500,
        baseChromeWidth: 289,
      },
      {
        mattermostWidth: 1_748,
        centerWidth: 959,
        rightSidebarWidth: 500,
        baseChromeWidth: 289,
      },
    ];

    expect(transientLayouts.map((hostLayout) => (
      calculateThreadAwareRailLayout(560, 1_800, hostLayout)
    ))).toEqual([
      { width: 52, mode: "collapsed" },
      { width: 52, mode: "collapsed" },
      { width: 52, mode: "collapsed" },
    ]);
  });

  it.each([
    { viewportWidth: 1_280, expectedWidth: 52 },
    { viewportWidth: 1_500, expectedWidth: 52 },
    { viewportWidth: 1_800, expectedWidth: 52 },
    { viewportWidth: 2_200, expectedWidth: 52 },
  ])(
    "keeps the center-preserving target $expectedWidth at a $viewportWidth viewport",
    ({ viewportWidth, expectedWidth }) => {
      const widths = [951, 711, 560].map((centerWidth) => (
        calculateThreadAwareRailLayout(720, viewportWidth, {
          mattermostWidth: Math.max(720, viewportWidth - 720),
          centerWidth,
          rightSidebarWidth: 500,
          baseChromeWidth: 289,
        }).width
      ));

      expect(widths).toEqual([
        expectedWidth,
        expectedWidth,
        expectedWidth,
      ]);
    },
  );

  it("subtracts a narrower 400px pane without collapsing a 720px Deck", () => {
    expect(calculateThreadAwareRailLayout(720, 1_600, {
      mattermostWidth: 880,
      centerWidth: 591,
      rightSidebarWidth: 400,
      baseChromeWidth: 289,
    })).toEqual({
      width: 320,
      mode: "compact",
    });
  });

  it("uses the measured pane width when center measurements are unavailable", () => {
    expect(calculateThreadAwareRailLayout(900, 1_600, {
      mattermostWidth: 0,
      centerWidth: 0,
      rightSidebarWidth: 400,
    })).toEqual({
      width: 480,
      mode: "compact",
    });
  });

  it("uses the normal responsive width as the subtraction baseline", () => {
    expect(calculateThreadAwareRailLayout(900, 1_600, {
      mattermostWidth: 720,
      centerWidth: 431,
      rightSidebarWidth: 400,
      baseChromeWidth: 289,
    })).toEqual({
      width: 480,
      mode: "compact",
    });
  });

  it("subtracts the pane from the wider manual responsive baseline", () => {
    expect(calculateThreadAwareRailLayout(
      900,
      1_440,
      {
        mattermostWidth: 540,
        centerWidth: 140,
        rightSidebarWidth: 400,
        baseChromeWidth: 0,
      },
      MIN_MANUAL_MATTERMOST_WIDTH,
    )).toEqual({
      width: 500,
      mode: "compact",
    });
  });

  it("never grows when the visible right pane becomes wider", () => {
    const widths = [100, 300, 500, 700].map((rightSidebarWidth) => (
      calculateThreadAwareRailLayout(900, 2_400, {
        mattermostWidth: 1_500,
        centerWidth: 1_500 - 289 - rightSidebarWidth,
        rightSidebarWidth,
      }).width
    ));

    expect(widths).toEqual([800, 600, 400, 52]);
    expect(widths).toEqual([...widths].sort((left, right) => right - left));
  });

  it("never returns a partial Deck below the compact safety floor", () => {
    for (const requestedWidth of [360, 480, 560, 720, 900, 1_400]) {
      for (const viewportWidth of [1_200, 1_600, 1_800, 2_200, 2_400]) {
        for (const rightSidebarWidth of [320, 400, 500, 600]) {
          const layout = calculateThreadAwareRailLayout(
            requestedWidth,
            viewportWidth,
            {
              mattermostWidth: Math.max(0, viewportWidth - requestedWidth),
              centerWidth: 0,
              rightSidebarWidth,
            },
          );
          const normalWidth = calculateResponsiveRailWidth(
            requestedWidth,
            viewportWidth,
          );

          expect(layout.width).toBeLessThanOrEqual(normalWidth);
          if (layout.mode === "collapsed") {
            expect(layout.width).toBe(
              Math.min(normalWidth, COLLAPSED_RESPONSIVE_RAIL_WIDTH),
            );
          } else {
            expect(layout.width).toBeGreaterThanOrEqual(
              MIN_USABLE_COMPACT_RAIL_WIDTH,
            );
          }
        }
      }
    }
  });

  it("keeps at least 320px of center visible for manual width overrides", () => {
    const layout = calculateHostConstrainedRailLayout(480, 1_200, {
      mattermostWidth: 800,
      centerWidth: 0,
      rightSidebarWidth: 400,
      baseChromeWidth: 289,
    }, MIN_MANUAL_MATTERMOST_WIDTH);

    expect(layout).toEqual({ width: COLLAPSED_RESPONSIVE_RAIL_WIDTH, mode: "collapsed" });
    expect(1_200 - layout.width - 289 - 400).toBeGreaterThanOrEqual(320);

    expect(calculateHostConstrainedRailLayout(480, 1_200, {
      mattermostWidth: 800,
      centerWidth: 500,
      rightSidebarWidth: 0,
      baseChromeWidth: 289,
    }, MIN_MANUAL_MATTERMOST_WIDTH)).toEqual({ width: 480, mode: "normal" });
  });

  it("reserves the center-content inset at the maximum manual width with an open RHS", () => {
    const layout = calculateHostConstrainedRailLayout(1_400, 1_920, {
      mattermostWidth: 1_120,
      centerWidth: 0,
      rightSidebarWidth: 500,
      baseChromeWidth: 289,
    }, MIN_MANUAL_MATTERMOST_WIDTH);
    const measuredCenterWidth = 1_920 - layout.width - 289 - 500;

    expect(layout).toEqual({ width: 795, mode: "compact" });
    expect(measuredCenterWidth).toBe(336);
    expect(measuredCenterWidth - 16).toBeGreaterThanOrEqual(320);
  });

  it("reserves an overflowing native center minimum during a manual resize", () => {
    const hostLayout = {
      mattermostWidth: 641,
      centerWidth: 385,
      minimumCenterWidth: 385,
      rightSidebarWidth: 0,
      baseChromeWidth: 305,
    };
    const layout = calculateHostConstrainedRailLayout(
      900,
      1_024,
      hostLayout,
      MIN_MANUAL_MATTERMOST_WIDTH,
    );

    expect(layout).toEqual({ width: 334, mode: "compact" });
    expect(1_024 - layout.width - 305).toBe(385);
  });

  it("restores the requested manual width when the same host has more viewport room", () => {
    const hostLayout = {
      mattermostWidth: 641,
      centerWidth: 385,
      minimumCenterWidth: 385,
      rightSidebarWidth: 0,
      baseChromeWidth: 305,
    };
    const widths = [1_024, 1_800].map((viewportWidth) => (
      calculateHostConstrainedRailLayout(
        900,
        viewportWidth,
        hostLayout,
        MIN_MANUAL_MATTERMOST_WIDTH,
      ).width
    ));

    expect(widths).toEqual([334, 900]);
  });

  it("keeps the learned center minimum while the RHS is open", () => {
    const layout = calculateHostConstrainedRailLayout(900, 1_800, {
      mattermostWidth: 1_195,
      centerWidth: 385,
      minimumCenterWidth: 385,
      rightSidebarWidth: 300,
      baseChromeWidth: 305,
    }, MIN_MANUAL_MATTERMOST_WIDTH);
    const centerWidth = 1_800 - layout.width - 305 - 300;

    expect(layout).toEqual({ width: 810, mode: "compact" });
    expect(centerWidth).toBe(385);
  });

  it("uses a conservative chrome reserve when the initial open RHS clips the center", () => {
    const layout = calculateHostConstrainedRailLayout(900, 1_600, {
      mattermostWidth: 900,
      centerWidth: 0,
      rightSidebarWidth: 400,
    });

    expect(layout).toEqual({ width: 480, mode: "compact" });
    expect(1_600 - layout.width - 320 - 400).toBe(400);
  });

  it("keeps the 1400 to 1399px boundary continuous with an open RHS", () => {
    const hostLayout = {
      mattermostWidth: 800,
      centerWidth: 0,
      rightSidebarWidth: 400,
      baseChromeWidth: 289,
    };
    const widths = [1_400, 1_399].map((viewportWidth) => (
      calculateThreadAwareRailLayout(720, viewportWidth, hostLayout).width
    ));

    expect(widths).toEqual([280, 279]);
  });

  it("keeps interactive compact widths continuous around 280px", () => {
    expect([275, 248].map((width) => clampUserRailWidth(width, 400))).toEqual([
      275,
      248,
    ]);
  });

  it("uses hysteresis when recovering from a collapsed pane layout", () => {
    const host = (rightSidebarWidth: number) => ({
      mattermostWidth: 1_200,
      centerWidth: 0,
      rightSidebarWidth,
      baseChromeWidth: 0,
    });

    expect(calculateThreadAwareRailLayout(720, 1_200, host(241))).toEqual({
      width: COLLAPSED_RESPONSIVE_RAIL_WIDTH,
      mode: "collapsed",
    });
    expect(calculateThreadAwareRailLayout(720, 1_200, host(220), 720, "collapsed")).toEqual({
      width: COLLAPSED_RESPONSIVE_RAIL_WIDTH,
      mode: "collapsed",
    });
    expect(calculateThreadAwareRailLayout(720, 1_200, host(208), 720, "collapsed")).toEqual({
      width: 272,
      mode: "compact",
    });
  });

  it("restores the exact normal width after the pane closes", () => {
    const requestedWidth = 560;
    const open = calculateThreadAwareRailLayout(requestedWidth, 1_800, {
      mattermostWidth: 1_240,
      centerWidth: 951,
      rightSidebarWidth: 500,
    });
    const closed = calculateThreadAwareRailLayout(requestedWidth, 1_800, {
      mattermostWidth: 1_240,
      centerWidth: 951,
      rightSidebarWidth: 0,
    });

    expect(open.mode).toBe("collapsed");
    expect(closed).toEqual({ width: requestedWidth, mode: "normal" });
  });
});
