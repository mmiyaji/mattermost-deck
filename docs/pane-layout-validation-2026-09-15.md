# Pane sizing and two-row layout validation

Validated on Windows, 2026-09-15.

## Behavior

- Individual panes resize from their right edge within 260–480 px. Pointer capture keeps the gesture active outside the handle. Only the frame renders during dragging; the final width is saved on release. Escape/pointer cancellation restores the committed width. Double-click or Home restores the configured default; arrows adjust by 10 px (Shift: 40 px), End selects maximum width.
- At widths up to 330 px, header actions sit below the title. Controls wrap and team/channel selectors can shrink to the available width.
- Views offers a single row or two equal-height rows. Pane order runs left to right across the upper row, then the lower row. Each row has its own independent horizontal layout; changing a width in one row does not move neighbors in the other row. Horizontal scrolling remains available.
- Two-row panes scroll vertically when controls exceed the available height; selectors expand within that scroll area. Focus mode fills the rail and restores the selected arrangement on exit.
- Widths are part of the existing layout payload. The arrangement is persisted separately and included in saved sets and layout exports/imports. Legacy layouts without a mode use a single row. Invalid widths are ignored and numeric widths are clamped without discarding the pane.
- New controls have labels in all nine supported languages.

## Passed checks

- TypeScript check and build.
- Unit suite: 382 tests in 38 files, including layout-width normalization and legacy layout handling.
- Related E2E: 6 passed (`test-results/pane-layout-regression/`). Includes the built-extension fixture, real Docker favorites/cache/input checks, two responsive rail scenarios, and thread-aware layout on Mattermost 9.5.11.
- Final pane-layout E2E: passed (`test-results/pane-layout-confirmed/`). Checks minimum-width control geometry, pointer resizing, reload persistence, keyboard resizing/reset, cancellation, two-row geometry, focus/restore, and saved-set layout restoration. Screenshots: `minimum-width.png` and `two-rows.png` in that test's output folder. These two screenshots use a fixture server.
- Opened a fresh interactive Chromium profile against the running Docker Mattermost with four panes in two rows.
- `git diff --check` passed.

The full E2E suite, cross-version compatibility matrix, and long-running soak were not rerun. The existing v1.1.0 release ZIP is unchanged; these changes are Unreleased.

## Follow-up: single-row dragging and independent rows

Reproduced two regressions: widening the lower first pane moved the upper second pane from x=987 to x=1207 because both rows shared grid tracks; after returning to a single row, resize handles could have zero bounding rectangles even though panes remained visible. Replaced shared tracks with two independent flex rows and absolute resize handles with overlapping flex items. Focus acquisition now avoids automatic scrolling. The same pane instances remain mounted during arrangement switches.

The regression test now checks both directions of row independence and performs a real pointer drag from the visible pane edge after switching back to a single row. It also requires a nonzero handle before dragging.

Follow-up validation passed: TypeScript, build, and all six related E2E cases (`test-results/pane-independent-final/`, 1.4 minutes), including the strengthened regression. Opened a fresh Docker-backed interactive browser in single-row mode. Existing release ZIPs remain unchanged.
