# Personal favorites validation — 2026-09-13

## Behavior

- Deck post stars add/remove personal favorites. The Favorites pane is available from the Add menus and is preserved in layout import/export and Views.
- Favorites are independent of Mattermost saved posts and shared pins. Storage is scoped by the configured server URL (including subpath) and authenticated account, shared across profiles on that account.
- Up to 100 entries are persisted in extension local storage. Cached posts retain at most 16,000 message characters and ten attachment IDs; arbitrary post props and attachment bodies are not persisted.
- Cached posts render immediately. An open Favorites pane checks stale entries in a batch every five minutes, supports manual refresh and pause, and avoids requests while the document is hidden. Fresh cached posts require no additional post-fetch request.
- Bodies older than seven days are discarded on the next account load. Membership remains removable even when the post is unavailable. A successful lookup omitting a post clears its body; failed requests preserve the cached body.
- Web Locks serialize same-origin tab writes. Storage events update other tabs. Membership revisions prevent in-flight refreshes from resurrecting a removed or re-added favorite.
- Post activation uses a permalink, with the source channel's team when available. Stars are sibling buttons outside the clickable post area.

## Passed checks

- TypeScript check and build.
- Unit suite: 376 tests, including seven new cache/layout tests.
- Locale parity across all nine supported languages and static-site validation.
- `favorites-cache.spec.ts`: production Favorites provider and star component in Chromium with real extension storage and tab locks; tests persistence, account separation, cross-tab synchronization, cache reuse, request failure, edits, deletion, removal during refresh, expiry pruning, and write failure. Only the server lookup boundary is mocked.
- `favorites-ui.spec.ts`: the built extension injected into a local fixture site; tests keyboard star activation without navigation, pane rendering, cache reuse after reload, explicit refresh, edited/deleted posts, author/star spacing, and permalink navigation. Mattermost API responses are supplied by a local fixture server.
- Existing settings/profile browser tests: 10 passed.
- The Favorites screenshot was inspected in the light theme.

## Docker integration validation

After Docker Desktop was restored, Docker Engine 29.4.0 ran Mattermost Preview 9.5.11 on `127.0.0.1:8066`.

- Full E2E suite: **44 passed, 3 skipped, 0 failed** in 8.6 minutes.
- The skipped cases require explicit opt-in: long-running memory soak, seeded UI monkey, and the store-build permission smoke test.
- `favorites.spec.ts` passed against the real server, covering persistence across browser restarts, cross-tab synchronization, cached rendering when post lookup fails, subsequent edit refresh, and removal of deleted posts.
- Screenshot capture uses a 1920 × 1080 viewport and dismisses optional Mattermost onboarding/status prompts so both panes remain visible. The adjusted favorites scenario was rerun successfully.
- Results: `test-results/docker-favorites-full/`; final screenshot: `test-results/favorites-docker-screen-final/favorites-favorites-persis-c3d66-econcile-edits-and-deletion/favorites.png` (local, ignored artifacts).

## Limitations

This run validates Mattermost 9.5.11. Long-running soak, monkey testing, store packaging, and other server versions were not rerun for this feature.

This change is in Unreleased. The existing v1.0.9 ZIP has not been replaced or republished.
