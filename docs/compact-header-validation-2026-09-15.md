# Compact pane headers validation

Validated on Windows on 2026-09-15.

For panes up to 330 px wide, keep the title and header actions on one line. Header buttons use 28 px targets; expanded toolbar buttons use 32 px targets with 4 px gaps. Long channel titles truncate within the remaining space and retain their full native title tooltip. Title font sizing is unchanged. Wider panes keep existing button dimensions.

At the minimum 260 px pane width, real Chromium geometry changed as follows:

| Measurement | Before | After |
| --- | --- | --- |
| Header height | 81.19 px | 39.19 px |
| Expanded six-button toolbar height | 82 px | 32 px |
| Toolbar rows | 2 | 1 |
| Toolbar button width | 36 px | 32 px |

This frees 92 px of vertical post area in the measured channel pane.

The initial strengthened E2E failed on the old CSS with a wrapped header and two toolbar rows. After the fix, both pane-layout and favorites UI E2E passed (`test-results/compact-header-after/`). The pane-layout test passed again with a long mixed Japanese/English channel title, asserting title/action separation and the full tooltip (`test-results/compact-header-long-title/`). These tests also cover resizing, row height, independent scrolling, search, and focus behavior. Screenshots were inspected; they use a fixture server.

Build, TypeScript, and whitespace validation passed. Opened a fresh interactive browser on Docker Mattermost at 260 px pane width. Full Docker E2E and soak were not repeated for this CSS adjustment. The v1.1.0 ZIP is unchanged.
