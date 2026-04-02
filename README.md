# Mattermost Deck

Chrome extension that adds a TweetDeck-style right rail to the Mattermost web app while keeping the native Mattermost left navigation and main timeline intact.

## Approach

- Mattermost remains the primary UI for team and channel switching.
- The extension injects a fixed right rail into the existing page.
- Supplemental columns such as mentions, watched channels, DMs, and threads are rendered inside the rail.
- Data for supplemental columns will come from Mattermost REST APIs and WebSocket events, not from reimplementing the full Mattermost app shell.

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
- Reserve layout space by adding a body offset
- Render placeholder deck columns in a Shadow DOM
- Verify injection against local Mattermost with Playwright

## Next steps

- Detect current team and channel from Mattermost navigation state
- Add a column model and persisted layout storage
- Implement Mattermost API client and WebSocket session inside the content script
- Replace placeholders with mentions and watched-channel timelines
