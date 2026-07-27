# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this version adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added an optional thread-aware layout that narrows or collapses Deck while Mattermost's thread pane is open, then restores the requested width and scroll position.

### Changed

- Kept Deck panes mounted during Mattermost channel and team navigation and limited route updates to the destination channel lookup.
- Made the Docker-backed Mattermost test runner version selectable while keeping 9.5.4 as the default, and verified E2E compatibility with Mattermost 9.5.11.
- Clarified that leaving Team Slug blank keeps Deck state available across all teams on the configured Mattermost server.

### Fixed

- Applied WebSocket channel and thread read markers locally so navigation does not trigger a broad Deck refresh or delay read-state synchronization.
- Normalized Chrome host-permission patterns without explicit ports so loopback and other non-default-port Mattermost servers can be saved and activated correctly.

## [1.0.0] - 2026-07-25

### Added

- Published the official Mattermost Deck website, privacy policy, and terms of use, and linked them from the extension Settings page and manifest.
- Added Docker-backed E2E coverage for multi-channel mentions, CRT and non-CRT replies, custom mention keys, direct messages, edited and deleted posts, realtime bursts, and responsive Settings layouts.
- Added release validation that keeps the package, manifest, in-app version, website, changelog, and Git tag aligned before an archive is published.

### Changed

- Aligned mention collection with Mattermost semantics across teams and joined channels, including custom mention keys, group and special mentions, CRT and non-CRT thread notification preferences, and DM/GM conversations.
- Serialized polling and bounded reconciliation caches to reduce overlapping API requests while retaining reliable realtime recovery.
- Narrowed channel and user metadata refreshes to the affected resources instead of broadly invalidating unrelated data.
- Refined responsive Deck and Settings layouts so Mattermost remains usable across wide and narrow browser windows.
- Declared Chrome 120 as the minimum browser version and removed the unnecessary `windows` named permission.
- Updated the Chrome Web Store copy, release guidance, compatibility notes, public legal URLs, and localized in-app release notes for the stable 1.0.0 release.

### Fixed

- Prevented mentions from being missed when multiple channels receive posts close together or WebSocket events arrive in rapid succession.
- Applied Mattermost read markers and thread notification preferences when deciding whether root posts and replies belong in the mention feed.
- Reconciled edited, deleted, inaccessible, and retention-deleted posts so stale or ghost entries do not remain in Deck.
- Prevented stale membership, channel, and user metadata from causing incorrect mention matches after server-side changes.

## [0.2.6] - 2026-07-23

### Changed

- Require HTTPS for remote Mattermost servers while retaining HTTP support for loopback development.
- Limit optional HTTP host access to loopback development addresses and validate localized store descriptions during builds.
- Render the bounded post buffer without fixed-height virtualization so variable-height posts remain reachable.
- Preserve the Mattermost work area while the browser is resized and restore the requested Deck width when space returns.
- Refresh the Chrome Web Store links, submission copy, security guidance, and release screenshots for v0.2.6.

### Fixed

- Replaced the timeout-only PWA fallback with install-state checks and current browser-specific manual instructions localized in all supported languages.
- Completed German, French, Japanese, and Simplified Chinese coverage for Deck, diagnostics, performance, popup, release-note, and actionable API error messages.
- Replaced hard-coded pane states and controls with actionable localized guidance and added visible errors when Mattermost or PWA installation cannot be opened.
- Synchronized active profile server URLs with the background worker and popup on fresh installs and upgrades.
- Preserved Mattermost Site URL subpaths across REST, WebSocket, health-check, avatar, and attachment requests.
- Prevented channel and post URLs from being mistaken for Mattermost Site URLs.
- Sent search pagination in the Mattermost request body and invalidated membership cache after marking channels read.
- Hardened WebSocket reconnect, heartbeat, and mention handling against duplicate connections and real user-ID payloads.
- Cleared stale posts when changing pane targets and reloaded mention read state after profile changes.
- Cleaned up temporary PWA injection on tab close or timeout and improved keyboard, modal, and narrow-screen accessibility.
- Standardized Docker E2E tests on the state file generated by `mm95:start`, strengthened timing and resize assertions, and added PR/release CI coverage.
- Updated development build dependencies to patched releases with a clean npm audit.

## [0.2.5] - 2026-07-07

### Fixed

- Refreshed already-open Mattermost tabs after extension updates so the deck header and UI use the newly installed bundle.

## [0.2.4] - 2026-07-07

### Fixed

- Recovered saved pane layouts from legacy `localStorage` fallback data when extension storage has no layout.
- Accepted legacy `{ columns: [...] }` layout payloads during layout normalization.

## [0.2.3] - 2026-07-07

### Changed

- Reduced settings save churn by batching storage writes.
- Reused cached channel lookups and bounded short-lived GET response caching.
- Shared column refresh and polling behavior across mentions, channel, search, and saved panes.
- Reduced content script route polling by observing dialog DOM changes.
- Localized date labels using the selected UI language.

