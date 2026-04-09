# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this version adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
