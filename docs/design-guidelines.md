# Mattermost Deck Design Guidelines

## Goal

Build a Chrome extension that turns the right side of Mattermost Web into a TweetDeck-like multi-pane workspace without reimplementing Mattermost itself.

The extension is intentionally positioned as a secondary UI layer:

- Mattermost native UI remains the source of truth for login, team switching, channel switching, posting, and general navigation.
- The extension adds a supplemental pane area on the right for monitoring and parallel reading.
- The extension should feel persistent and realtime, but must avoid adding heavy or fragile coupling to Mattermost internals.

## Core Product Direction

### Main UI vs. Extension UI

- Left side and center remain Mattermost native UI.
- Right side is the extension-managed deck area.
- The deck area supports multiple columns arranged horizontally.
- The deck area should be resizable by dragging the boundary between Mattermost and the deck.
- The entire deck should be collapsible into a narrow drawer.

### What the Extension Should Do

- Show monitoring-oriented panes such as:
  - mentions
  - watched channels
  - later: DMs, threads, search views
- Let each pane be pinned to a specific team or channel instead of always following the currently open page.
- Let users add multiple panes and keep them side by side with horizontal scrolling.

### What the Extension Should Not Do

- Do not rebuild Mattermost team navigation.
- Do not rebuild Mattermost channel navigation.
- Do not take ownership of posting or editor behavior unless there is a strong reason later.
- Do not depend on reading Mattermost internal Redux state or private DOM state unless strictly necessary.

## Architecture

### Injection Strategy

- Use a Manifest V3 Chrome extension.
- Inject a content script into the Mattermost page.
- Mount the extension UI into a Shadow DOM root attached to `body`.
- Reserve screen space by shrinking Mattermost root width instead of overlaying the deck on top of the main content.

Why:

- Shadow DOM isolates extension styles from Mattermost styles.
- Shrinking the main app width preserves a true right-side deck layout.
- This is more stable than iframe-based duplication of Mattermost.

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
  - includes columns and deck width
- Data state:
  - current user
  - teams
  - channel metadata
  - posts shown in each column
  - mention counts
- Realtime state:
  - websocket connection status
  - locally merged incoming events

## Data Strategy

### Authentication

- Reuse the existing Mattermost browser session.
- Use `fetch(..., { credentials: "include" })` for REST calls.
- Include CSRF headers derived from the `MMCSRF` cookie for API requests.
- Do not depend on the browser session for WebSocket auth.
- WebSocket is optional and should use a user-provided PAT stored locally in extension storage.
- PAT is currently stored in `chrome.storage.local` without encryption.
- Prefer lower-privilege tokens and make the storage model explicit in the Options UI.

Implication:

- If the Mattermost session expires, the extension cannot continue operating and should surface that clearly.

### Initial Data Load

Use REST for:

- `users/me`
- current teams
- unread counts
- channel lookup by name
- channel lists for configured team
- recent posts for watched channels
- mention search results
- user lookup by IDs

REST remains the source for initial hydration and reconciliation.

### Realtime Updates

Use one WebSocket connection per browser tab for incremental updates.

- Authenticate via `authentication_challenge` using a saved PAT.
- Auto-detect the server URL from `window.location.origin`.
- Listen for `posted` events.
- Merge matching events into local pane state.

If no PAT is configured:

- do not open WebSocket
- show realtime as disabled
- rely on conservative REST polling instead

Current rules:

- watched channel panes update when a `posted` event matches their configured `channelId`
- mention panes treat self-mention events as a signal to refresh mention data

### Reconciliation Strategy

Use hybrid sync:

1. REST for initial load
2. WebSocket for incremental updates
3. REST again only when needed:
   - after reconnect
   - when a mention event implies local counts may be stale
   - infrequent fallback sync

This avoids aggressive polling while keeping panes correct after disconnects.

## Server Load Policy

The extension must be conservative.

### Rules

- Do not poll at short intervals.
- Do not open multiple websocket connections for individual panes.
- Do not re-fetch whole datasets after every event.
- Do not reconnect websocket in a tight loop.

### Current Load Controls

- One websocket connection per tab
- Exponential backoff on reconnect
- Random jitter on reconnect delay
- Longer reconnect waits while the document is hidden
- `online` event based retry when the browser regains connectivity
- Slow fallback REST sync interval when websocket is enabled
- Slightly faster but still bounded polling when websocket is disabled
- Re-sync only the panes affected by reconnect or relevant events

## Layout Guidelines

### Deck Width

- Deck width is user-resizable.
- Width is persisted.
- Width is clamped so Mattermost retains usable space.

### Drawer Behavior

- Drawer open state is persisted.
- Closed drawer should leave a narrow visible handle.
- Closing the drawer should return width back to Mattermost by reducing reserved layout offset.
- The drawer surface should stay focused on monitoring, not configuration.

### Columns

- Columns use fixed width rather than fluid width.
- Columns scroll horizontally as a group.
- Each column should work independently from the currently focused Mattermost channel.

Why:

- This matches TweetDeck mental models.
- Fixed-width columns keep density predictable.
- Independent columns make monitoring useful.

## Column Design Principles

### Mentions Column

- Bound to one selected team
- Shows unread mention count
- Shows mention post list
- Realtime updates should prefer event-triggered refresh over full frequent polling

### Channel Watch Column

- Bound to one selected team and one selected channel
- Shows recent posts for that channel
- Realtime `posted` events should append locally when they match the channel

### Configuration Area

- Top configuration blocks should be collapsible
- Long-lived content should dominate visible space
- Controls should be available but not consume most of the column height

## UX Principles

### Visibility of System State

The extension should always make these states obvious:

- realtime connected / reconnecting / offline / error
- session expired
- loading vs. empty vs. failed
- whether a column is pinned to a team/channel
- how to open extension settings when realtime is disabled

### Minimize Surprise

- A newly added pane should default to the current team or channel where sensible
- A disabled selector should have a clear reason
- A collapsed control area should not hide critical content state

### Preserve Mattermost Behavior

- Native Mattermost interactions should continue to work normally
- The extension should not intercept normal posting or channel navigation behavior
- If a route changes, extension state should update without disrupting active UI interaction

## Known Risks

### Session Expiry

- When session cookies expire, both REST and WebSocket stop functioning.
- The extension must surface this instead of failing silently.

### Mattermost DOM Changes

- Layout injection depends on Mattermost container structure such as `#root`.
- DOM changes across Mattermost versions may require targeted CSS updates.

### Native Select Styling

- Select controls inside Shadow DOM can render differently across platforms.
- Favor native controls first, then replace only if behavior remains unreliable.

### WebSocket Semantics

- Mattermost websocket payload structure may vary.
- Realtime logic should remain additive and resilient, with REST as reconciliation fallback.

## Near-Term Priorities

1. Stabilize dropdown behavior and interaction reliability.
2. Surface session-expired state clearly in the deck UI.
3. Improve websocket status visibility and diagnostics.
4. Add more useful column types after current two-column model is stable.
5. Refine visual hierarchy after behavior is reliable.

## Implementation Rule of Thumb

If a feature choice conflicts with stability, prefer:

- fewer requests
- fewer websocket connections
- less DOM coupling
- more explicit status feedback
- more reuse of native Mattermost behavior

This extension should feel like a careful augmentation of Mattermost, not a second chat client embedded beside it.
