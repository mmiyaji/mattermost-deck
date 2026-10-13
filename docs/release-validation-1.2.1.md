# v1.2.1 packaging validation

Validated locally on Windows on 2026-09-25, on branch `codex/long-running-performance`.

## Scope

Includes the settings redesign and draft protection, appearance previews, icon-based pane colors, 200–800px pane widths, 95% initial font size with stored values preserved, idle diagnostic/favorites timer changes, and full link destinations in shortened post/search previews. Existing working-tree changes were included and preserved.

## Artifact

- `mattermost-deck-v1.2.1.zip`: 708,622 bytes, 23 files.
- SHA-256: `53fe569fe264cc745b12a64c7780127dc626501f58fd08cf36dbfe3bcde2d09e`
- Sidecar: `mattermost-deck-v1.2.1.zip.sha256`.
- Store build: `STORE_BUILD=true`, `EXT_VERSION=v1.2.1`; 3,727,738 uncompressed bytes.
- ZIP has manifest.json at its root; no source maps. All extracted files in `.tmp-store-candidate-1.2.1` were byte-compared with dist.

## Passed

- TypeScript, release/tag metadata, site validation and store build validation.
- Unit tests: 399 passed, 42 files. Includes post snippet URL regressions and visibility-aware polling tests.
- Development-build E2E: 22 passed, covering settings, existing release notices, pane layouts and idle diagnostic sampling.
- Exact archive smoke: clean extension startup with no registered scripts or localhost permission, version 1.2.1, default font 95%, Save disabled without edits, all nine localized 1.2.1 release dialogs, deterministic permission denial, and no options-page JavaScript errors.
- Archive smoke run with `.tmp-perf/package-smoke.mjs`. Native browser permission request was replaced with a deterministic denial for this headless check.

## Limits

No Git commit, tag, remote push, GitHub Release, website deployment or Chrome Web Store upload was performed. A local Mattermost server was unavailable, so the Docker store smoke and cross-version integration matrix were not rerun. Local API fixtures were used for runtime E2E; the exact archive smoke did not require a server. Eight-hour wall-clock endurance testing remains unperformed; see the separate idle-performance report.

## Release-note refresh

Expanded v1.2.1 notes in the changelog, Japanese/English store copy, website and all nine in-app locales. Rebuilt the archive and checksum, byte-verified extracted files, and repeated the archive startup/localization smoke.
