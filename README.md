# Mattermost Deck

[日本語 README](./README.ja.md)

Mattermost Deck is a Chrome extension that adds a TweetDeck-style multi-pane workspace to the right side of Mattermost Web while leaving Mattermost itself as the primary UI for login, posting, editing, navigation, and threads.

## Screenshots

Light theme:

![Mattermost Deck overview](./docs/assets/readme-overview.png)

Dark theme:

![Mattermost Deck overview dark](./docs/assets/readme-overview-dark.png)

## Features

- Resizable right-side deck with horizontally scrollable panes
- Pane types:
  - `mentions`
  - `channelWatch`
  - `dmWatch`
  - `keywordWatch`
  - `search`
  - `saved`
  - `diagnostics`
- Saved pane sets from the Views menu
- Layout export and import as JSON
- Optional realtime updates with a Mattermost PAT
- Optional per-server profiles for switching between multiple saved setting sets
- Mattermost-aware theme colors, optional pane identity accents, compact mode, and configurable default widths
- Inline URL detection and truncation for long tokens in post bodies
- Japanese, English, German, Chinese (Simplified), and French UI

## How It Works

- The extension mounts a Shadow DOM right rail and reserves width from the Mattermost page.
- REST requests reuse the active browser session.
- Optional WebSocket mode uses a PAT configured in Options.
- Rendering is guarded by:
  - configured Mattermost origin
  - allowed route kinds
  - optional team slug restriction
  - health-check API success

## Setup

```powershell
npm install
npm run build
```

Load `dist/` as an unpacked extension in Chrome.

On first install, Chrome opens the Options page. The recommended setup order is:

1. Open `Connection`
2. Save `Mattermost Server URL`
3. Optionally set `Team Slug`, PAT, polling, and appearance settings
4. Use `Profiles` only after the server connection is working

Saving the server URL requests Chrome permission for that Mattermost origin. The extension injects only into configured Mattermost servers.

## Options Overview

### Connection

- Mattermost Server URL
- Optional Team Slug restriction
- Allowed route kinds
- Health-check API path

### Profiles

- Optional per-origin setting sets
- Create, rename, duplicate, switch, and delete profiles
- Intended for multiple workflows on the same Mattermost server, such as Ops and Support

### Realtime

- Personal Access Token for WebSocket updates
- Session-only or persistent PAT storage
- Polling interval when realtime is disabled

### Appearance

- Theme
- Language
- Font scale
- Preferred rail width
- Preferred column width
- Compact mode
- Image previews
- Pane identity color accents

### Behavior

- Post click action
- Highlight keywords
- High Z-index mode
- Reverse post order

## Security Notes

- PAT storage defaults to `chrome.storage.session`
- Persistent PAT storage is opt-in
- Persistent PAT values are encrypted client-side before storage
- Health-check paths are restricted to relative `/api/v4/...` paths on the configured Mattermost origin
- REST requests are serialized in-tab to avoid burst refresh behavior when many panes update together

## Development

```powershell
npm run build
npm run test
```

Useful additional commands:

```powershell
npm run check
npm run test:e2e
npm run mm95:start
npm run mm95:stop
npm run open:mattermost
npm run capture:readme
```

`test:e2e` and screenshot capture require a reachable Mattermost test environment.

## Release

Push a tag in `v` format, such as `v0.1.0`, to trigger GitHub Actions.

- Runs `npm ci`, `npm run check`, and `npm run build`
- Packages `dist/` as `mattermost-deck-<tag>.zip`
- Creates a GitHub Release and uploads the zip as an asset

## License

MIT. See [LICENSE](./LICENSE).

## Contributing Translations

Locale files live in `src/ui/locales/`. To add a new language:

1. Copy `en.json` to a new file such as `ko.json`
2. Register it in `src/ui/i18n.ts`
3. Add the locale code to `DeckLanguage` and `normaliseLanguage` in `src/ui/settings.ts`
4. Add the language option in `src/options/index.tsx`

## Design Notes

- English design guide: [./docs/design-guidelines.md](./docs/design-guidelines.md)
- Japanese design guide: [./docs/design-guidelines.ja.md](./docs/design-guidelines.ja.md)
