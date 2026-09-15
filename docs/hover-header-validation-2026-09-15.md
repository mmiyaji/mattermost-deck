# Hover pane header tools — 2026-09-15

- On hover-capable fine pointers, header tools overlay the end of the title instead of reserving horizontal space. A panel-colored background with a short gradient keeps icons readable without changing title geometry.
- Hover anywhere in the pane or keyboard focus anywhere inside it reveals the tools. Open pane search and the focused-pane exit control remain available.
- Touch/coarse pointers retain the normal visible tools. Invisible desktop tools remain keyboard-focusable; focus reveals them immediately.
- Mention counts remain visible separately from the hidden tools.

Validation:
- Type checking and production build passed.
- Pane layout and favorites fixture E2Es passed. Added checks cover 260px title width, identical heading geometry before/after hover, actual mouse opening of search, search staying visible after focus leaves, Tab/Enter folding, and touch emulation with pointer: coarse.
- Two responsive rail E2Es and Docker Mattermost thread-layout E2E passed.
- Visually inspected header-quiet.png and header-hover.png under test-results/hover-header.
- Opened a fresh interactive Docker Chromium window with narrow panes for manual use.

The release ZIP and full compatibility/long-running soak suite were not rerun for this UI change.
