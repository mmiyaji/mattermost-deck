# Mattermost Deck

[日本語 README](./README.ja.md)

Mattermost Deck is a Chrome extension that adds a monitoring-oriented multi-pane workspace to the right side of Mattermost Web while keeping Mattermost itself as the primary UI for login, posting, editing, navigation, and threads.

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
- Mattermost-aware theme colors, optional pane identity accents, configurable default widths, and a compact mode that switches to dense `time author: content` rows with stable per-author colors
- Inline URL detection and truncation for long tokens in post bodies
- Jump-to-latest floating control for long panes
- Reply post indicator and reply-aware navigation that opens standalone replies in Mattermost thread view
- Diagnostics pane with lightweight recent sync hints, plus a Performance tab with API endpoint summary, recent trace logs, and JSONL export
- Japanese, English, German, Chinese (Simplified), and French UI
- Localized extension package name and description for Chrome

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
  - compact mode removes cards and uses a dense single-line layout like `time author: content`
  - your own author name uses the theme accent color and other authors use stable per-user colors
  - regular mode keeps the standard layout and only tightens nearby posts from the same person
- Image previews
- Pane identity color accents

### Behavior

- Post click action
  - replies open via permalink/thread view so posts that exist only inside a thread can still be shown reliably in Mattermost
- Highlight keywords
- High Z-index mode
- Reverse post order

### Performance

- Trace capture toggle for detailed troubleshooting
- API endpoint summary with request count, latency, and error rate
- Recent trace log table with full request URL, status, duration, and queue wait
- JSONL export for offline analysis
- Diagnostics keeps a shortened recent sync log for day-to-day use; the detailed request table remains in Performance
- Automatic retention policy:
  - turning trace capture off clears stored logs
  - logs older than 24 hours are removed automatically

## Security Notes

- PAT storage defaults to `chrome.storage.session`
- Persistent PAT storage is opt-in
- Persistent PAT values are encrypted client-side before storage
- Health-check paths are restricted to relative `/api/v4/...` paths on the configured Mattermost origin
- REST requests are serialized in-tab and heavier fan-out paths are batched to avoid burst refresh behavior when many panes update together
- After an empty state has been shown once, background refresh keeps that empty state visible instead of flashing a loading spinner

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

Push a tag in `v` format, such as `v0.2.1`, to trigger GitHub Actions.

- Runs `npm ci`, `npm run check`, and `npm run build`
- Packages `dist/` as `mattermost-deck-<tag>.zip`
- Creates a GitHub Release and uploads the zip as an asset

## License

MIT. See [LICENSE](./LICENSE).

## Contributing Translations

UI locale files live in `src/ui/locales/`. Extension package locale files live in `src/_locales/`.

To add a new UI language:

1. Copy `src/ui/locales/en.json` to a new file such as `ko.json`
2. Register it in `src/ui/i18n.ts`
3. Add the locale code to `DeckLanguage` and `normaliseLanguage` in `src/ui/settings.ts`
4. Add the language option in `src/options/index.tsx`

To localize the extension package metadata, add a matching `src/_locales/<locale>/messages.json`.

## Design Notes

- English design guide: [./docs/design-guidelines.md](./docs/design-guidelines.md)
- Japanese design guide: [./docs/design-guidelines.ja.md](./docs/design-guidelines.ja.md)
