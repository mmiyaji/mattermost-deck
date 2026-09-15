# Pane reorder state retention — 2026-09-15

## Cause and changes

The pane component list was split between two React row parents, including in single-row mode. Moving a pane across that split remounted it and restarted its data-loading effects. Transient clipping during drag/FLIP animation could additionally change the polling interval and trigger an immediate fetch.

- Render the keyed pane component list under one stable React parent, using a persistent portal host per PaneFrame.
- Move existing hosts between visual rows in one layout effect, preserving scroll positions before any transient row-size changes clamp them.
- Restore nested pane scroll positions after drag preview cleanup as well.
- Debounce hidden visibility for 250ms (longer than the 160ms move animation), and ignore the temporary hidden source while dragging. Actual visibility changes and normal polling remain active.
- Portal hosts and visibility timers are cleaned up when components unmount.

## Validation

- Type check and production build passed.
- Unit tests: 385 passed across 40 files.
- Pane layout regression passes: all four frame/body nodes retain identity across a cross-row drag; the search draft and body scrollTop=30 remain unchanged; post API request count does not increase during the drag or its 500ms settling window.
- Existing drag cancellation, placeholder geometry, sizing, independent scrolling, hover tools and add-at-end checks also pass.
- Related E2E coverage includes favorites, responsive rail and Docker thread layout.

Release packaging and the full compatibility/soak suite were not rerun.
