# v1.2.0 packaging validation

Validated locally on Windows on 2026-09-15.

## Release scope

- Single-row and two-row layouts, independent row scrolling and persistent placement, per-pane width and row-height resizing.
- Title dragging with filled destination placeholders, Escape cancellation, and preserved posts, filters and scroll positions.
- Custom pane titles, quiet header controls, scroll-end add buttons and stationary expanded headers.
- Views and saved sets first in the compact hamburger menu.
- One-time Try two rows shortcut above the panes, dismissed persistently after use or closing. Existing two-row users do not see it.
- Search/collapse header tools stay hidden while the title editor is open and return afterwards.
- Japanese/English README, website and store release notes updated; in-app release notes and discovery copy cover all nine languages. Website counts corrected to seven addable pane types and nine UI languages. Screenshots refreshed, including a new two-row showcase.

## Final artifacts

- mattermost-deck-v1.2.0.zip: 697,490 bytes, 23 files.
- mattermost-deck-v1.2.0.zip.sha256
- SHA-256: fa114ed34d2320e864f2f62336d445cf166c747d3492d215a1bdd9f5970098c9
- Store build: 3,620,767 uncompressed bytes; STORE_BUILD=true and EXT_VERSION=v1.2.0.
- Extracted to .tmp-store-candidate-1.2.0-final2; every extracted file was hash-compared with dist. Manifest at ZIP root; no source maps or development-only scripts.

## Passed checks

- TypeScript, release/tag metadata gate, website validation and store build validation.
- Unit tests: 389 passed in 40 files.
- Runtime E2E: 16 passed (test-results/v1.2.0-final-runtime). Covers settings, all nine release-note locales, pane sizes/placement/reordering/aliases, the one-time discovery shortcut and its dismissal persistence, plus Docker Mattermost 9.5.11 responsive and thread layouts.
- After the final title-editor CSS change, the complete pane-layout E2E passed again, including explicit hidden/restored header tool assertions (test-results/v1.2.0-title-editor-final).
- Exact final ZIP smoke: 1 passed against Docker Mattermost 9.5.11 (test-results/v1.2.0-final-archive), covering initial ungranted state and safe permission denial.
- Website browser checks: Japanese and English at 1440 px and 390 px, no horizontal overflow or script errors; screenshots visually reviewed (test-results/v1.2.0-site).
- Screenshots captured from the local Docker showcase, including all nine interface languages; the routine showcase suppresses the dismissible discovery hint.

An initial compact-menu order assertion used an outdated English label; corrected to the actual Add pane label and rerun successfully. The final archive supersedes the earlier candidate produced before the title-editor CSS correction.

## Publication and limits

This is a local release package and website source update. No tag pushed, GitHub Release created, Cloudflare production deployment or Chrome Web Store upload performed. The repository's existing main-branch workflow deploys website changes after integration. The full cross-version matrix, full E2E suite, long-running soak and monkey tests were not repeated in this packaging run. Native permission approval remains a manual publication check; the archive smoke checks denial rather than granting that native dialog.
