# Title drag reordering validation

Validated on Windows on 2026-09-15.

- Drag an h2 title at least 6 px to start reordering. Header search/fold buttons, subtitles, posts, and width/height resize handles retain their own operations.
- The source fades and the target shows a before/after insertion line. Moves work within a row and across the upper/lower rows. Scrolling near visible row edges reveals offscreen targets.
- Release commits the order through the existing functional layout update, retaining pane IDs/settings/widths. No layout storage writes occur while hovering. Self-drops, stale targets, and unchanged adjacent positions are no-ops in the reorder helper.
- Escape, pointer cancellation, lost capture, window blur, focus mode, and unmount clean up the gesture and animation frame. Existing keyboard-accessible arrow/menu ordering controls remain available.

Validation:

- TypeScript and build passed.
- Unit suite: 385 tests across 40 files, including moves in both directions, retained settings, missing IDs, and no-op drops.
- Five related E2E cases passed in `test-results/title-drag-final/` (1.1 minutes), covering favorites UI, pane layout, Docker responsive rail, and Docker thread-aware layout.
- Final pane-layout E2E passed again after blur cleanup (`test-results/title-drag-confirmed/`). It uses real mouse drags for cross-row and single-row moves, checks persistence after reload, and verifies Escape cancellation. It also retains resizing, searching, and independent-scroll regressions. The initial new test needed a loading-state guard after page reload; product reordering had succeeded.
- The drag indicator screenshot was visually inspected; it uses the fixture server. A fresh interactive browser was opened on the running Docker Mattermost with two rows.

The full compatibility matrix and soak were not rerun. Existing release ZIPs are unchanged.
