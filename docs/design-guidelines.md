# Mattermost Deck Design Guidelines

[日本語版](./design-guidelines.ja.md)

## Goal

Build a Chrome extension that adds a monitoring-oriented multi-pane deck to the right side of Mattermost Web without rebuilding Mattermost itself.

## Product Positioning

- Mattermost remains the primary UI.
- The extension is a secondary workspace optimized for scanning, monitoring, and quick context switching.
- The deck should feel persistent and responsive, while avoiding tight coupling to Mattermost internals.

## UI Scope

### Mattermost Owns

- Login
- Team switching
- Channel switching
- Posting and editing
- Native thread panel

### Deck Owns

- Multi-pane monitoring layout
- Mentions, watched channels, DM/group DM, search, saved, and diagnostics panes
- Pane persistence
- Saved pane sets
- Supplemental search and filtering workflow
- Layout export and import

## Architecture

### Injection Model

- Manifest V3 extension
- Dynamic origin registration for configured Mattermost servers
- Shadow DOM mount attached to `body`
- Mattermost layout width is reduced to reserve deck space

### Rendering Guard

Render only when all of the following are true:

- `window.location.origin` matches the configured server URL
- current route kind is allowed
- optional team slug restriction matches
- health-check API succeeds

Do not rely on fragile Mattermost DOM signatures as the primary render guard.

## Data Model

### Pane Types

- `mentions`
- `channelWatch`
- `dmWatch`
- `search`
- `saved`
- `diagnostics`

### Saved State

Persist at least:

- pane order
- pane configuration
- drawer open state
- drawer width
- preferred pane width
- preferred column width
- saved pane sets
- recent targets

## Sync Model

### REST

- Use the active Mattermost browser session
- Initial loading happens via REST
- Non-realtime mode uses conservative polling

### WebSocket

- Optional
- Enabled only when a PAT is configured
- Used for realtime deltas, not full state rebuilds

### Health

Display health separately from sync mode, but present them together in the topbar.

Examples:

- `Healthy / Realtime`
- `Healthy / Polling`
- `Degraded / Polling`
- `Error / Polling`

Use existing REST success and failure as the primary health signal and the configured health-check API as a supplemental signal.

## Request Control

### Burst Avoidance

The extension must avoid synchronized bursts when many panes refresh at once.

Current design:

- all REST requests go through a serialized in-tab queue
- a minimum request gap is enforced
- inflight GET deduplication is used
- a short TTL cache is used for GET requests

### Polling Rules

- polling intervals are normalized at load and save time
- user settings cannot force zero or near-zero polling
- `All teams` mentions is treated as a heavier mode with a slower effective floor
- search panes use a slower polling floor than normal monitoring panes

## Security

### PAT Storage

PATs are not stored as raw plain text when persistence is enabled.

Implementation summary:

- AES-GCM encryption
- PBKDF2 key derivation
- client-side key material
- memoized derived key

This improves resistance to accidental disclosure, but it is not a full secret boundary.

### Persistence Policy

- default: session-only storage
- persistent storage: explicit opt-in

### Health Check Constraint

- health-check path must stay under `/api/v4/...`
- requests must stay on the configured Mattermost origin

## Interaction Rules

### Post Click

User-configurable behavior:

- navigate
- do nothing
- ask

Dragging or text selection must not trigger navigation.

### Auto-scroll

If the user has been idle long enough, new posts may scroll the pane back toward the top. If the user is actively reading, avoid disruptive jumps.

### Pane Reordering

- direct left and right moves from pane controls
- additional reorder workflow from the Views menu
- reorder animation should run only when pane order changes, not on ordinary pane content updates

## Search UX

- search highlighting should use dedicated highlight tokens
- snippets should prefer the first match neighborhood instead of always truncating from the start
- search syntax help should reflect Mattermost search behavior
- Search replaces the earlier separate keyword-watch concept

## Layout Export / Import

- export should create a JSON download
- import should read from a selected JSON file
- PATs must not be part of exported layout data

## Theming

- default extension theme is `mattermost`
- Mattermost theme integration should prefer Mattermost CSS variables over fragile DOM heuristics
- badge colors, button colors, highlights, and topbar text may use different source variables
- pane identity icons are always shown
- pane color accents are optional and disabled by default

## Documentation and Distribution

- project license: MIT
- README exists in English and Japanese
- design guide exists in English and Japanese
- release packaging is triggered by `v*` tags in GitHub Actions
