# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this version adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.6] - 2026-08-16

### Added

- Added Russian, Ukrainian, Spanish, and Korean UI translations across Deck, Settings, the popup, the PWA install guide, and the Chrome Web Store package metadata.

### Changed

- Derived the supported-language list, the Settings language picker, and the store build's `_locales` gate from a single `SUPPORTED_LANGUAGES` definition in `src/ui/language.ts`.
- Made the store release-candidate smoke test compare the permission-denial message against the locale the options page actually rendered, instead of assuming a Japanese host browser.
- Locale parity tests now compare plural keys by base key and require exactly the CLDR plural categories each language declares, so four-form languages such as Russian and Ukrainian can no longer fall back to English. French gained its missing `many` forms, and the unused `one` forms were dropped from Japanese and Simplified Chinese.

## [1.0.5] - 2026-08-12

### Fixed

- Keep post cards clickable when text remains selected elsewhere in Mattermost, while continuing to suppress navigation for text selected inside the clicked card.

## [1.0.4] - 2026-07-30

### Added

- Added pull-request and release compatibility gates for Mattermost 9.5.11, 10.11.22, and 11.8.2, plus scheduled fixed-seed UI monkey and extension/control memory-soak workflows.
- Added an exact-archive Chrome Web Store smoke test covering the ungranted startup state and safe native-permission denial without persisting settings or injecting Deck; native prompt approval and resulting injection remain an explicit headed release check.
- Added SHA-256 checksums to release artifacts and structural accessibility E2E coverage for Settings controls, validation, performance tables, narrow layouts, and reduced motion.

### Changed

- Keep the current mention list stable while multi-team refreshes run, show progress in the fixed column header, and let users apply new, edited, or attachment-changing results from an update-count button while read and deleted rows still clear promptly.
- Scan channel mention history incrementally in 200-post pages until the read marker, channel-history end, cancellation, or 500 matched posts, without expanding complete reply threads, while retaining selected reply roots and update/edit markers inside the caller's result limit.
- Add 20-second network and 30-second queue-wait timeouts, abort requests when the configured server changes, and debounce realtime mention bursts into one bounded reconciliation.
- Cleanly dispose the previous content runtime, including its React root, subscriptions, observers, timers, route listeners, request, and history wrappers, before an updated bundle is injected; older builds fall back to a one-time tab reload.
- Honor each user's channel-wide mention notification preference in realtime matching, preserve direct and group messages, and reconcile edits and deletions without globally reloading Deck.
- Improve keyboard and screen-reader semantics for Deck menus, lightbox controls, retry states, Settings comboboxes, sortable tables, validation errors, charts, and narrow-layout legal/product links in every supported language.
- Document the optional bounded diagnostic trace contents, clearing behavior, and activity-based pruning of entries older than 24 hours in both public privacy-policy versions.

### Fixed

- Prevent partial mention results and post-shaped loading placeholders from shifting rows or looking like newly arrived posts.
- Restore the wider manual resize range so an explicit drag can expand Deck while keeping at least 320 px of Mattermost visible; automatic responsive sizing continues to reserve 720 px.
- Release a pending viewport-settle width as soon as a manual drag begins so Deck follows the pointer immediately after resizing the browser.
- Prevent duplicated content runtimes and retained event/observer chains after extension updates.
- Preserve the active team when Mattermost's two-segment Threads route is opened or restored directly.
- Show actionable localized errors and retry controls instead of leaving Deck or Settings in an indefinite loading or silent failure state.
- Correct the Purpose and Endpoint values in the performance table, eliminate nested form labels, and prevent required-field errors from flashing before stored Settings finish loading.

## [1.0.3] - 2026-07-29

### Added

- Added an opt-in, fixed-seed 20-minute memory soak that exercises 384 Mattermost posts, tens of thousands of bounded right-pane mutations, native surface and viewport transitions, and renderer heap/DOM/listener/User Timing trend reporting with extension-off controls.

### Changed

- Adjust Deck for any open Mattermost right pane, including threads, search results, and pinned posts, by subtracting the pane's full measured width from the normal responsive Deck width.
- Keep right-pane layout observation bounded to the Mattermost root and canonical right pane so loading posts or search results cannot grow the observer target set.
- Allow mouse and keyboard resizing while Deck is temporarily compacted for an open Mattermost right pane; the chosen width is saved while future right panes continue to auto-adjust.

### Fixed

- Build against the React production runtime and replace the full-subtree React Profiler with bounded in-app render timing so User Timing entries cannot accumulate during long sessions.
- Apply the Mattermost right-pane width and Deck offset in the same rendering frame so the main content keeps its pre-open width without staged resizing or temporary coverage.

## [1.0.2] - 2026-07-27

### Added

- Added an optional thread-aware layout that narrows or collapses Deck while Mattermost's thread pane is open, then restores the requested width and scroll position.
- Stream mention results into Deck as each channel and thread scan completes, with localized loading progress while the remaining teams are checked.
- Show the last verified mention result immediately from a bounded session cache while the live multi-team result is rebuilt in the background.

### Changed

- Kept Deck panes mounted during Mattermost channel and team navigation and limited route updates to the destination channel lookup.
- Made the Docker-backed Mattermost test runner version selectable while keeping 9.5.4 as the default, and verified E2E compatibility with Mattermost 9.5.11.
- Clarified that leaving Team Slug blank keeps Deck state available across all teams on the configured Mattermost server.
- Advanced the release version to 1.0.2 because 1.0.1 was used for a rollback distribution.
- Serialize mention refreshes, stop stale fan-out work between batches, keep the three mention pipelines within the same bounded team batch, and reuse shared channel metadata across each all-team refresh.
- Bound channel, thread, member, user, and metadata collection so large or long-lived multi-team sessions retain only the data needed by the 500-post mention feed.
- Suspend attachment preview data outside the visible area and performance sampling when no diagnostics pane is open.

### Fixed

- Applied WebSocket channel and thread read markers locally so navigation does not trigger a broad Deck refresh or delay read-state synchronization.
- Normalized Chrome host-permission patterns without explicit ports so loopback and other non-default-port Mattermost servers can be saved and activated correctly.
- Prevent superseded all-team mention scans and abandoned manual test-browser sessions from accumulating memory after team, profile, or test-session changes.
- Keep scanning past ordinary unread threads for later mention-bearing threads, and retain server-counted replies when a bounded thread window cannot disprove older participation.

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
- Prevented long request investigations from retaining trace logs indefinitely by clearing on disable and pruning entries older than 24 hours during extension activity

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
