export const MIN_MATTERMOST_WIDTH = 720;
export const MIN_RESPONSIVE_RAIL_WIDTH = 280;
export const MAX_RESPONSIVE_RAIL_SHARE = 0.4;

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
