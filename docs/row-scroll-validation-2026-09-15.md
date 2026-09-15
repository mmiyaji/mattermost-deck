# Independent row scrolling validation

Validated on Windows on 2026-09-15.

Each row in two-row mode has its own native horizontal scroll container. The shared outer viewport stays fixed, and the height divider sits outside the row scrollers. Single-row mode retains the existing shared horizontal scrolling. Focus mode continues to fill the rail, and returning to a single row keeps a usable pane resize handle.

The extended pane-layout E2E made both rows overflow and used real horizontal wheel events on each row. It asserted that the other row and outer viewport stayed still, that the height divider did not move horizontally, and that choosing the fourth pane from Views scrolled only the lower row. Existing width/height dragging, persistence, cancellation, saved-view restoration, and focus checks also passed. Evidence: `test-results/row-scroll-wheel/`; the screenshot there uses the fixture server.

TypeScript, build, and whitespace validation passed. A fresh interactive Chromium profile was opened on Docker Mattermost in two-row mode with 400 px panes to make scrolling easy to try. No release ZIP was rebuilt. Full E2E, compatibility matrix, and long-running soak were not repeated for this layout change.
Four additional regression E2E cases passed in test-results/row-scroll-regression/ (1.1 minutes): favorites UI, two Docker responsive-rail cases, and Docker thread-aware layout. Together with the extended pane-layout case, five relevant E2E cases passed.
