export const MIN_MATTERMOST_WIDTH = 720;
export const MIN_MATTERMOST_CENTER_WIDTH = 560;
export const MIN_RESPONSIVE_RAIL_WIDTH = 280;
export const MAX_RESPONSIVE_RAIL_SHARE = 0.4;
export const THREAD_COMPACT_RAIL_WIDTH = 360;
export const COLLAPSED_RESPONSIVE_RAIL_WIDTH = 52;

export type ResponsiveRailMode = "normal" | "compact" | "collapsed";

export interface MattermostHostLayout {
  mattermostWidth: number;
  centerWidth: number;
  rightSidebarWidth: number;
}

export interface ResponsiveRailLayout {
  width: number;
  mode: ResponsiveRailMode;
}

/**
 * Keeps the requested Deck width while there is room, then reduces only the
 * rendered width so Mattermost retains a useful working area. The requested
 * width can therefore be restored when the browser becomes wide again.
 */
export function calculateResponsiveRailWidth(requestedWidth: number, viewportWidth: number): number {
  const safeRequestedWidth = Number.isFinite(requestedWidth) ? Math.max(0, Math.round(requestedWidth)) : 0;
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, Math.floor(viewportWidth)) : 0;
  const responsiveFloor = Math.min(
    MIN_RESPONSIVE_RAIL_WIDTH,
    Math.floor(safeViewportWidth * MAX_RESPONSIVE_RAIL_SHARE),
  );
  const maximumWidth = Math.max(responsiveFloor, safeViewportWidth - MIN_MATTERMOST_WIDTH);

  return Math.min(safeRequestedWidth, maximumWidth);
}

/**
 * Applies an additional, temporary constraint while Mattermost's native
 * right-hand sidebar is visible. The requested width remains untouched so it
 * can be restored when the sidebar closes.
 */
export function calculateThreadAwareRailLayout(
  requestedWidth: number,
  viewportWidth: number,
  hostLayout: MattermostHostLayout,
): ResponsiveRailLayout {
  const normalWidth = calculateResponsiveRailWidth(requestedWidth, viewportWidth);
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, Math.floor(viewportWidth)) : 0;
  const rightSidebarWidth = Number.isFinite(hostLayout.rightSidebarWidth)
    ? Math.max(0, Math.round(hostLayout.rightSidebarWidth))
    : 0;

  if (rightSidebarWidth <= 0) {
    return { width: normalWidth, mode: "normal" };
  }

  const mattermostWidth = Number.isFinite(hostLayout.mattermostWidth)
    ? Math.max(0, Math.round(hostLayout.mattermostWidth))
    : 0;
  const centerWidth = Number.isFinite(hostLayout.centerWidth)
    ? Math.max(0, Math.round(hostLayout.centerWidth))
    : 0;
  const measuredNonCenterWidth = mattermostWidth > 0 && centerWidth > 0
    ? Math.max(rightSidebarWidth, mattermostWidth - centerWidth)
    : rightSidebarWidth;
  const requiredMattermostWidth = Math.max(
    MIN_MATTERMOST_WIDTH + rightSidebarWidth,
    measuredNonCenterWidth + MIN_MATTERMOST_CENTER_WIDTH,
  );
  const availableRailWidth = Math.max(0, safeViewportWidth - requiredMattermostWidth);

  if (availableRailWidth < MIN_RESPONSIVE_RAIL_WIDTH) {
    return {
      width: Math.min(normalWidth, COLLAPSED_RESPONSIVE_RAIL_WIDTH),
      mode: "collapsed",
    };
  }

  const width = Math.min(
    normalWidth,
    THREAD_COMPACT_RAIL_WIDTH,
    Math.floor(availableRailWidth),
  );
  return {
    width,
    mode: width < normalWidth ? "compact" : "normal",
  };
}
