# v1.0.9 packaging validation

Validated locally on Windows on 2026-09-11.

## Artifacts

- `mattermost-deck-v1.0.9.zip`: 652,213 bytes, 23 files.
- `mattermost-deck-v1.0.9.zip.sha256`
- SHA-256: `df5935789e74fde45cf1404ede304b6a08118b0f680a26494eb3b5e7729a334f`

Built with `STORE_BUILD=true` and `EXT_VERSION=v1.0.9`. Every archive entry was compared byte-for-byte with the store build. The manifest is at the ZIP root. Store validation confirmed the required files, versions, translations, and permissions, and exclusion of development-only content scripts and source maps.

## Passed checks

- `npm run check:release -- v1.0.9`
- `npm run check:site`
- `npm run check`
- `npm test -- --reporter=dot`: 369 tests in 36 files.
- `npm run check:store`
- `npx playwright test e2e/options-profiles.spec.ts --workers=1`: 10 tests against the store build, including profile origins, narrow settings layouts, and the v1.0.9 release notice in multiple languages.
- `npm audit --omit=dev --audit-level=high`: no reported production dependency vulnerabilities.
- ZIP integrity, manifest version, and all archived file contents.

## Remaining publication checks

The Docker daemon was unavailable, so the full Mattermost E2E suite, cross-version compatibility matrix, and server-dependent exact-archive store smoke test were not run locally. The existing release workflow runs these gates before publication. Native Chrome permission approval and subsequent Deck injection still require the visible manual check described in the README.

This is a locally packaged candidate; no Git tag was pushed, GitHub release created, or Chrome Web Store upload performed.
