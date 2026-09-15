# Row height adjustment validation

Validated on Windows on 2026-09-15.

- Two-row mode has a horizontal resize handle between rows. The top-row share is bounded to 20–80%; lower-row height uses the remaining space.
- Pointer dragging previews CSS flex weights without rerendering the posts or writing storage on every move. Release commits the ratio; Escape, cancellation, and unmount restore an interrupted preview.
- Double-click/Home restores 50/50. Up/down keys adjust by 2 percentage points, or 10 with Shift. Accessible labels and percentage descriptions are provided in all nine locales.
- Ratios persist through reload and layout switches, and are included in saved views and layout import/export. Legacy or invalid values use equal heights.
- The handle is hidden in single-row and focus modes. Existing independent per-pane widths remain supported.

Checks: TypeScript, build, unit suite (383 tests in 39 files), and whitespace validation passed. The extended pane-layout E2E exercised real pointer resizing, 65/35 geometry, persistence, keyboard control, double-click reset, cancellation, and saved-set restoration. It also retained the horizontal resizing and independent-row regressions. Evidence: `test-results/row-height-final/`.

A fresh interactive Chromium profile was opened on the running Docker Mattermost in two-row mode. The packaged v1.1.0 ZIP was not rebuilt. Full compatibility-matrix and soak tests were not run for this change.
All five related E2E cases passed in 1.2 minutes, including the Docker responsive-rail and thread-aware-layout regressions.
