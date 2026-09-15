# Independent row placement validation — 2026-09-15

## Behavior

- Pane row assignments (0 upper / 1 lower) persist with the existing column layout, saved sets, and JSON import/export.
- Legacy layouts get an even initial split when first shown in two-row mode. Subsequent additions, removals and moves do not rebalance other panes.
- Title dragging places the source in the chosen row, including an empty row. Escape cancels both ordinary and empty-row drops.
- Each row-end add button appends to its own row; header additions default to the upper row. Toolbar left/right moves stay within their row.
- Single-row mode displays the full order while retaining row assignments for the return to two rows. Pane widths remain independent.
- Distribute evenly between rows is available in Views/compact actions, translated into all nine UI languages. It changes assignments only on request.
- Poll interval changes reschedule the next timer rather than immediately refreshing, so a move that leaves another pane offscreen does not cause a fetch.

## Verification

- Type checking and production build passed.
- Unit tests: 388 passed in 40 files, including row migration, uneven placement, empty rows, explicit balancing and imported row validation.
- Related E2Es: pane layout, favorites, two responsive rail checks and Docker thread-aware layout passed. The extended pane E2E was rerun after the final adjustments.
- Actual pointer tests cover 1/3 placement, 0/5 empty-row drops/cancellation, 1/4 restoration after reload, saved set restoration after an explicit 3/2 balance, lower-row focus/exit, and additions from both row-end buttons.
- Existing assertions verify retained DOM/search/scroll state and no extra post reads during a cross-row move, plus resize, scroll and overlay behavior.
- Visually inspected independent-row-counts.png in test-results/independent-rows-verified and opened the updated extension against Docker Mattermost for interactive use.

The full compatibility matrix, long-running soak and release ZIP rebuild were not run for this change.
