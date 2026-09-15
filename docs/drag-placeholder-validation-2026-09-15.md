# Drag destination feedback validation — 2026-09-15

## Changes

- Replaced the narrow insertion line with a full-width dashed vacant slot and a small title card following the pointer.
- Preview rebalances both rows to match the persisted order. It keeps the actual pane nodes and restores their original parents/order before committing or cancelling; no post content is cloned.
- The slot stays stable while the pointer rests inside it. Escape, pointer cancellation, lost capture, window blur, and release outside the rows discard the preview.
- Preview updates do not write storage; the existing reorder callback persists on release only.

## Validation

- `npm run check`: passed.
- `npm test -- --reporter=dot`: 385 tests across 40 files passed.
- `npm run build`: passed.
- Related E2E: 5 passed (favorites fixture, pane layout fixture, two responsive rail checks, Docker Mattermost thread layout).
- Re-ran the pane-layout E2E after the final preview optimization and added a reverse move following cancellations.
- Real pointer checks cover cross-row and horizontal moves, matching placeholder/final coordinates, dashed styling, ghost cleanup, stationary-slot stability, Escape/outside cancellation, reverse movement, and persistence after reload. Existing resize, independent scroll, saved view and focus checks also pass.
- Screenshot visually inspected: `test-results/drag-placeholder-final/pane-layout-pane-sizing-an-62544-uts-stay-usable-and-persist/drag-between-rows.png`.
- Opened the updated extension in an interactive Chromium window against Docker Mattermost at `http://127.0.0.1:8066`.

The full E2E suite, compatibility matrix and long-running soak were not rerun. This is an Unreleased change; the existing v1.1.0 release ZIP has not been rebuilt.
