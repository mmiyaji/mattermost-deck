# Chrome Web Store Submission Copy

Use this copy when maintaining the Chrome Web Store listing and its Privacy practices tab.

- Public listing: https://chromewebstore.google.com/detail/mattermost-deck/imbnblgiedelpebcfkenbhomcibomdpi
- Official website: https://mattermost-deck.ruhenheim.org/
- Support URL: https://github.com/mmiyaji/mattermost-deck/issues
- Privacy policy URL: https://mattermost-deck.ruhenheim.org/privacy/
- Store screenshot (1280 x 800): `docs/assets/readme-overview-dark-store.png`

## v1.3.2 release notes

- Keep the deck in place when a mention opens a reply, instead of reloading every pane.
- Keep the jump-to-latest control available while a cached pane refreshes in the background.
- No additional extension permissions.

## v1.3.1 release notes

- Preserve pending mentions and confirmation decisions during storage cleanup and quota recovery.
- Respect newer confirmation changes from another window.
- Continue displaying mentions if exclusion settings cannot load, with settings edits disabled until recovery.
- Reduce polling with unchanged-channel scan reuse and batched thread lookups; retry scans after failed or cancelled polls.
- No additional extension permissions.

## v1.3.0 release notes

### Added

- Mention review panes derived from an existing mentions pane: duplicate it or convert it in place, sharing the normal mention fetch. Explicit confirmation removes a post from pending review, with a five-second undo and restorable confirmation history.
- Durable pending posts and confirmation state stored in this browser per server/account, shared across review panes independently of normal mention cache limits. Opening or marking a post read never confirms it.
- Saved author and conversation exclusions shared by normal and review mentions per server/account. Conversation exclusions include future replies; hiding posts changes neither read nor confirmation state, and pending review data is retained.

### Changed

- Show post action menus on hover or keyboard focus as overlays without reserving an author-line gap, with readable contrast across themes and persistent access on touch devices.
- Keep mention feed ownership stable during pane reordering to avoid refetching posts.
- Keep the app version visible in the compact header.
- This release requests no additional extension permissions.

## v1.2.3 release notes

### Changed

- Reduced background monitoring work while the Mattermost page is hidden.

### Fixed

- Preserved a usable Mattermost center while resizing Deck, including with an open thread or automatic adjustment disabled.
- Kept cached mention posts clickable and opened saved posts with cross-team-safe permalinks.

## v1.2.2 release notes

### Fixed

- Preserved Mattermost deployment subpaths when opening posts and switching profiles.
- Coordinated encryption seed initialization across extension contexts.
- Preserved intentionally cleared settings and corrected saved-profile fallback behavior.
- Added spacing below the two-row introduction banner.

## v1.2.1 release notes

### Added

- Unsaved-change status, disabled Save when unchanged, and Discard changes.
- Save and switch, Discard and switch, and Cancel choices when switching profiles with unsaved edits.
- Sample post previews for font size, pane width, and colors.

### Changed

- Added a dedicated Settings button, explained Team Slug, and moved API paths into advanced settings.
- Displayed the server and profile in the settings header; grouped appearance controls and separated general settings from administration and diagnostics. Renamed Realtime to Update method.
- Replaced colored pane-top borders with colored pane type icons.
- Expanded individual pane widths to 200–800px. New font settings default to 95%; saved values are preserved.
- Stopped diagnostic sampling and favorites polling timers while hidden and isolated diagnostic rendering within its pane.

### Fixed

- Shortened post and search previews now preserve complete link destinations, including query strings and fragments.


## Single purpose

Mattermost Deck adds a multi-pane viewing and search workspace to Mattermost Web so users can monitor mentions, channels, direct messages, search results, and saved posts in one place.

## Detailed description

Mattermost Deck adds monitoring-oriented panes to the right side of Mattermost Web. Users can arrange mentions, channels, direct messages, search results with keyword highlighting, and saved posts side by side. Mattermost remains the primary interface for login, posting, editing, team navigation, and thread views.

## Localized detailed descriptions

The extension name and the short description shown under the title come from
`src/_locales/<locale>/messages.json` in the uploaded package, so they need no console entry.
The detailed description below is per-language and must be pasted into the Store listing tab
after a package containing that locale has been uploaded.

### Russian (ru)

Mattermost Deck добавляет панели для мониторинга справа от Mattermost Web. Упоминания, каналы, личные сообщения, результаты поиска с подсветкой ключевых слов и сохранённые сообщения можно расположить рядом друг с другом. Основным интерфейсом для входа, отправки и редактирования сообщений, перехода между командами и просмотра обсуждений остаётся сам Mattermost.

### Ukrainian (uk)

Mattermost Deck додає панелі для стеження праворуч від Mattermost Web. Згадування, канали, особисті повідомлення, результати пошуку з підсвічуванням ключових слів і збережені дописи можна розташувати поруч. Основним інтерфейсом для входу, надсилання та редагування дописів, переходу між командами й перегляду обговорень залишається сам Mattermost.

### Spanish (es)

Mattermost Deck añade paneles de seguimiento a la derecha de Mattermost Web. Puedes colocar en paralelo menciones, canales, mensajes directos, resultados de búsqueda con palabras clave resaltadas y publicaciones guardadas. Mattermost sigue siendo la interfaz principal para iniciar sesión, publicar, editar, cambiar de equipo y ver hilos.

### Korean (ko)

Mattermost Deck은 Mattermost Web 오른쪽에 모니터링용 패널을 추가합니다. 멘션, 채널, 다이렉트 메시지, 키워드가 강조된 검색 결과, 저장한 게시물을 나란히 배치할 수 있습니다. 로그인, 게시, 편집, 팀 이동, 스레드 보기 등 주요 작업은 계속 Mattermost 본체에서 이루어집니다.

## v1.2.0 release notes

- Discover two-row mode through a dismissible one-time shortcut above the panes.
- Arrange panes in one or two rows, with independent scrolling and persistent row placement.
- Resize individual panes and row heights, drag titles to reorder with clear destinations and Escape cancellation, and assign custom titles.
- Keep narrow headers compact, reveal tools on hover, and add panes at each row’s scroll end.
- Preserve post data, search state, and scroll positions during pane moves.

## v1.1.0 release notes

- Added personal favorites with a local cache and subtle star controls.
- Added on-demand search within loaded posts in each pane.
- Kept search typing in the search field instead of the Mattermost composer.

## v1.0.9 release notes

- Reduced unnecessary rendering and observer allocation, and improved connection cleanup during long-running use.
- Added clear wait-and-retry guidance for request timeouts.
- Hardens post-update reinjection, loaded-page polling reconciliation, deletion handling, and response-body timeouts so transient races cannot leave missing or stale rows
- Keeps session-only PATs out of persistent fallback storage and prevents unsaved Server URLs from becoming profile targets

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
