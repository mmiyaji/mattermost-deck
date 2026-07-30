# Chrome Web Store Submission Copy

Use this copy when maintaining the Chrome Web Store listing and its Privacy practices tab.

- Public listing: https://chromewebstore.google.com/detail/mattermost-deck/imbnblgiedelpebcfkenbhomcibomdpi
- Official website: https://mattermost-deck.ruhenheim.org/
- Support URL: https://github.com/mmiyaji/mattermost-deck/issues
- Privacy policy URL: https://mattermost-deck.ruhenheim.org/privacy/
- Store screenshot (1280 x 800): `docs/assets/readme-overview-dark-store.png`

## Single purpose

Mattermost Deck adds a multi-pane viewing and search workspace to Mattermost Web so users can monitor mentions, channels, direct messages, search results, and saved posts in one place.

## Detailed description

Mattermost Deck adds monitoring-oriented panes to the right side of Mattermost Web. Users can arrange mentions, channels, direct messages, search results with keyword highlighting, and saved posts side by side. Mattermost remains the primary interface for login, posting, editing, team navigation, and thread views.

## v1.0.4 release notes

- Bounded each channel mention scan to five 200-post pages, added network and queue timeouts, and cancelled requests when the configured server changes so a stalled or very large server cannot grow work without limit
- Reconciles bursts of realtime mention events with one bounded refresh, applies edits and deletions immediately, and honors each user's channel-wide mention preference
- Hands off cleanly from the previous content runtime after an extension update, removing old listeners, observers, timers, and React roots before the new bundle starts
- Improved keyboard and screen-reader behavior for Deck dialogs, menus, retry states, Settings comboboxes, sortable performance tables, and validation errors in all supported languages
- Added release gates for Mattermost 9.5.11, 10.11.22, and 11.8.2, exact-archive ungranted and safe-denial smoke coverage, SHA-256 release checksums, and scheduled fixed-seed monkey and memory-soak testing
- Clarified that optional diagnostic traces are bounded and entries older than 24 hours are pruned on the extension's next activity

## Permission justifications

### alarms

Removes a temporary helper script if a PWA installation tab does not complete normally. The alarm is used only for cleanup, not analytics, tracking, or periodic transmission.

### storage

Stores the configured Mattermost server URL, display settings, pane layout, read state, and optional authentication preferences inside the browser. It is not used to send data to developer-operated servers.

### scripting

Inserts the Deck UI only into a Mattermost site explicitly configured and permitted by the user. It also supports temporary PWA installation assistance.

### tabs

Finds and refreshes configured Mattermost tabs, opens user-selected post links, and creates and cleans up the temporary PWA installation tab.

### Host permissions

Allows API requests and Deck UI injection only for the Mattermost server explicitly configured and permitted by the user. The extension does not run on unconfigured sites.

## Data-use declaration checklist

| Data category | Purpose | Handling |
| --- | --- | --- |
| Personally identifiable information | Display Mattermost authors and direct-message participants | User identifiers, usernames, display names, and avatars are processed only in the browser and with the configured Mattermost server |
| Authentication information | Optional Mattermost PAT for WebSocket connectivity | Session-only by default; optional persisted values are encrypted client-side and are not sent to developer-operated servers |
| Personal communications | Display Mattermost posts, DMs, and mentions | Processed in the browser and exchanged only with the configured Mattermost server |
| Website content | Display channels, posts, search results, and saved posts | Retrieved only from a user-permitted Mattermost origin |
| User activity | Retain display settings, pane layout, and read state | Stored locally in Chrome extension storage |

The data is not used for advertising, analytics, profiling, credit decisions, sale, or disclosure to unrelated third parties.
