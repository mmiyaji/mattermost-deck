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

## Limitations

`favorites.spec.ts` adds the real Mattermost integration scenario, but it could not run locally: Docker Desktop failed while initializing its inference socket. Automated cleanup of that socket was blocked by policy and was not performed. The prior v1.0.9 Docker results predate this feature and do not validate these changes. Run the new scenario and the full Docker E2E suite after restoring Docker.

This change is in Unreleased. The existing v1.0.9 ZIP has not been replaced or republished.
