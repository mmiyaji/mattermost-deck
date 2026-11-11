# UI audit polish — design QA

Date: 2026-11-11. Branch: `feature/ui-audit-polish`.

## Visual target and evidence

Approved direction: the user's three-screen audit table, with graphite settings surfaces, compact performance controls and persistent pane count space.

Source mockups: `.tmp-unslop-comparison-20261111/assets/settings-after-dark-palette-v2.png` (1448×1086), `performance-after-mock.png` and `panes-after-mock.png` (1586×992 each).

Implementation screenshots and measurements: `.tmp-ui-polish-validation-20261111/` (fresh extension build, version 1.4.1). Test data is fictional; seeded performance logs are UI fixtures, not benchmark results.

Full-view combined comparisons: `assets/settings-target-vs-actual.png`, `assets/performance-target-vs-actual.png`, and `panes-target-vs-actual.png` under that directory. Mockups are scaled to the corresponding CSS viewport; actual captures use deviceScaleFactor 1. Settings: 1024×768 dark (also checked 1440×900 light and 800×768 narrow). Performance: 1440×900. Panes: 1600×1000 with actual 280/320px columns. These are direction comparisons rather than pixel-exact cloning: real controls, existing save/draft workflows and product typography are retained. The performance target is light; its dark implementation is compared for structure, with light captures checked separately for color.

## Comparison history

### Iteration 1 — blocked

- [P1] Performance controls still bury diagnostics. Initial capture measured metric cards starting at y=1288, below the scroll viewport bottom of 829. Fix: paired cache/trace controls and compact preset controls. The latest screenshots and geometry replace these intermediate captures; this entry preserves the measured finding.
- Settings appearance preview is visible without scrolling at 1024 × 768: top 221, bottom 641. Document width equals viewport width at 800, 1024 and 1440. Graphite shell tokens are applied while the Deck preview retains its independent theme.

### Iteration 2 — blocked

- [P1] Paired controls reduced the metric start to y=947, but the long diagnostic finding still preceded the metrics. Fix: lead with metric cards and put explanatory methodology in a native disclosure; compact the preset without removing preview/apply/save state.

### Iteration 3 — final verification

- Metrics now occupy y=636–742 inside the y=69–829 scrollport. All four cards are visible at 1440×900. Evidence: `assets/performance-1440-dark-top.png`, `geometry.json`, and the combined performance comparison.
- Pane count/action boxes have a 6px gap at both 280px and 320px. Outer controls open with nested groups closed retain 519px of post viewport; exclusions expanded retain 232px in the 1000px-high capture. Evidence: `pane-geometry-1600.json`, `pane-geometry-280.json`, `panes-target-vs-actual.png`.
- Focused evidence: `panes-header-focus-pair.png`, `assets/appearance-1024-dark.png`, and `assets/performance-1440-light-detail.png` supplement the combined full views. Existing per-post author alignment and hover overlay are retained.
- [P2, resolved] Expanded-detail screenshots exposed a CSS specificity conflict: untouched request detail buttons still used the primary fill. Fixed by scoping secondary button rules under `.perf-overview`. The fresh `assets/performance-1440-light-detail.png` shows quiet text buttons and a distinct expanded state. High-preset preview spans its full panel (table width 1088px); Apply still enables Save without saving automatically.

## Fidelity surfaces

- Fonts/typography: existing Segoe UI / Japanese fallback, readable heading hierarchy and real form sizing retained. Narrow titles truncate without shifting the count.
- Spacing/layout: preview remains accessible at 1024px and has a jump link below 960px. Diagnostic cards fit the initial viewport. Charts remain below the diagnostic context; preserving real draft/save controls is an intentional difference from the compressed mock.
- Colors/tokens: graphite settings surfaces, light theme, selected radio states and theme buttons checked. Deck preview colors remain independent of the settings shell. Sampled primary/secondary/muted text contrast against the dark page is 14.82/9.18/6.09:1; this is targeted verification, not a full WCAG audit. Secondary detail-button correction is verified in the fresh rendered capture.
- Image/assets: existing app logo, icons and real preview components retained; no mockup image is shipped as UI. Preview raster logo uses the existing source asset.
- Copy/content: short connection help and always-visible cache purpose replace long introductions. Chart captions use actual 5/15/34-minute bins at 1/3/7-day ranges. Missing timing is distinguished from 0ms; absent optional detail fields are omitted.

## Validation

- Final type check (`npm run check`) and build (`npm run build`) passed.
- Unit tests: 73 files / 736 tests passed after translation parity was fixed.
- Serial focused E2E: 23 of 24 passed initially; the sole remaining failure was the test's missing trace-export disclosure step. After correcting the helper, all 3 relevant performance E2Es passed on the final build (23.5s). All 24 selected cases are therefore covered by passing runs; this is not a claim of a single all-green 24-case run. Logs: `e2e-final-serial.log` and `e2e-performance-final2.log` in the evidence directory.
- Real Mattermost 9.5.4 Docker captures completed on an isolated fictional workspace; that audit container was stopped. `git diff --check` passed. The extension version remains 1.4.1.
- Final options capture recorded no uncaught page errors or browser console errors (`errors.json`).
- Not run: a fresh whole-repository Docker E2E or performance benchmark. The live-session privacy test was excluded because its separate default 8066 fixture was unavailable; manual cache deletion and retention tests passed, and the visual check used isolated Docker Mattermost at 8074.

## Final result

final result: passed

No actionable P0/P1/P2 visual findings remain. Final regression completion is recorded above. P3 follow-up: the small 280px pane intentionally truncates long custom titles to preserve count and action space.

Design review method: unslop by Damir Sokolovsky (CC BY 4.0); adapted to the existing Mattermost Deck interface.
