# Mattermost Deck Design Guidelines

[日本語版はこちら](./design-guidelines.ja.md)

## Goal

Build a Chrome extension that turns the right side of Mattermost Web into a TweetDeck-like multi-pane workspace without reimplementing Mattermost itself.

The extension is intentionally positioned as a secondary UI layer:

- Mattermost native UI remains the source of truth for login, team switching, channel switching, posting, and general navigation.
- The extension adds a supplemental pane area on the right for monitoring and parallel reading.
- The extension should feel persistent and realtime, but it must avoid heavy coupling to Mattermost internals or bursty traffic patterns.

## Product Direction

### Main UI vs. Extension UI

- Left side and center remain Mattermost native UI.
- Right side is the extension-managed deck area.
- The deck area supports multiple horizontally arranged columns.
- The deck area is resizable by dragging the boundary between Mattermost and the deck.
- The deck can collapse into a narrow drawer.

### What the Extension Should Do

- Show monitoring-oriented panes such as:
  - mentions
  - watched channels
  - DM / group DM
  - later: thread-specific and search panes
- Let each pane remain pinned to its own target instead of always following the currently open Mattermost page.
- Preserve a dense, scan-friendly reading workflow.

### What the Extension Should Not Do

- Do not rebuild Mattermost team navigation.
- Do not rebuild Mattermost channel navigation.
- Do not reimplement the Mattermost editor or posting flow unless there is a strong reason later.
- Do not depend on Mattermost internal Redux state or fragile private DOM contracts.

## Architecture

### Injection Strategy

- Use a Manifest V3 Chrome extension.
- Register the content script dynamically only for the configured Mattermost origin.
- Request host permission explicitly from the user when the server URL is saved.
- Mount the extension UI into a Shadow DOM root attached to `body`.
- Reserve screen space by shrinking the Mattermost root width instead of overlaying the deck on top of the main content.

Why:

- Shadow DOM isolates extension styles from Mattermost styles.
- Shrinking the main app width preserves a true right-side deck layout.
- Dynamic origin registration reduces unnecessary permission scope and avoids injecting into unrelated sites.

### Rendering Guardrails

The extension should render only when all of the following are true:

- `window.location.origin` matches the configured Mattermost server URL.
- The route kind is allowed by settings.
  - Current default allowed kinds: `channels`, `messages`
- If a team slug restriction is configured, the current route matches that slug.
- The configured health-check API endpoint returns a successful response.

DOM signatures should not be used as a primary guard because they are more likely to break across Mattermost upgrades.

### Health Check Constraints

- Health-check paths must be restricted to relative `/api/v4/...` paths.
- Absolute user-specified URLs should not be used as fetch targets.
- Health checks must always stay on the configured Mattermost origin.

## Security Notes

### PAT Storage

PAT is not stored as raw plain text.

Current implementation in [`src/ui/storage.ts`](../src/ui/storage.ts):

- Prefix format: `enc:v1:...`
- Encryption: `AES-GCM 256`
- Random IV per write: 12 bytes
- Key derivation:
  - `PBKDF2`
  - `SHA-256`
  - `100_000` iterations
  - salt: `mattermost-deck.local-storage.v1`
- Key material source:
  - `chrome.runtime.id`
  - fallback to `window.location.origin` if needed

The derived `CryptoKey` is memoized in memory so repeated encrypt/decrypt operations do not rerun PBKDF2 every time.

### PAT Persistence Policy

- Default storage: `chrome.storage.session`
- Optional storage: `chrome.storage.local`
- Persistent storage must be an explicit user choice

This reduces the chance that a PAT remains on disk longer than intended.

### Encryption Limits

This encryption is intentionally described as client-side protection, not a full secret boundary.

Why:

- The extension itself must be able to decrypt the token.
- The key derivation source is available on the client.
- A local attacker with extension execution access can still recover the token.

Therefore the design goal is:

- avoid casual plain-text exposure in storage
- improve safety against accidental disclosure
- make the storage model explicit to the user

But not:

- claim hardware-backed secrecy
- claim protection against a fully compromised client

## API Burst Control

### Design Principle

The extension must not send a burst of same-timestamp requests when multiple panes need data at once.

This matters especially for:

- multiple watched columns
- `All teams` mention mode
- reconnect reconciliation
- manual refresh from several panes

### Current Request Queue

Implemented in [`src/mattermost/api.ts`](../src/mattermost/api.ts):

- all REST requests flow through `scheduleApiRequest(...)`
- requests are serialized through a single in-tab queue
- a minimum inter-request gap is enforced
  - current value: `120ms`

### GET Deduplication and Short TTL Cache

Current implementation also includes:

- inflight GET deduplication by pathname
- very short response cache for GET requests
  - current TTL: `1000ms`

### Required Load Rules

- Do not create one WebSocket per pane.
- Do not refetch all pane datasets after every event.
- Do not reconnect WebSocket in a tight loop.
- Do not poll all teams or all panes at short intervals.
- Do not allow UI settings to reduce polling below the enforced minimum.

## Polling Policy

- Realtime enabled:
  - WebSocket is primary
  - REST is used for initial load and limited reconciliation
- Realtime disabled:
  - REST polling is primary
  - interval remains conservative

Polling settings are normalized at load and save time, not only in the UI. This prevents direct storage tampering from forcing `0s` polling.

### `All Teams` Mentions

`All teams` mode is intentionally treated as a heavier mode.

- team-specific mentions are the default
- `All teams` must carry a clear warning in the UI
- `All teams` should raise the effective polling interval floor
- requests across teams must still flow through the serialized API queue

## Data Retention and Pagination

- initial fetch per pane: `20`
- `Load more` step: `20`
- per-pane in-memory cap: `100`

Do not allow unbounded DOM growth. Prefer small, predictable page sizes over large one-shot fetches.

## Manual Refresh Behavior

- manual refresh must only reload the affected pane
- manual refresh should not trigger full-deck reloads
- manual refresh should provide visible feedback even when the response is very fast

Current UI guidance:

- refresh icon animates while loading
- animation has a minimum visible duration
- the button is temporarily disabled while the refresh is active

## Health Model

Health should not be derived from WebSocket mode alone.

Suggested combined states:

- `Healthy / Realtime`
- `Healthy / Polling`
- `Degraded / Realtime`
- `Error / Polling`

Measurement strategy:

- primary signal: success or failure of existing REST work
- supplemental signal: configured health-check API path
- do not hardcode the health endpoint in the data layer

## Layout Guidelines

- Deck width is user-resizable.
- Dragged width is persisted and restored on restart.
- Preferred width from settings acts as a default, not as an override of an explicit dragged width.
- Column order is persisted.
- Preferred column width acts as the baseline width for panes.

## License and Distribution

- Project license: MIT
- Distribution intent: lightweight, permissive, no-warranty release model
- Documentation should keep license references aligned between `README` and `LICENSE`
