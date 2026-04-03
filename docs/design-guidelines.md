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
- Inject a content script into the configured Mattermost target.
- Mount the extension UI into a Shadow DOM root attached to `body`.
- Reserve screen space by shrinking the Mattermost root width instead of overlaying the deck on top of the main content.

Why:

- Shadow DOM isolates extension styles from Mattermost styles.
- Shrinking the main app width preserves a true right-side deck layout.
- This is more stable than iframe-based duplication of Mattermost.

### Rendering Guardrails

The extension should render only when all of the following are true:

- `window.location.origin` matches the configured Mattermost server URL.
- The route kind is allowed by settings.
  - Current default allowed kinds: `channels`, `messages`
- If a team slug restriction is configured, the current route matches that slug.
- The configured health-check API endpoint returns a successful response.

DOM signatures should not be used as a primary guard because they are more likely to break across Mattermost upgrades.

### UI Structure

- Mattermost app remains visible and interactive.
- Extension root is fixed on the right side of the viewport.
- Deck root contains:
  - drawer toggle
  - resize handle
  - top bar
  - horizontally scrollable column strip
- Sensitive or low-frequency settings live in the extension Options page, not inside the main deck surface.

### State Layers

- Route state:
  - derived from the current Mattermost URL
- Layout state:
  - stored in extension storage
  - includes columns, drawer state, rail width, and preferred column width
- Data state:
  - current user
  - teams
  - channel metadata
  - posts shown in each column
  - mention counts
- Realtime state:
  - websocket connection status
  - locally merged incoming events
- Health state:
  - last successful REST timestamp
  - consecutive failures
  - current synthesized status such as `Healthy / Polling`

## Data Strategy

### Authentication

- Reuse the current Mattermost browser session for REST calls.
- Use `fetch(..., { credentials: "include" })`.
- Include CSRF headers derived from the `MMCSRF` cookie.
- Do not rely on the browser session for WebSocket authentication.
- WebSocket is optional and uses a user-provided PAT saved in extension storage.

Implication:

- If the Mattermost session expires, REST stops working and the extension must surface that clearly.

### Initial Data Load

Use REST for:

- `users/me`
- current teams
- unread counts
- channel lookup by name or ID
- channel lists
- direct channel lists
- channel members
- recent posts for watched channels
- mention search results
- user lookup by IDs

REST remains the source for initial hydration and reconciliation.

### Realtime Updates

Use one WebSocket connection per browser tab for incremental updates.

- Authenticate via `authentication_challenge` using a saved PAT.
- Auto-detect the server URL from `window.location.origin`.
- Listen primarily for `posted` events.
- Merge matching events into local pane state.

If no PAT is configured:

- do not open WebSocket
- show sync mode as polling
- rely on conservative REST polling instead

Current rules:

- watched channel panes update when a `posted` event matches their configured `channelId`
- mention panes use relevant events as a signal to refresh mention data

### Reconciliation Strategy

Use hybrid sync:

1. REST for initial load
2. WebSocket for incremental updates
3. REST again only when needed:
   - after reconnect
   - after local uncertainty such as mention count drift
   - during infrequent fallback sync

This avoids aggressive polling while keeping panes correct after disconnects.

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

### Encryption Limits

This encryption is intentionally described as client-side protection, not a full secret boundary.

Why:

- The extension itself must be able to decrypt the token.
- The key derivation source is available on the client.
- A local attacker with extension execution access can still recover the token.

Therefore the design goal is:

- avoid casual plain-text exposure in local storage
- improve safety against accidental disclosure
- make the storage model explicit to the user

But not:

- claim hardware-backed secrecy
- claim protection against a fully compromised client

### PAT Usage Guidance

- PAT should be optional.
- PAT should be minimally scoped when possible.
- UI copy must state that storage is encrypted locally but not fully tamper-proof or secret-proof.

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

This means:

- no multi-pane fan-out in the same millisecond
- a reconnect or refresh sequence is spread over time
- API pressure becomes predictable and smoother

