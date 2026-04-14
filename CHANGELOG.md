# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this version adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
