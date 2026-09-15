# Stable pane collapse controls — 2026-09-15

The two-row layout previously scrolled the entire pane when expanded settings exceeded its height. A scrollbar could shrink the header's available width and move the collapse button; vertical scrolling also moved the header.

Each pane now keeps its header outside a dedicated scrolling body in two-row mode. The body wrapper is always mounted, and uses display: contents in the single-row layout so switching layouts preserves the existing component state and list behavior.

Validation:
- Type checking and production build passed.
- Pane-layout E2E passed with a regression check at 260px width: three open/close cycles at exactly the same mouse coordinates, overflowing body confirmed, unchanged toggle x/y coordinates, and a real vertical wheel scroll that leaves the header fixed.
- Favorites E2E passed.
- Docker thread-aware layout E2E passed, including layout restoration without remounting Deck.
- Both responsive rail checks passed. One initial attempt timed out waiting for the Docker login form before reaching the test; its isolated rerun passed in 4.2 seconds.
- Screenshot inspected: test-results/stable-collapse-final/pane-layout-pane-sizing-an-62544-uts-stay-usable-and-persist/fixed-collapse-header.png.
- Opened updated narrow-pane interactive Docker browser.

No release ZIP rebuild or full compatibility/soak run was performed.
