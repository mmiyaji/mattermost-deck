# Settings design QA — 2026-11-03

final result: passed

## Follow-up: user-reported theme, purpose and footer issues

The user's screenshots exposed gaps in the initial QA scope. Explicit dark/light checks did not cover `mattermost` fallback, and initial footer geometry did not cover the state after drilldown scrolling. Both now have reproduction and regression tests.

- P1 resolved: the request view used light tokens unless the theme was exactly `dark`. It now inherits the shell's surface/text tokens, including `mattermost` fallback. Five theme/media combinations have measured normal-text contrast of at least 4.5.
- P1 resolved: `scrollIntoView` could scroll the overflow-hidden root by 94px, translating the header/footer and exposing a blank strip. Non-scrolling shell layers use `overflow: clip`; only the panel and sidebar can scroll. The root remains at scrollTop 0 and the footer remains at the viewport bottom after metric selection and row expansion.
- P1 resolved: CSS-injected page zoom could shrink a 100vh app below the actual viewport. A fixed-inset root with a percentage-height app fills the viewport across the tested browser/body/html/root zoom combinations.
- P2 resolved: previous-display caching is now explained by what appears on reopening Deck, with no database/API implementation terms. Visible On/Off and Saved/Unsaved labels distinguish draft state from the saved state.
- P2 resolved: the fetching preset is a separate action with Applied/Not applied/Ready to save feedback and does not override the user's cache choice.

Latest visual review: `test-results/settings-theme-delivery/`, including readable Mattermost request details and the off/saved cache purpose state. All three new regression scenarios pass (11.6s); related performance/settings scenarios also pass. These follow-up checks replace the narrower initial theme/footer conclusions below.

## Target and comparison

Selected visual target: the first displayed mock, `D:/AI/Codex/.codex/generated_images/01a178af-ad77-7093-8839-6a9295560a23/exec-5c825104-a4d8-4596-aec0-51447cc253a2.png`.

The target and the latest production-extension Behavior screenshot were opened together for comparison. The source image is approximately 1488×1056 pixels; the actual app uses a 1440×1024 CSS-pixel viewport at device scale 1. Compare composition proportionally, without treating the generator's slight size difference as a defect.

Actual captures: `test-results/settings-design-delivery/`. Additional focused views cover Appearance, dark theme, 900px and 390px widths, chart overview and expanded failure details. Existing full-page performance captures check content beyond the viewport.

## Findings resolved

- P1: Appearance used a margin derived from a 740px form despite its wider layout, shifting the panel outside its available area. Removed the offset and aligned panel headings.
- P1: Fixed-size preview content could widen its parent. The viewport now owns horizontal scrolling; configured deck/pane widths and font sizes stay exact. Pane and width-diagram dimensions include padding and borders.
- P1: Recharts' hidden tooltip retained its desktop transform after a narrow resize and widened the settings scroll area. The chart host clips this overflow; the request table retains its own horizontal scroller.
- P2: An injected browser stylesheet replaced the inherited Japanese UI font. An explicit author-level body inheritance rule restores the selected font stack. Browser diagnostics confirm Yu Gothic UI and YuGothicUI-Bold glyphs.
- P2: Early screenshots captured the navigation's 100ms transition, making the previous page appear selected. Final captures disable animations; the current page has the selected background and `aria-current="page"`.
- P2: The body-cache clear action originally had the same fill as Save. It now uses the secondary outlined treatment.

## Required fidelity surfaces

- **Typography:** Japanese sans-serif stack, 24px panel headings, readable form labels, compact explanatory text. Confirmed actual font selection rather than relying on the declared stack alone.
- **Spacing/layout:** navy header, restrained left navigation, white main surface, aligned headings, divided setting rows and a fixed save footer. Appearance uses two columns when space allows and stacks at narrower widths.
- **Colors:** pale neutral navigation, navy primary actions, neutral borders and restrained status colors. Dark theme remains supported. Active, hover, focus and disabled states were checked.
- **Assets:** existing Deck icon and existing application icons are reused without stretching. Charts are rendered by Recharts; no new decorative imagery is required.
- **Copy/content:** existing operational controls, localization, profile target and retention explanations are preserved. The real screen intentionally contains more settings than the simplified mock. It identifies the configured server/profile rather than inventing a connected-user indicator.

## Interaction and accessibility checks

- Draft save/discard, profile switching, saved-state footer and preview controls remain functional.
- Failed metric and actual red chart bars filter the same normalized request model used by the aggregate counts.
- Request table provides outcome, time, path, timing and expanded error details, with 50-row pagination.
- Metric activation with Enter and native time selection with arrow keys work. Time/status/search filters and reset are available without clicking chart geometry.
- HTTP errors and failures without an HTTP response are distinguished; unmeasured timing is not displayed as zero.
- No horizontal main-page overflow at 1440, 900 or 390px, including after interacting with a chart and resizing.

All P0/P1/P2 findings are resolved. Remaining differences from the mock are intentional production content/density and platform-native font rendering; no P3 item blocks delivery.