### Fixed

- Ignored malformed WebSocket frames without throwing from the message handler.
- Exposed `chrome.storage.session` to content scripts so non-persistent PATs remain available to the deck.
- Removed a `chrome.storage` call from the PWA install script's MAIN world.
- Validated imported layout columns before replacing the current layout.
- Repaired corrupted storage encryption comments.

## [0.2.2] - 2026-04-14

### Added

- Unit coverage for default highlight keyword fallback behavior

### Changed

- Empty highlight keyword settings now default to `@username`, `@all`, `@here`, and `@channel`
- Updated options copy to explain the mention-oriented default highlight behavior

## [0.2.1] - 2026-04-13

### Added

- Docker-backed Playwright coverage for `@here` and `@channel` special mentions to verify the deck root does not remount during live updates
- Unit coverage for WebSocket mention payload parsing to prevent username substring false positives

### Changed

- Separated WebSocket reconnect refresh from mention-driven state refresh so special mentions no longer fan out a full pane reload path
- Unified effective realtime mode handling so WebSocket auth failures fall back to the normal polling cadence instead of the slower realtime fallback interval

### Fixed

- Prevented `@here` and `@channel` live mention updates from looking like an extension reload when multiple channels are joined
- Fixed WebSocket mention detection to require exact username matches in the server `mentions` payload

## [0.2.0] - 2026-04-10

### Added

- Reply-aware navigation that opens thread-only replies through Mattermost permalink/thread view
- Reply post indicator in Deck post lists
- E2E coverage for reply thread navigation

### Changed

- Reworked compact mode into a Mattermost-style dense row layout using `time author: content`
- Removed compact-mode cards and added stable per-author colors, with the current user using the active theme accent
- Limited nearby-post spacing reduction to regular mode while leaving compact mode as simple per-post rows
- Shortened recent sync log presentation in Diagnostics to reduce noise during routine monitoring
- Refreshed settings descriptions, README files, and design guides to match the current UI behavior

### Fixed

- Prevented empty-state panes such as `No mentions` or empty search results from flashing a loading spinner during background refresh
- Improved navigation reliability for replies that are hidden by collapsed thread mode in Mattermost

## [0.1.9] - 2026-04-09

### Added

- Performance tab with trace capture, API endpoint summary, recent trace table, and JSONL export
- Localized extension package metadata through `src/_locales/`
- Web Store promotion image generation assets and script
- Jump-to-latest floating control for long panes
- E2E coverage for all-teams mention fan-out and unread mark-read styling

### Changed

- Staggered all-teams mentions fan-out instead of firing all team requests at once
- Recent channel dedupe now keys on channel identity
- Post click navigation now attempts to scroll the target post into view inside Mattermost
- Diagnostics now focuses on lightweight operational signals while deeper analysis moved to Performance

### Fixed

- Improved unread mark-read hover contrast under Mattermost-driven light palettes
- Prevented long request investigations from retaining trace logs indefinitely by clearing on disable and pruning after 24 hours

## [0.1.8] - 2026-04-09

### Added

- Optional per-origin profiles in Options
- URL detection and truncation for long tokens in post bodies
- Per-column loading states for heavy fetch panes

### Changed

- Split Options into clearer Connection, Profiles, Appearance, and Behavior responsibilities
- Moved pane identity color accents into Appearance
- Switched the Profiles selector to the shared CustomSelect UI
- Raised the compact-header collapse threshold to avoid title wrapping
- Refreshed README and design guide documentation

### Fixed

- Prevented empty-state flashes before the first successful column fetch
- Fixed Profiles tab localization coverage across supported languages

## [0.1.5] - 2026-04-06

### Added

- Internationalization (i18n) with i18next and react-i18next
  - Supported languages: Japanese, English, German, Chinese (Simplified), French
  - Locale files in `src/ui/locales/` for community contributions
- Keyboard navigation (↑ / ↓ / Enter / Escape) for all CustomSelect dropdowns
- Closed Shadow DOM event handling for menus and dropdowns

### Changed

- Replaced inline language ternaries across App.tsx and options/index.tsx with `t()` calls
- `DeckLanguage` type extended to `"ja" | "en" | "de" | "zh-CN" | "fr"`

### Fixed

- Pane add menu outside-click detection broken by closed Shadow DOM
- Dropdown item selection broken by closed Shadow DOM (`composedPath` retargeting)


## [0.1.4] - 2026-04-06

### Added

- Redesign options UI, add panels and styles

### Changed

- Add open-tab message and highZIndex setting
- Add SVG icons for files and lightbox

### Fixed

- Pass showImagePreviews into column component props in App.tsx

## [0.1.3] - 2026-04-05

### Changed

- Performance tuning

## [0.1.2] - 2026-04-04

### Changed

- Release v0.1.2

## [0.1.1] - 2026-04-04

### Fixed

- Fix diagnostics column controls area height and layout

## [0.1.0] - 2026-04-04

### Added

- Initial release
- Refresh guides and screenshots