### GET Deduplication and Short TTL Cache

Current implementation also includes:

- inflight GET deduplication by pathname
- very short response cache for GET requests
  - current TTL: `1000ms`

Implications:

- repeated reads of the same endpoint from several panes coalesce into one request
- repeated route-driven guards avoid immediately refetching the same endpoint
- the extension reduces redundant traffic without hiding stale state for long

### Required Load Rules

- Do not create one WebSocket per pane.
- Do not refetch all pane datasets after every event.
- Do not reconnect WebSocket in a tight loop.
- Do not poll all teams or all panes at short intervals.
- Do not allow UI settings to reduce polling below the enforced minimum.

## Polling Policy

### General Rules

- Realtime enabled:
  - WebSocket is primary
  - REST is used for initial load and limited reconciliation
- Realtime disabled:
  - REST polling is primary
  - interval remains conservative

### Enforced Bounds

Polling settings are normalized at load and save time, not only in the UI.

Current normalization in settings storage:

- invalid values fall back to default
- minimum interval is enforced
- maximum interval is enforced

This is important because direct writes into `chrome.storage.local` must not be able to force `0s` polling.

### `All Teams` Mentions

`All teams` mode is intentionally treated as a heavier mode.

Rules:

- team-specific mentions are the default
- `All teams` must carry a clear warning in the UI
- `All teams` should raise the effective polling interval floor
- requests across teams must still flow through the serialized API queue

This avoids firing one request per team in an uncontrolled burst.

## Data Retention and Pagination

To keep the deck responsive across multiple panes, data volume must be bounded.

Current policy:

- initial fetch per pane: `20`
- `Load more` step: `20`
- per-pane in-memory cap: `100`

Implications:

- new items are appended or prepended inside that bounded window
- older items are dropped once the pane reaches its memory cap
- the cap applies independently per pane, so total UI cost still scales with pane count

Rendering policy:

- do not allow unbounded DOM growth
- use lightweight rendering and pagination before increasing per-pane caps
- prefer small, predictable page sizes over large one-shot fetches

## Manual Refresh Behavior

Manual refresh exists as an explicit recovery and verification tool.

Rules:

- manual refresh must only reload the affected pane
- manual refresh should not trigger full-deck reloads
- manual refresh should provide visible feedback even when the response is very fast

Current UI guidance:

- refresh icon animates while loading
- animation has a minimum visible duration so the action feels acknowledged
- the button is temporarily disabled while the refresh is active

This keeps manual refresh understandable without encouraging repeated bursty use.

## Health Model

Health should not be derived from WebSocket mode alone.

The top bar status should reflect:

- current health state
- current sync mode

Suggested combined states:

- `Healthy / Realtime`
- `Healthy / Polling`
- `Degraded / Realtime`
- `Error / Polling`

Measurement strategy:

- primary signal: success or failure of existing REST work
- supplemental signal: configured health-check API path
- do not hardcode the health endpoint in the data layer
- use the configured Target health-check path

## Thread Opening Strategy

When a post is clicked in the deck, the extension should open Mattermost's own thread UI rather than creating a separate thread viewer inside the extension.

Rules:

- prefer Mattermost SPA route changes over full page reloads
- preserve the user's sense that the deck is augmenting Mattermost, not replacing it
- let Mattermost own the actual RHS thread experience

Behavioral notes:

- opening a thread in the current channel should feel almost in-place
- opening a thread from another context may still require Mattermost to switch channel context internally
- full reload navigation should be treated as a fallback, not a default

## Layout Guidelines

### Deck Width

- Deck width is user-resizable.
- Dragged width is persisted and restored on restart.
- Preferred width from settings acts as a default, not as an override of an explicit dragged width.
- Width is clamped so Mattermost retains usable space.

### Drawer Behavior

- Drawer open state is persisted.
- Closed drawer leaves a narrow visible handle.
- Closing the drawer returns width back to Mattermost by reducing the reserved layout offset.
- The drawer surface should stay focused on monitoring, not configuration.

