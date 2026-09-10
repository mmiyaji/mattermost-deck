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

## Docker E2E validation

Docker Desktop was started and the following checks completed on 2026-09-11. Tests used one Playwright worker and fresh browser profiles. The compatibility runs used the same seven spec files as `.github/workflows/release.yml`.

| Run | Result | Local evidence directory |
| --- | --- | --- |
| Full default E2E, Mattermost 9.5.4 | 41 passed, 3 opt-in tests skipped | `test-results/v1.0.9-full-confirmed/` |
| Mattermost 9.5.11 compatibility | 9 passed | `test-results/v1.0.9-compat-9.5.11/` |
| Mattermost 10.11.22 compatibility | 9 passed | `test-results/v1.0.9-compat-10.11.22/` |
| Mattermost 11.8.2 compatibility | 9 passed | `test-results/v1.0.9-compat-11.8.2/` |
| Exact ZIP store smoke, Mattermost 9.5.4 | 1 passed | `test-results/v1.0.9-store-archive/` |

The store smoke used `STORE_BUILD_SMOKE=true` and `STORE_BUILD_PATH=.tmp-store-candidate-1.0.9`, pointing to the extracted, checksum-verified release ZIP. It verified the initially ungranted state, safe permission denial, and absence of Deck injection on the real Mattermost page. It was run separately from the default suite, where it is skipped. The other two skipped tests are the opt-in memory soak and UI monkey tests; these long-running tests were not enabled.

The initial full run had 40 passes and one failure before launching the extension: the non-CRT test's reply timestamp was earlier than its root and the channel read marker. A read-only inspection of the test database confirmed the inconsistent timestamps, and a roughly 30-second host/container clock difference was observed. The precise cause of the timestamp reversal was not established. No assertion was weakened: the unchanged test passed in isolation, in the subsequent full run, and in all three compatibility runs. Initial evidence remains in `test-results/v1.0.9-full/` and `test-results/v1.0.9-non-crt-recheck/`.

Container replacement also exposed an unsettled top-level await in the startup script's unbounded health request. The health check now has a referenced five-second abort timer within its existing overall deadline. Both subsequent container replacements completed successfully. No extension runtime source or release ZIP changed during this validation.

## Remaining publication checks

Native Chrome permission approval and subsequent Deck injection still require the visible manual check described in the README. The headless store smoke simulates denial at the permission-request boundary; it does not validate native-dialog approval. The existing release workflow also reruns its gates before publication.

This is a locally packaged candidate; no Git tag was pushed, GitHub release created, or Chrome Web Store upload performed.
