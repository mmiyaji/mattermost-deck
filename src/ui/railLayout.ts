export const MIN_MATTERMOST_WIDTH = 720;
export const MIN_MANUAL_MATTERMOST_WIDTH = 320;
export const MIN_RESPONSIVE_RAIL_WIDTH = 280;
export const MIN_USABLE_COMPACT_RAIL_WIDTH = 240;
export const MAX_RESPONSIVE_RAIL_SHARE = 0.4;
export const COLLAPSED_RESPONSIVE_RAIL_WIDTH = 52;
const MIN_VISIBLE_CENTER_WIDTH = 320;
const CENTER_CONTENT_INSET_ALLOWANCE = 16;
const FALLBACK_BASE_CHROME_WIDTH = 320;
const COLLAPSE_HYSTERESIS_PX = 32;
const CENTER_OVERFLOW_TOLERANCE_PX = 2;

export type ResponsiveRailMode = "normal" | "compact" | "collapsed";

export interface MattermostHostLayout {
  mattermostWidth: number;
  centerWidth: number;
  /** Native center minimum learned only when its rendered box overflows the root. */
  minimumCenterWidth?: number;
  rightSidebarWidth: number;
  /**
   * Width occupied by Mattermost chrome outside its center and RHS. This is
   * retained from the closed-pane baseline when the open pane clips the center.
   */
  baseChromeWidth?: number;
  rightSidebarOpen?: boolean;
  rootReportsRightSidebarOpen?: boolean;
}

export interface HostLayoutRect {
  left: number;
  right: number;
  width: number;
}

export interface MattermostHostInsets {
  baseChromeWidth: number;
  minimumCenterWidth?: number;
}

/**
 * Measures chrome from the center's horizontal insets. When the center
 * overflows the root, its rendered width is evidence of a native minimum.
 */
export function measureMattermostHostInsets(
  root: HostLayoutRect,
  center: HostLayoutRect,
): MattermostHostInsets {
  const leftInset = Math.max(0, center.left - root.left);
  const rightInset = Math.max(0, root.right - center.right);
  const centerOverflow = center.right - root.right;
  return {
    baseChromeWidth: Math.round(leftInset + rightInset),
    ...(centerOverflow > CENTER_OVERFLOW_TOLERANCE_PX && center.width > 0
      ? { minimumCenterWidth: Math.round(center.width) }
      : {}),
  };
}

export interface ResponsiveRailLayout {
  width: number;
  mode: ResponsiveRailMode;
}

export function clampUserRailWidth(nextWidth: number, maximumWidth: number): number {
  const normalizedWidth = Math.max(
    MIN_USABLE_COMPACT_RAIL_WIDTH,
    Number.isFinite(nextWidth)
      ? Math.round(nextWidth)
      : MIN_USABLE_COMPACT_RAIL_WIDTH,
  );
  return maximumWidth < MIN_USABLE_COMPACT_RAIL_WIDTH
    ? COLLAPSED_RESPONSIVE_RAIL_WIDTH
    : Math.min(normalizedWidth, maximumWidth);
}

function getBaseChromeWidth(hostLayout: MattermostHostLayout): number {
  if (
    hostLayout.baseChromeWidth !== undefined &&
    Number.isFinite(hostLayout.baseChromeWidth) &&
    hostLayout.baseChromeWidth >= 0
  ) {
    return Math.round(hostLayout.baseChromeWidth!);
  }
  // When the RHS clips the center completely there is no useful center box
  // from which to infer the app bar and left sidebar. Reserve a conservative
  // chrome width until a settled, un-clipped measurement becomes available.
  return hostLayout.mattermostWidth > 0 ? FALLBACK_BASE_CHROME_WIDTH : 0;
}