### Columns

- Columns use fixed width rather than fluid width.
- Columns scroll horizontally as a group.
- Each column works independently from the currently focused Mattermost channel.
- Column order is persisted.
- Preferred column width from settings acts as a default width for rendered panes.

Why:

- This matches TweetDeck mental models.
- Fixed-width columns keep density predictable.
- Independent columns make monitoring useful.

## Column Design Principles

### Mentions Column

- Default to a team-specific view
- Allow `All teams` with stronger guardrails
- Show unread mention count
- Show mention source context:
  - channel / team
  - DM / Group DM labels where applicable
- Realtime updates should prefer event-triggered refresh over aggressive polling

### Channel Watch Column

- Bound to one selected team and one selected channel
- Shows recent posts for that channel
- Realtime `posted` events append locally when they match the channel

### DM / Group Column

- Not team-bound in configuration
- Candidate list should include DM and group DM
- Labels should resolve user-readable names rather than raw channel IDs

### Configuration Area

- Top configuration blocks should be collapsible
- Long-lived content should dominate visible space
- Controls should be available but not consume most of the column height
- Secondary actions such as move, close, and manual refresh can live inside the collapsible control area

## UX Principles

### Visibility of System State

The extension should always make these states obvious:

- healthy / degraded / error
- realtime vs polling mode
- session expired
- loading vs empty vs failed
- whether a column is pinned to a team/channel
- how to open extension settings when polling mode is active

### Minimize Surprise

- New pane creation should start with minimal but clear setup
- Expensive modes such as `All teams` should be labeled as such
- A disabled selector should have a clear reason
- A collapsed control area should not hide critical content state

### Settings Precedence

Settings should resolve predictably.

Current precedence rules:

- current dragged rail width overrides preferred rail width from Options
- preferred rail width is used as a default for first render or reset-like scenarios
- preferred column width defines the baseline width for panes
- theme default is `Mattermost`
- a user-selected stored value always wins over a static default

### Preserve Mattermost Behavior

- Native Mattermost interactions should continue to work normally
- The extension should not intercept normal posting behavior
- If a route changes, extension state should update without disrupting active UI interaction
- Thread opening should prefer Mattermost's own SPA flow over full-page reloads

## README Screenshot Guidance

README screenshots are part of the product surface and should be intentionally prepared.

Guidance:

- use a clean test environment
- avoid accidental private or noisy content
- prepare showcase messages before capture
- keep both Mattermost main UI and the deck visible in the frame
- treat theme-specific screenshots as presentation assets, not incidental test output

Manual capture is acceptable when the desired visual state depends on interactive theme changes or other environment-specific rendering details.

## Known Risks

### Session Expiry

- When session cookies expire, REST fails and deck rendering should not silently continue.

### Mattermost DOM Changes

- Layout injection still depends on stable root containers such as `#root`.
- CSS offsets may need adjustment across Mattermost versions.

### WebSocket Semantics

- Mattermost WebSocket payload structure can vary.
- Realtime logic should remain additive and resilient, with REST as reconciliation fallback.

### Client-Side Secret Storage

- PAT encryption improves storage hygiene but does not replace a proper OS secret store.
- If stronger protection is needed later, native secret-store integration would be required.

## License and Distribution

- Project license: MIT
- Distribution intent: lightweight, permissive, no-warranty release model
- Documentation should keep license references aligned between `README` and `LICENSE`

## Near-Term Priorities

1. Keep sync status clear and trustworthy.
2. Keep request scheduling conservative as more panes are added.
3. Maintain readable labels for DM and group DM targets.
4. Expand pane types only if they do not increase request fan-out disproportionately.
5. Prefer stability and explicitness over feature breadth.

## Rule of Thumb

If a feature choice conflicts with stability, prefer:

- fewer requests
- serialized bursts
- fewer WebSocket connections
- less DOM coupling
- more explicit status feedback
- more reuse of native Mattermost behavior

This extension should feel like a careful augmentation of Mattermost, not a second chat client embedded beside it.
