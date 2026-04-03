# Mattermost Deck

Chrome extension that adds a TweetDeck-style right rail to the Mattermost web app while keeping the native Mattermost left navigation and main timeline intact.

## Approach

- Mattermost remains the primary UI for team and channel switching.
- The extension injects a fixed right rail into the existing page.
- Supplemental columns such as mentions, watched channels, DMs, and threads are rendered inside the rail.
- REST uses the current browser session.
- WebSocket is optional and can be enabled by saving a Mattermost PAT in the extension UI.
- On first install, the extension opens its Options page so you can set the target Mattermost server URL and optional team slug.
- Server URL, optional team slug, PAT, polling interval, theme, and language are managed from the extension Options page.
- Advanced settings allow overriding the allowed route kinds and the health-check API endpoint used before the deck renders.
- The PAT is stored locally with client-side encryption. This is better than plain text, but it is not a complete security boundary because the client can still decrypt it.
- Data for supplemental columns comes from Mattermost REST APIs and optional WebSocket events, not from reimplementing the full Mattermost app shell.

## Development

```powershell
npm install
npm run build
```

Load `dist/` as an unpacked extension in Chrome.

For local Mattermost driven by the sibling `chat-agent-bridge` project:

```powershell
cd ..\chat-agent-bridge
npm run mattermost:up
npm run mattermost:e2e:bootstrap
cd ..\mattermost-deck
npm run build
npm run test:e2e
```

The bootstrap step creates test users and stores credentials in `..\chat-agent-bridge\data\runtime\mattermost-e2e.json`.

## Current scope

- Inject a right rail via content script
- Reserve layout space by shrinking Mattermost and exposing a resizable drawer
- Render mentions and watched-channel columns in a Shadow DOM
- Reuse current session for REST and optional PAT for realtime WebSocket
- Verify injection against local Mattermost with Playwright

## Design Notes

- Detailed design guidance: [docs/design-guidelines.md](docs/design-guidelines.md)

## Next steps

- Detect current team and channel from Mattermost navigation state
- Add a column model and persisted layout storage
- Implement Mattermost API client and WebSocket session inside the content script
- Replace placeholders with mentions and watched-channel timelines
