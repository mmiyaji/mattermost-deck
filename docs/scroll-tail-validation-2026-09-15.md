# Scroll-end pane add controls — 2026-09-15

- Moved the pane add control into scroll content: one at the end of a single row, and one at the end of each independently scrolling row in two-row mode.
- Removed the fixed 56px right strip. Rows now use that width for pane content.
- The menu anchors to the clicked button, exposes the correct expanded state, and closes when pane scrolling moves its anchor. Already queued scroll events do not immediately dismiss a newly opened menu.
- Drag previews and cleanup keep the add controls after all pane nodes.

Validation:
- Type checking and production build passed.
- Pane layout E2E passed, including actual mouse clicks at the scroll end, adding a fifth pane, hidden buttons before the end, both row ends, no reserved padding, menu dismissal, dragging, resizing and persistence.
- Two responsive rail E2Es and Docker Mattermost thread layout E2E passed.
- The first combined run caught an existing fixture readiness race (the channel title still read Channel Watch); the test now waits for the channel name before measuring it, and the pane E2E passed again.
- Visually inspected before/end screenshots in test-results/scroll-tail and opened an interactive Docker browser with the updated extension.

No release ZIP rebuild or full compatibility/soak run was performed.
