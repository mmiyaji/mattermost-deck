# Mattermost Deck

[日本語版はこちら](./README.ja.md)

Chrome extension that adds a TweetDeck-style right rail to the Mattermost web app while keeping the native Mattermost navigation and main timeline intact.

## Screenshots

Light theme:

![Mattermost Deck overview](./docs/assets/readme-overview.png)

Dark theme:

![Mattermost Deck overview dark](./docs/assets/readme-overview-dark.png)

## Features

- Keeps Mattermost as the primary UI for team and channel switching
- Injects a resizable right rail into the existing page
- Supports mentions, watched channels, and DM/group DM columns
- Uses the current browser session for REST access
- Supports optional realtime updates with a Mattermost PAT
- Persists layout, drawer width, column width, and appearance settings
- Opens threads from the rail inside Mattermost's own UI

## How It Works

- Mattermost remains the main application shell
- The extension renders supplemental panes inside a Shadow DOM right rail
- Data comes from Mattermost REST APIs and optional WebSocket events
- The extension validates the configured target URL and health-check endpoint before rendering

## Setup

```powershell
npm install
npm run build
```

Load `dist/` as an unpacked extension in Chrome.

On first install, the extension opens its Options page so you can configure:

- Mattermost server URL
- Optional team slug restriction
- Optional PAT for realtime mode
- Polling interval and appearance settings

## Development

```powershell
npm run check
npm run build
npm run test:e2e
```

To generate README screenshots:

```powershell
npm run capture:readme
```

The screenshot script expects a reachable Mattermost test environment and valid test credentials.

## Release

Push a tag in `v` format such as `v0.1.0` to trigger GitHub Actions.

- The workflow runs `npm ci`, `npm run check`, and `npm run build`
- It packages `dist/` as `mattermost-deck-<tag>.zip`
- It creates a GitHub Release and uploads the zip as a release asset

## Security Notes

- The PAT is stored locally with client-side encryption
- This is better than plain-text storage, but it is not a complete security boundary
- The client can still decrypt the stored token, so use a minimally scoped token when possible

## License

MIT. See [LICENSE](./LICENSE).

## Current Scope

- Inject a right rail via content script
- Reserve layout space by shrinking Mattermost and exposing a resizable drawer
- Render mentions, watched channels, and DM/group DM columns in a Shadow DOM
- Reuse the current session for REST and optional PAT for realtime WebSocket
- Support options-driven targeting, health checks, and release packaging

## Design Notes

- Detailed design guidance: [docs/design-guidelines.md](./docs/design-guidelines.md)
