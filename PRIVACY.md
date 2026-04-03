# Privacy Policy

Mattermost Deck stores extension settings locally in the browser.

- Stored locally: target Mattermost server URL, optional team slug, theme, language, polling interval, detailed guard settings, and optional PAT persistence preference.
- PAT storage: the token is stored with client-side encryption. Session-only storage is the default; persistent storage is optional. The extension can decrypt the token on the same client, so this is not a complete security boundary.
- Network access: the extension sends requests only to the configured Mattermost server origin after the user grants Chrome permission for that origin.
- No external analytics: this project does not include external analytics or telemetry by default.

Users are responsible for choosing appropriately scoped Mattermost tokens.
