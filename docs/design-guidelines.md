# Mattermost Deck Design Guidelines

[日本語版](./design-guidelines.ja.md)

## Goal

Build a Chrome extension that adds a monitoring-oriented multi-pane deck to the right side of Mattermost Web without rebuilding Mattermost itself.

## Product Positioning

- Mattermost remains the primary UI
- The extension is a secondary workspace optimized for scanning, monitoring, and quick context switching
- The deck should feel persistent and responsive without tightly coupling to Mattermost internals

## UI Scope

### Mattermost Owns

- Login
- Team switching
- Channel switching
- Posting and editing
- Native thread panel

### Deck Owns

- Multi-pane monitoring layout
- Mentions, watched channels, DM/group DM, keyword watch, search, saved, and diagnostics panes
- Pane persistence
- Saved pane sets
- Recent targets
- Optional per-origin profiles
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

Do not use fragile Mattermost DOM signatures as the primary render guard.

## Data Model

### Pane Types

- `mentions`
- `channelWatch`
- `dmWatch`
- `keywordWatch`
- `search`
- `saved`
- `diagnostics`

### Persisted State

Persist at least:

- pane order
- pane configuration
- drawer open state
- drawer width
- preferred rail width
- preferred column width
- saved pane sets
- recent targets
- profile registry

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

- `Healthy`
- `Healthy` with realtime icon
- `Healthy` with polling icon
- `Degraded` with polling icon

## Request Control

### Burst Avoidance

The extension must avoid synchronized bursts when many panes refresh at once.

Current design:

- serialized in-tab REST queue
- minimum request gap
- inflight GET deduplication
- short TTL cache for GET requests
- staggered fan-out for heavy all-teams mentions work

### Polling Rules

- polling intervals are normalized at load and save time
- all-teams mentions is treated as a heavier mode with a slower effective floor
- search-like panes use a slower polling floor than normal monitoring panes
- team-level and channel-level fan-out should prefer small batches over `Promise.all`

## Diagnostics And Performance

### Diagnostics Pane

Use Diagnostics as a lightweight operational view that can stay visible during normal use.

Show only:

- current health state
- sync mode
- basic request rate
- average latency
- error rate
- in-flight count
- recent reconnect or sync hints

### Performance Tab

Use the Options `Performance` tab for deeper analysis.

It should own:

- trace capture controls
- API endpoint summary
- recent trace log table
- JSONL export
- heavier analysis and sorting UI

### Trace Retention

- turning trace capture off clears stored trace entries
- trace entries older than 24 hours are removed automatically
- the retained trace should stay bounded and safe for extension storage

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

When Deck opens a post in Mattermost, it should also try to bring the target post into view.

### Loading States

- Use a full-deck loading state only during initial boot
- Use per-column loading states for heavier fetches after layout is already available
- Do not flash empty-state cards before the first successful fetch resolves

### Pane Reordering

- direct left and right moves from pane controls
- additional reorder workflow from the Views menu
- animation should run only when pane order changes

## Post Rendering

- Detect `http://` and `https://` URLs inside ordinary text, including cases where multibyte text appears immediately before the URL
- Truncate only the displayed text for long tokens and long URLs
- Keep the original URL in the link target and tooltip

## Search UX

- search highlighting should use dedicated highlight tokens
- snippets should prefer the first-match neighborhood instead of always truncating from the start
- keyword watch remains a distinct pane type from search

## Layout Export / Import

- export should create a JSON download
- import should read from a selected JSON file
- PATs must not be part of exported layout data

## Theming

- default extension theme is `mattermost`
- Mattermost theme integration should prefer CSS variables over DOM heuristics
- pane identity icons are always shown
- pane color accents are optional and disabled by default

## Options UX

- `Connection` should prioritize the server URL and activation prerequisites
- `Profiles` should be treated as optional advanced workflow configuration
- appearance-related settings belong under `Appearance`
- behavior-related settings belong under `Behavior`
- performance analysis belongs under `Performance`, not the always-visible Diagnostics pane

## Internationalization

The UI uses i18next and react-i18next. Locale files live in `src/ui/locales/`.

The extension package metadata uses `src/_locales/`.

Supported UI languages:

- `ja`
- `en`
- `de`
- `zh-CN`
- `fr`