function getMaximumRailWidth(
  viewportWidth: number,
  hostLayout: MattermostHostLayout,
  minimumMattermostWidth: number,
): number {
  const chromeWidth = getBaseChromeWidth(hostLayout);
  const minimumCenterWidth = Math.max(
    // The measured center box includes its inner padding; reserve an extra
    // 16px so the usable content area still reaches the 320px target.
    MIN_VISIBLE_CENTER_WIDTH + CENTER_CONTENT_INSET_ALLOWANCE,
    Math.max(0, minimumMattermostWidth - chromeWidth),
    Number.isFinite(hostLayout.minimumCenterWidth)
      ? Math.max(0, Math.round(hostLayout.minimumCenterWidth!))
      : 0,
  );
  const rhsWidth = Number.isFinite(hostLayout.rightSidebarWidth)
    ? Math.max(0, Math.round(hostLayout.rightSidebarWidth))
    : 0;
  return Math.max(
    0,
    Math.floor(viewportWidth) - chromeWidth - rhsWidth - minimumCenterWidth,
  );
}

function constrainToHost(
  requestedWidth: number,
  viewportWidth: number,
  hostLayout: MattermostHostLayout,
  minimumMattermostWidth: number,
  previousMode: ResponsiveRailMode = "normal",
): ResponsiveRailLayout {
  const normalWidth = calculateResponsiveRailWidth(
    requestedWidth,
    viewportWidth,
    minimumMattermostWidth,
  );
  const maximumWidth = getMaximumRailWidth(
    Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0,
    hostLayout,
    minimumMattermostWidth,
  );
  const width = Math.min(normalWidth, maximumWidth);
  const collapseThreshold = MIN_USABLE_COMPACT_RAIL_WIDTH +
    (previousMode === "collapsed" ? COLLAPSE_HYSTERESIS_PX : 0);
  if (width < collapseThreshold) {
    return {
      width: Math.min(normalWidth, COLLAPSED_RESPONSIVE_RAIL_WIDTH),
      mode: "collapsed",
    };
  }
  return {
    width,
    mode: width < normalWidth ? "compact" : "normal",
  };
}

/** Applies viewport, Mattermost chrome, RHS, and visible-center limits while
 * retaining the user's requested width for future restoration. */
export function calculateHostConstrainedRailLayout(
  requestedWidth: number,
  viewportWidth: number,
  hostLayout: MattermostHostLayout,
  minimumMattermostWidth = MIN_MATTERMOST_WIDTH,
  previousMode: ResponsiveRailMode = "normal",
): ResponsiveRailLayout {
  return constrainToHost(
    requestedWidth,
    viewportWidth,
    hostLayout,
    minimumMattermostWidth,
    previousMode,
  );
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
  previousMode: ResponsiveRailMode = "normal",
): ResponsiveRailLayout {
  const rightSidebarWidth = Number.isFinite(hostLayout.rightSidebarWidth)
    ? Math.max(0, Math.round(hostLayout.rightSidebarWidth))
    : 0;

  const normalWidth = calculateResponsiveRailWidth(
    requestedWidth,
    viewportWidth,
    minimumMattermostWidth,
  );
  if (rightSidebarWidth <= 0) {
    return constrainToHost(
      requestedWidth,
      viewportWidth,
      hostLayout,
      minimumMattermostWidth,
      previousMode,
    );
  }

  const desiredWidth = Math.max(0, normalWidth - rightSidebarWidth);
  const maximumWidth = getMaximumRailWidth(
    Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0,
    hostLayout,
    minimumMattermostWidth,
  );
  const width = Math.min(desiredWidth, maximumWidth);
  const collapseThreshold = MIN_USABLE_COMPACT_RAIL_WIDTH +
    (previousMode === "collapsed" ? COLLAPSE_HYSTERESIS_PX : 0);
  if (width < collapseThreshold) {
    return {
      width: Math.min(normalWidth, COLLAPSED_RESPONSIVE_RAIL_WIDTH),
      mode: "collapsed",
    };
  }
  return { width, mode: width < normalWidth ? "compact" : "normal" };
}
