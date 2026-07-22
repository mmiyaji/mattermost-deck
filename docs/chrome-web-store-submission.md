# Chrome Web Store Submission Copy

Use this copy when maintaining the Chrome Web Store listing and its Privacy practices tab.

- Public listing: https://chromewebstore.google.com/detail/mattermost-deck/imbnblgiedelpebcfkenbhomcibomdpi
- Support URL: https://github.com/mmiyaji/mattermost-deck/issues
- Privacy policy URL: https://github.com/mmiyaji/mattermost-deck/blob/main/PRIVACY.md
- Store screenshot (1280 x 800): `docs/assets/readme-overview-dark-store.png`

## Single purpose

Mattermost Deck adds a multi-pane viewing and search workspace to Mattermost Web so users can monitor mentions, channels, direct messages, search results, and saved posts in one place.

## Detailed description

Mattermost Deck adds monitoring-oriented panes to the right side of Mattermost Web. Users can arrange mentions, channels, direct messages, keyword watches, search results, and saved posts side by side. Mattermost remains the primary interface for login, posting, editing, team navigation, and thread views.

## v0.2.6 release notes

- Added localized, browser-specific manual PWA installation guidance
- Required HTTPS for remote Mattermost servers while retaining HTTP support for loopback development
- Preserved Mattermost space on narrow windows and restored the requested Deck width when space returns
- Fixed the update banner and narrow settings layout
- Improved Mattermost Site URL subpath handling, profile synchronization, and WebSocket reconnection
- Localized actionable API errors and improved keyboard accessibility
- Strengthened Docker E2E, CI, dependency, and store-build checks

## Permission justifications

### alarms

Removes a temporary helper script if a PWA installation tab does not complete normally. The alarm is used only for cleanup, not analytics, tracking, or periodic transmission.

### storage

Stores the configured Mattermost server URL, display settings, pane layout, read state, and optional authentication preferences inside the browser. It is not used to send data to developer-operated servers.

### scripting

Inserts the Deck UI only into a Mattermost site explicitly configured and permitted by the user. It also supports temporary PWA installation assistance.

### tabs

Finds and refreshes configured Mattermost tabs, opens user-selected post links, and creates and cleans up the temporary PWA installation tab.

### windows

Opens a Mattermost post or thread in a separate window when the user requests that action.

### Host permissions

Allows API requests and Deck UI injection only for the Mattermost server explicitly configured and permitted by the user. The extension does not run on unconfigured sites.

## Data-use declaration checklist

| Data category | Purpose | Handling |
| --- | --- | --- |
| Authentication information | Optional Mattermost PAT for WebSocket connectivity | Session-only by default; optional persisted values are encrypted client-side and are not sent to developer-operated servers |
| Personal communications | Display Mattermost posts, DMs, and mentions | Processed in the browser and exchanged only with the configured Mattermost server |
| Website content | Display channels, posts, search results, and saved posts | Retrieved only from a user-permitted Mattermost origin |
| User activity | Retain display settings, pane layout, and read state | Stored locally in Chrome extension storage |

The data is not used for advertising, analytics, profiling, credit decisions, sale, or disclosure to unrelated third parties.
