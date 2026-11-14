# Homepage design validation

The homepage follows the Deck-tone design in `mock/deck-tone.html`: a graphite base, 10 px rounded panes and cards, the Deck button blue (`#1c58d9`), and the Segoe UI / Noto Sans JP stack. The page follows the system light/dark setting until the visitor chooses a theme. Screenshots are real captures of the extension, taken with `scripts/capture-site-shots.mjs` (overview, two rows, wide, right pane, and settings pages; Japanese and English; light and dark) and stored in `docs/assets/shots/`. The earlier catalog layout (`mock/pattern-c.html`) is kept in `mock/` for reference.

Keep the product facts current when updating this page: version 1.4.2, Chrome 120 or later, nine UI languages, the current Mattermost release test matrix, mention review behavior, favorites and saved posts, and the existing polling/WebSocket conditions. The Chrome Web Store CTA points to the current listing. Privacy, terms, and security links point to their live destinations.

The page keeps the Japanese and English selector, system-aware light/dark control, GLightbox image viewer, and section navigation. CSS, JavaScript, and the GLightbox license are external files to comply with `docs/_headers` CSP. Run `npm run check:site` and `npm run test:site-navigation` after homepage or navigation changes.

Homepage Japanese text uses the shared system Japanese sans-serif stack; figure captions, labels, and table headings use it as well, while identifiers and section numbers stay monospaced. GLightbox descriptions follow the active theme colors and use the same stack, including on mobile. The homepage CSS cache key was changed to avoid stale cached styles.

## Local verification (2026-11-05)

- Browser checks used an isolated loopback server, including a server enforcing the production CSP source restrictions (self-hosted scripts/styles/images and no external connections).
- Japanese dark and English light layouts, language/theme controls, section clicks, final FAQ selection, GLightbox enlargement and closing, privacy navigation and return were verified.
- At 390px, Japanese dark and English light catalog rows stack without page overflow. Footer links remain readable; the author link appears once.
- The C layout retains its compact native language selector and text Chrome Web Store CTA. The homepage header links are hidden in narrow layouts as in the original C design.
- The active-section threshold accounts for the sticky header, root scroll padding, and catalog section spacing. Regression checks cover the language-driven layout-shift case as well as cancellation of click locks, modifier clicks, history and the short final section.
- Site validation, navigation regression checks, JavaScript syntax, release-metadata validation and whitespace checks passed. Extension runtime/E2E tests were not rerun because no extension runtime code changed.
- No merge, push or deployment was performed for this work. Earlier work is saved under ignored `.artifacts/pre-pattern-c/`.

## Typography and lightbox follow-up (2026-11-05)

- Reproduced white caption text on the vendor white background in dark mode.
- Chrome rendered the old Japanese figure caption with MS Gothic and Consolas; the corrected caption uses Yu Gothic UI consistently on this Windows environment.
- Verified Japanese light/dark captions, English dark captions, 390px layouts without horizontal overflow, and next-image/close controls. Theme colors now pair white/#111417 in light mode and #15181c/#e9edf1 in dark mode.
- Site validation, navigation regression checks, release metadata and whitespace checks passed. No extension code changed, so extension E2E tests were not rerun. Not deployed.

## Deck-tone redesign (2026-11-15)

- Replaced `index.html` and `assets/homepage-c.css`. `assets/site.js` now builds the lightbox gallery from the screenshots visible for the current language and theme, and rebuilds it when either changes.
- Text is written as plain statements of what the extension does. The setup section covers the Connection and Update method pages with outlined screenshots, and a separate section states the trade-off of a personal access token: realtime updates against the risk of a leaked credential, and that client-side encryption of a stored token does not guarantee safety.
- Facts were checked against the implementation. The per-pane width range is 200-800 px (`src/ui/columnWidth.ts`); README and this page previously said 260-480 px.
- `npm run check:site` and `npm run test:site-navigation` pass.
- Chromium checks with the CSP from `docs/_headers`: no horizontal overflow and no broken images at 360, 390, 768, 1024, 1280 and 1920 px, in light/dark and Japanese/English. The only console message is the GLightbox `style-src-attr` warning, which does not change the layout. Firefox and WebKit were not run.
