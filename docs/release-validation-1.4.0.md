# v1.4.0 release validation

Validation recorded on 2026-11-03 for the v1.4.0 source and Chrome Web Store package.

## Passed

- `npm run check`
- `npm test` — 731 tests across 73 files
- `npm run check:release -- v1.4.0`
- `npm run check:site`
- Store package validation — 24 files, 5,139,099 uncompressed bytes
- Exact packaged archive validation and byte comparison against the store build
- Focused E2E coverage for cache privacy races, favorites, mention exclusions, scan recovery, and localized release notes
- Store-build permission-denial smoke test

## Incomplete

- The complete Playwright suite did not finish successfully. The earlier 104-test run was stopped while the 13-team fan-out scenario was running. Focused reruns of `mentions-fanout.spec.ts` have not produced a clean pass; the scenario's intermediate loading and pending-update expectations remain unresolved on the isolated Mattermost fixture. This is a release validation limitation, not evidence that the suite passed.
- The CI Mattermost-version matrix, long-running soak, and monkey tests were not run in this release session.

## Package

- Artifact: `mattermost-deck-v1.4.0.zip`
- SHA-256: `b84e852087090ff6949da180ee619ccec27a356e81176f444c133c8655d59b10`
- Size: 996,669 bytes

The archive is built and validated, but has not been uploaded or published.
