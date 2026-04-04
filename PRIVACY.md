# Privacy Policy

Mattermost Deck processes user data only as needed to provide its single purpose: adding a multi-pane workspace to Mattermost Web.

## What data the extension stores locally
The extension stores configuration and UI state in the browser, including:
- Mattermost server URL
- optional team slug
- theme, language, polling interval, layout, saved views, and other display settings
- optional preference for PAT persistence

If the user chooses to persist a Mattermost Personal Access Token (PAT), the token is stored locally in the browser with client-side encryption. Session-only storage is the default. Persistent storage is optional. This encryption helps avoid plain-text storage, but it is not a complete security boundary because the same client can decrypt it.

## What data the extension processes
To display mentions, watched channels, DMs, search results, saved items, and related Mattermost content, the extension processes data made available from the configured Mattermost server, such as channel information, message lists, search queries entered by the user, and other content required for the extension’s visible features.

## How data is used
The extension uses this data only to provide the user-facing features of Mattermost Deck inside the user’s browser. The developer does not use this data for analytics, advertising, profiling, or resale.

## Where data is sent
The extension sends requests only to the Mattermost server origin explicitly configured by the user and only after the user grants Chrome permission for that origin. The extension does not send user data to the developer’s servers. The extension does not include third-party analytics or telemetry by default.

Because requests are sent to the user’s Mattermost server, data may be processed by that Mattermost server and its operators or administrators according to the server’s own policies.

## Data sharing
The extension does not sell user data and does not share user data with advertising platforms, data brokers, or unrelated third parties. Data is shared only with the user’s configured Mattermost server as necessary to provide the extension’s features.

## Data retention and user control
Locally stored settings remain in the browser until the user changes them, clears browser extension storage, or removes the extension. Session-stored PAT data is removed when the browser session ends. Persisted PAT data can be removed by changing the extension settings, clearing extension storage, or uninstalling the extension.

## Security
The extension is designed to keep authentication information local to the browser and to limit network access to the user-configured Mattermost server. Users are responsible for choosing appropriately scoped Mattermost tokens and for using a securely configured Mattermost server.

## Contact
For privacy questions, please contact the developer through the project repository:
https://github.com/mmiyaji/mattermost-deck
