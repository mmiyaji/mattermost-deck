# Homepage design QA

final result: passed

## Target and evidence

- Source: D:/AI/Codex/.codex/generated_images/01a1da42-75ec-72b0-849c-609b8f0c5954/exec-0fdd09c5-bbae-4e05-80ef-478841e10da9.png
- Requested adjustment: remove the storage tagline; use factual product and operation descriptions.
- Implementation: http://127.0.0.1:8773/?lang=ja, branch feature/homepage-refresh, based on origin/main cc8ca02.
- Viewport: 1440 x 900 CSS px, Japanese, dark, page top, no open dialog.
- Source: 1586 x 992 pixels, resized to 1440 x 900 for comparison.
- Implementation: .artifacts/homepage-refresh/desktop-final.jpg, 1425 x 900 pixels. Browser screenshot omits the 15px scrollbar; comparison adds empty padding, without scaling content.
- Full comparison: .artifacts/homepage-refresh/comparison-final.jpg.
- Focused heading/copy/action comparison: .artifacts/homepage-refresh/comparison-hero.jpg.
- Responsive evidence: .artifacts/homepage-refresh/mobile-comparison.jpg, tablet-full-viewport.jpg, laptop-full-viewport.jpg.
- Interaction evidence: .artifacts/homepage-refresh/lightbox.jpg and features-final.jpg.

## Findings and comparison history

1. Initial PC capture placed the setup section below the first viewport (P2).
   Evidence: desktop-dark.jpg, setup began at y=876.
   Fix: reduce introduction gaps, cap the desktop preview height at 408px, and reduce setup top spacing. The preview uses object-fit: cover, without stretching; enlargement shows the complete original screenshot. Mobile keeps the full image ratio.
   Final evidence: desktop-final.jpg, setup begins at y=770.5 and the three setup links end at y=877.3.

2. Navigation links must follow the page section order because the existing scroll tracker iterates in link order (P2).
   Fix: order navigation as Setup, Features, FAQ.
   Verification: Setup and Features each acquire aria-current=location at the correct scroll position; section tops remain below the sticky header.

No actionable P0/P1/P2 findings remain.

## Fidelity surfaces

- Typography: Segoe UI with Japanese system fallbacks; 40px semibold product name, 16px description, 14px support copy. The generic headline is absent.
- Layout: centered introduction, two actions, wide product capture with Mattermost/Deck labels, followed by three numbered setup links. Detail sections use spacing and separators. Mobile stacks the setup list; actions wrap as needed.
- Colors: graphite background, neutral text, blue primary action; existing light/dark tokens and switching retained.
- Images: existing real Japanese/English light/dark captures and supplied brand icon. No generated screenshot is used as page UI. Desktop preview crops a small amount at the lower edge to fit the PC viewport; the original remains available in the viewer.
- Content: the storage tagline is absent from the hero. Product behavior, optional PAT, compatibility matrix, privacy information and detailed instructions remain. Internal pane identifiers were removed from the catalog.

## Interaction and responsive checks

- Setup CTA, detailed-settings link, Features and FAQ navigation.
- Image viewer opens and Escape closes it.
- FAQ question expands.
- Japanese/English and light/dark switching update copy and the product image.
- Privacy page opens with the current language; Back returns to the homepage.
- Widths 360, 390, 768, 1024 and 1440: no horizontal overflow observed.
- Mobile home link retains an accessible name; language/theme controls have 44px height.
- Preview server applies the production CSP from docs/_headers. No warning/error entries were returned by the browser console check.

## Automated validation

- npm run check:site: passed.
- npm run test:site-navigation: passed.
- npm run check:release: passed (v1.4.2).
- git diff --check: passed.

## Accepted deviations and limits

- The reference is a generated visual proposal. Its invented chat text is replaced with real product captures.
- Header link order follows actual page order. Preview labels use simple rules instead of decorative brackets. No arrow icons were added to the ordered setup list.
- Firefox/WebKit, physical devices, screen reader and a full keyboard audit were not run. Extension runtime tests were not rerun because changes are limited to site markup/styles.
- Screenshots and comparison artifacts are local ignored files under .artifacts/homepage-refresh.

## Implementation checklist

- [x] Apply selected centered layout and requested copy removal.
- [x] Retain real assets, localization, themes and image viewer.
- [x] Fix first-viewport setup visibility and section navigation order.
- [x] Compare source and implementation together, including a focused region.
- [x] Run site/navigation/release metadata checks and inspect responsive states.

## Header follow-up (2026-11-15)

- User requested straight active-navigation rules and a correction to the language dropdown.
- Removed navigation corner rounding and inset shadow; selected links use a 2px bottom border.
- Removed the transparent select overlay, duplicate label and custom arrow. The visible native select handles both the current language and the popup choices.
- Explicit light/dark color-scheme and option foreground/background follow the selected page theme. Keyboard focus remains visible on the containing language control.
- Verified Japanese/English selection, light/dark styles, active-section tracking and 390px layout. Browser computed styles confirm border-radius 0, box-shadow none, 2px bottom border, select opacity 1, and theme-matched native control colors.
- Visual evidence: .artifacts/homepage-refresh/header-proof.jpg. The full-page capture places the sticky header at its original scroll offset (687px); the evidence crop preserves that header exactly.
- Native OS popup surfaces are not included in tab screenshots; verification of the control covers selection changes and its effective styles.
- npm run check:site, npm run test:site-navigation and git diff --check passed.

## Main image region labels follow-up (2026-11-15)

- Replaced low-contrast 1px rules with 2px range brackets, including short vertical endpoints.
- Mattermost uses the readable secondary text color; Deck uses the theme accent for its label and bracket.
- Added a non-interactive 2px vertical divider at the actual Mattermost/Deck boundary, 48.84% across the preview.
- Both label columns use the actual screenshot ratio (48.84/51.16) without a grid gap shifting their boundary.
- Inspected .artifacts/homepage-refresh/regions-dark.jpg, regions-light.jpg and regions-mobile.jpg. PC and 390px layouts show aligned region ranges; mobile has no horizontal overflow.
- Site validation, navigation behavior checks and whitespace checks passed. This follow-up changes CSS and the homepage asset cache key only.

## Remove image overlay divider (2026-11-15)

- Removed the added vertical divider inside the main product image to avoid implying that it is part of the extension UI. External region labels and brackets remain.
