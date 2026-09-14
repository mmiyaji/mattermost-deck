# v1.1.0 packaging validation

Validated locally on Windows on 2026-09-14.

## Artifacts

- `mattermost-deck-v1.1.0.zip`: 676,582 bytes, 23 files.
- `mattermost-deck-v1.1.0.zip.sha256`
- SHA-256: `0954f625399022b1997794246a1b591109103bc20cd01876b58429dbec2fa6f4`

Built with `STORE_BUILD=true` and `EXT_VERSION=v1.1.0`. Extracted to `.tmp-store-candidate-1.1.0`; all 23 extracted files were hash-compared against the build. The manifest is at the ZIP root. Store validation passed, including versions, required locales, permissions, and exclusion of development-only content scripts and source maps.

## Passed packaging checks

- Release metadata gate for v1.1.0, website validation, and TypeScript check.
- Unit tests: 381 passed in 38 files.
- Store build validation: 23 files, 3,518,990 uncompressed bytes.
- Settings E2E and exact-archive store smoke: 11 passed (`test-results/v1.1.0-package/`). The store smoke used the extracted ZIP and the running Docker Mattermost 9.5.11 server.
- New release-note E2E: 1 passed, checking the three v1.1.0 notes in all nine supported languages (`test-results/v1.1.0-release-notes-final/`). An initial test selected the external changelog link instead of the in-app notes button; the selector was corrected without changing product code.

## Feature validation carried forward

The favorites and pane-search runtime is unchanged from commit `36aa42e`. Before packaging, its real-keyboard regression and favorites fixture tests both passed (`test-results/search-keyboard-final/`). The preceding full suite had 43 passes, 3 opt-in skips, and one server fixture precondition failure; that unchanged case subsequently passed together with both favorites cases. See `pane-search-validation-2026-09-14.md` for the full scope and evidence. The full Docker suite and cross-version compatibility matrix were not repeated for this metadata/release-note update.

## Publication status

This is a local release package. No tag was pushed, GitHub Release created, or Chrome Web Store upload performed. Native permission approval remains a manual publication check; the archive smoke covers the ungranted state and permission denial, not native-dialog approval. Long-running soak and monkey tests were not enabled for this packaging run.
