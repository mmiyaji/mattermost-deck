# Mattermost Deck

[日本語 README](./README.ja.md)

Mattermost Deck is a Chrome extension that adds a TweetDeck-style multi-pane workspace to the right side of Mattermost Web while keeping the native Mattermost UI as the primary interface.

## Screenshots

Light theme:

![Mattermost Deck overview](./docs/assets/readme-overview.png)

Dark theme:

![Mattermost Deck overview dark](./docs/assets/readme-overview-dark.png)

## Features

- Keeps Mattermost responsible for login, navigation, posting, editing, and the native RHS thread UI
- Adds a resizable right-side deck with horizontally scrollable panes
- Supports pane types for:
  - Mentions
  - Channel Watch
  - DM / Group
  - Search
  - Saved
  - Diagnostics
- Supports saved pane sets from the Views menu
- Supports pane reordering from pane controls and from the Views menu reorder mode
- Supports layout export and import as JSON files
- Supports optional realtime updates with a Mattermost PAT
- Adapts deck colors to Mattermost theme variables
- Supports configurable pane identity colors, compact density, font scale, and pane width defaults
- Multilingual UI: Japanese, English, German, Chinese (Simplified), French
- Keyboard navigation (↑ / ↓ / Enter / Escape) in all dropdown selects

## How It Works

- Mattermost remains the source of truth for team switching, channel switching, posting, and thread rendering.
- The extension mounts a Shadow DOM right rail and reduces the Mattermost root width to reserve deck space.
- REST requests reuse the current browser session.
- Optional WebSocket realtime mode uses a PAT supplied in Options.
- Rendering is guarded by the configured Mattermost origin, allowed route kinds, optional team slug, and a health-check API.

## Setup

```powershell
npm install
npm run build
```

Load `dist/` as an unpacked extension in Chrome.

On first install, the extension opens its Options page. Configure:

- Mattermost server URL
- Optional team slug restriction
- Optional PAT for realtime mode
- Polling interval and appearance settings

Saving the server URL requests Chrome permission for that Mattermost origin. The extension is designed to inject only into configured Mattermost servers, not all websites.

## Security Notes

- PAT storage defaults to `chrome.storage.session`
- Persistent PAT storage is opt-in
- Persistent PAT values are encrypted client-side before being stored
- This reduces casual plain-text exposure, but it is not a full secret boundary
- Health-check paths are restricted to relative `/api/v4/...` paths on the configured Mattermost origin
- REST requests are serialized in-tab to avoid refresh bursts when multiple panes update together

## Development

```powershell
npm run check
npm run build
npm run test:e2e
```

Manual local browser startup:

```powershell
npm run open:mattermost
```

Refresh README screenshots:

```powershell
npm run capture:readme
```

The screenshot script requires a reachable Mattermost test environment with valid credentials.

## Release

Push a tag in `v` format, such as `v0.1.0`, to trigger GitHub Actions.

- Runs `npm ci`, `npm run check`, and `npm run build`
- Packages `dist/` as `mattermost-deck-<tag>.zip`
- Creates a GitHub Release and uploads the zip as an asset

## License

MIT. See [LICENSE](./LICENSE).

## Contributing Translations

Locale files live in `src/ui/locales/`. To add a new language:

1. Copy `en.json` to a new file (e.g. `ko.json`) and translate the values.
2. Import it in `src/ui/i18n.ts` and register it under the locale code.
3. Add the locale code to `DeckLanguage` in `src/ui/settings.ts` and to `normaliseLanguage`.
4. Add a language option to `languageOptions` in `src/options/index.tsx`.

## Design Notes

- English design guide: [./docs/design-guidelines.md](./docs/design-guidelines.md)
- 日本語設計ガイド: [./docs/design-guidelines.ja.md](./docs/design-guidelines.ja.md)
