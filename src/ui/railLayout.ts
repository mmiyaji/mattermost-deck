export const MIN_MATTERMOST_WIDTH = 720;
export const MIN_MANUAL_MATTERMOST_WIDTH = 320;
export const MIN_RESPONSIVE_RAIL_WIDTH = 280;
export const MAX_RESPONSIVE_RAIL_SHARE = 0.4;
export const COLLAPSED_RESPONSIVE_RAIL_WIDTH = 52;

export type ResponsiveRailMode = "normal" | "compact" | "collapsed";

export interface MattermostHostLayout {
  mattermostWidth: number;
  centerWidth: number;
  rightSidebarWidth: number;
  /**
   * Diagnostic width occupied by Mattermost chrome outside the center and
   * RHS. Automatic Deck sizing deliberately does not depend on this value.
   */
  baseChromeWidth?: number;
  rightSidebarOpen?: boolean;
  rootReportsRightSidebarOpen?: boolean;
}

export interface ResponsiveRailLayout {
  width: number;
  mode: ResponsiveRailMode;
}

/**
 * Keeps the requested Deck width while there is room, then reduces only the
 * rendered width so Mattermost retains a useful working area. The requested
 * width can therefore be restored when the browser becomes wide again.
 * Automatic preferred sizing uses the 720px default; an explicit manual
 * resize supplies the legacy 320px safety area instead.
 */
export function calculateResponsiveRailWidth(
  requestedWidth: number,
  viewportWidth: number,
  minimumMattermostWidth = MIN_MATTERMOST_WIDTH,
): number {
  const safeRequestedWidth = Number.isFinite(requestedWidth) ? Math.max(0, Math.round(requestedWidth)) : 0;
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, Math.floor(viewportWidth)) : 0;
  const safeMinimumMattermostWidth = Number.isFinite(minimumMattermostWidth)
    ? Math.max(0, Math.floor(minimumMattermostWidth))
    : MIN_MATTERMOST_WIDTH;
  const responsiveFloor = Math.min(
    MIN_RESPONSIVE_RAIL_WIDTH,
    Math.floor(safeViewportWidth * MAX_RESPONSIVE_RAIL_SHARE),
  );
  const maximumWidth = Math.max(
    responsiveFloor,
    safeViewportWidth - safeMinimumMattermostWidth,
  );

  return Math.min(safeRequestedWidth, maximumWidth);
}

/**
 * Applies an additional, temporary constraint while Mattermost's native
 * right-hand pane is visible. Deck gives the pane exactly the width it needs,
 * so Mattermost's center keeps the width it had before the pane opened:
 *
 *   open center = viewport - (normal Deck - RHS) - base chrome - RHS
 *               = viewport - normal Deck - base chrome
 *
 * If that subtraction would leave a Deck narrower than its usable compact
 * width, Deck collapses to its 52 px rail instead of keeping a partial panel
 * that would still reduce the original Mattermost center. The requested width
 * remains untouched so it can be restored when the pane closes.
 */
export function calculateThreadAwareRailLayout(
  requestedWidth: number,
  viewportWidth: number,
  hostLayout: MattermostHostLayout,
  minimumMattermostWidth = MIN_MATTERMOST_WIDTH,
): ResponsiveRailLayout {
  const normalWidth = calculateResponsiveRailWidth(
    requestedWidth,
    viewportWidth,
    minimumMattermostWidth,
  );
  const rightSidebarWidth = Number.isFinite(hostLayout.rightSidebarWidth)
    ? Math.max(0, Math.round(hostLayout.rightSidebarWidth))
    : 0;

  if (rightSidebarWidth <= 0) {
    return { width: normalWidth, mode: "normal" };
  }

  const widthAfterPane = Math.max(0, normalWidth - rightSidebarWidth);
  if (widthAfterPane < MIN_RESPONSIVE_RAIL_WIDTH) {
    return {
      width: Math.min(normalWidth, COLLAPSED_RESPONSIVE_RAIL_WIDTH),
      mode: "collapsed",
    };
  }

  return {
    width: widthAfterPane,
    mode: widthAfterPane < normalWidth ? "compact" : "normal",
  };
}
