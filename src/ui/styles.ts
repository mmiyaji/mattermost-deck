export const railCssText = `
  :host {
    color-scheme: dark;
  }

  :host {
    --deck-bg: #1f2f4a;
    --deck-bg-elevated: #22334f;
    --deck-bg-soft: #19283f;
    --deck-panel: #20334f;
    --deck-panel-2: #1b2c45;
    --deck-card: #223650;
    --deck-card-soft: #21344e;
    --deck-border: rgba(255, 255, 255, 0.08);
    --deck-border-strong: rgba(255, 255, 255, 0.12);
    --deck-text: #f2f6fc;
    --deck-text-soft: #b8c7db;
    --deck-text-faint: #8fa4c1;
    --deck-topbar-text: var(--deck-text);
    --deck-topbar-text-soft: var(--deck-text-soft);
    --deck-font-scale: 1;
    --deck-column-width: 320px;
    --deck-accent: #1c58d9;
    --deck-accent-strong: #166de0;
    --deck-accent-soft: rgba(28, 88, 217, 0.18);
    --deck-accent-text: #ffffff;
    --deck-button-bg: #1c58d9;
    --deck-button-text: #ffffff;
    --deck-badge-bg: #ffffff;
    --deck-badge-text: #1e325c;
    --deck-highlight-bg: #ffd470;
    --deck-highlight-text: #1b1d22;
    --deck-success: #1ca675;
    --deck-warn: #f0b429;
    --deck-danger: #d24b4e;
    --deck-shadow: 0 12px 28px rgba(7, 16, 30, 0.28);
  }

  * {
    box-sizing: border-box;
  }

  .deck-hidden-file-input {
    display: none;
  }

  .deck-shell {
    display: flex;
    flex-direction: column;
    gap: 0;
    height: 100vh;
    padding: 0;
    background: var(--deck-bg);
    border-left: 1px solid var(--deck-border);
    font-family: "Segoe UI", "Noto Sans JP", sans-serif;
    color: var(--deck-text);
    position: relative;
    overflow: hidden;
  }

  .deck-shell[data-theme="light"] {
    --deck-bg: #eef3f9;
    --deck-bg-elevated: #f8fbff;
    --deck-bg-soft: #e6edf6;
    --deck-panel: #ffffff;
    --deck-panel-2: #f8fbff;
    --deck-card: #ffffff;
    --deck-card-soft: #f7faff;
    --deck-border: rgba(63, 91, 129, 0.12);
    --deck-border-strong: rgba(63, 91, 129, 0.18);
    --deck-text: #1f2d3d;
    --deck-text-soft: #51657d;
    --deck-text-faint: #6b7f98;
    --deck-accent: #1c58d9;
    --deck-accent-strong: #166de0;
    --deck-accent-soft: rgba(28, 88, 217, 0.1);
    --deck-accent-text: #ffffff;
    --deck-button-bg: #1c58d9;
    --deck-button-text: #ffffff;
    --deck-badge-bg: #ffffff;
    --deck-badge-text: #1e325c;
    --deck-highlight-bg: #ffd470;
    --deck-highlight-text: #1b1d22;
    --deck-shadow: 0 10px 24px rgba(31, 45, 61, 0.08);
    background: var(--deck-bg);
    color: var(--deck-text);
    border-left-color: var(--deck-border);
  }

  .deck-shell--collapsed {
    border-left-color: var(--deck-border-strong);
  }

  .deck-topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 8px 18px 6px 54px;
    border-bottom: 1px solid var(--deck-border);
    background: var(--deck-bg-elevated);
    min-height: 52px;
  }

  .deck-topbar--compact {
    gap: 10px;
    padding-right: 12px;
  }

  .deck-topbar--collapsed {
    gap: 10px;
  }

  .deck-shell[data-theme="light"] .deck-topbar {
    background: var(--deck-bg-elevated);
    border-bottom-color: var(--deck-border);
  }

  .deck-collapsed-banner {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    margin: auto;
    padding: 12px 0;
    color: var(--deck-topbar-text-soft);
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .deck-topbar-copy {
    min-width: 0;
  }

  .deck-topbar-copy h1,
  .deck-topbar--compact .deck-topbar-copy h1 {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    font-size: calc(16px * var(--deck-font-scale));
    line-height: 1.1;
  }

  .deck-version {
    font-size: calc(11px * var(--deck-font-scale));
    font-weight: 500;
    color: var(--deck-topbar-text-soft);
    opacity: 0.78;
    letter-spacing: 0.02em;
  }

  .deck-topbar-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .deck-actions-wrap {
    display: block;
  }

  .deck-add-wrap {
    position: relative;
    flex: none;
  }

  .deck-add-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 220px;
    max-width: 280px;
    max-height: min(70vh, 560px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px;
    border-radius: 10px;
    background: var(--deck-panel);
    border: 1px solid var(--deck-border-strong);
    box-shadow: var(--deck-shadow);
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 5;
  }

  .deck-add-menu--compact {
    min-width: 200px;
  }

  .deck-add-menu--views {
    min-width: 320px;
    max-width: 360px;
  }

  .deck-add-menu--tail {
    position: absolute;
    z-index: 8;
  }

  .deck-add-menu-title {
    padding: 4px 6px 2px;
    font-size: calc(11px * var(--deck-font-scale));
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--deck-text-faint);
  }

  .deck-add-menu-title--secondary {
    margin-top: 4px;
    border-top: 1px solid var(--deck-border);
    padding-top: 8px;
  }

  .deck-add-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--deck-border);
    border-radius: 8px;
    background: var(--deck-card);
    color: var(--deck-text);
    cursor: pointer;
    text-align: left;
  }

  .deck-add-item--secondary {
    background: var(--deck-panel);
  }

  .deck-menu-row--toolbar {
    margin-bottom: 2px;
  }

  .deck-menu-row--toolbar .deck-add-item {
    justify-content: center;
  }

  .deck-menu-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .deck-add-item--recent {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .deck-add-item--recent span {
    display: block;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-add-item--recent small {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--deck-text-faint);
  }

  .deck-view-target {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .deck-view-target-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    height: 26px;
    width: 26px;
    padding: 0;
    border-radius: 999px;
    background: var(--deck-accent-soft);
    color: var(--deck-accent-strong);
  }

  .deck-view-target-glyph--mentions {
    background: color-mix(in srgb, var(--deck-column-accent, #2f6fed) 18%, transparent);
    color: var(--deck-column-accent, #2f6fed);
  }

  .deck-view-target-glyph--channel {
    background: color-mix(in srgb, var(--deck-column-accent, #1f9d7a) 18%, transparent);
    color: var(--deck-column-accent, #1f9d7a);
  }

  .deck-view-target-glyph--dm {
    background: color-mix(in srgb, var(--deck-column-accent, #8b5cf6) 18%, transparent);
    color: var(--deck-column-accent, #8b5cf6);
  }

  .deck-view-target-glyph--search {
    background: color-mix(in srgb, var(--deck-column-accent, #0891b2) 18%, transparent);
    color: var(--deck-column-accent, #0891b2);
  }

  .deck-view-target-glyph--saved {
    background: color-mix(in srgb, var(--deck-column-accent, #c2410c) 18%, transparent);
    color: var(--deck-column-accent, #c2410c);
  }

  .deck-view-target-glyph--diagnostics {
    background: color-mix(in srgb, var(--deck-column-accent, #64748b) 18%, transparent);
    color: var(--deck-column-accent, #64748b);
  }

  .deck-type-icon {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    stroke-width: 1.5;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex: none;
  }

  .deck-type-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
    flex: none;
  }

  .deck-view-target-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }

  .deck-view-target-copy span,
  .deck-view-target-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-view-target-copy span {
    color: var(--deck-text);
    font-weight: 600;
  }

  .deck-view-target-copy small {
    color: var(--deck-text-faint);
  }

  .deck-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 999px;
    font-size: calc(12px * var(--deck-font-scale));
    border: 1px solid var(--deck-border);
    background: var(--deck-accent-soft);
    color: var(--deck-topbar-text);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .deck-status-badge--action {
    cursor: pointer;
  }

  .deck-status-badge--action:hover {
    border-color: color-mix(in srgb, var(--deck-border) 45%, var(--deck-accent) 55%);
  }

  .deck-status-badge--action:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--deck-accent) 22%, transparent);
  }

  .deck-status-badge-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--deck-topbar-text-soft);
  }

  .deck-status-badge--connected .deck-status-badge-dot {
    background: var(--deck-success);
  }

  .deck-status-badge--healthy .deck-status-badge-dot {
    background: var(--deck-success);
  }

  .deck-status-badge--connecting .deck-status-badge-dot,
  .deck-status-badge--reconnecting .deck-status-badge-dot,
  .deck-status-badge--degraded .deck-status-badge-dot {
    background: var(--deck-warn);
  }

  .deck-status-badge--idle .deck-status-badge-dot {
    background: var(--deck-text-faint);
  }

  .deck-status-badge--offline .deck-status-badge-dot,
  .deck-status-badge--error .deck-status-badge-dot {
    background: var(--deck-danger);
  }

  .deck-topbar h1,
  .deck-column-header h2,
  .deck-column-header p,
  .deck-eyebrow,
  .deck-meta,
  .deck-card p {
    margin: 0;
  }

  .deck-topbar h1 {
    color: var(--deck-topbar-text);
  }

  .deck-shell[data-theme="light"] .deck-topbar h1,
  .deck-shell[data-theme="light"] .deck-column-header h2,
  .deck-shell[data-theme="light"] .deck-card,
  .deck-shell[data-theme="light"] .deck-log-text {
    color: var(--deck-text);
  }

  .deck-eyebrow {
    font-size: calc(11px * var(--deck-font-scale));
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--deck-text-faint);
    display: none;
  }

  .deck-button,
  .deck-icon-button,
  .deck-select {
    border: 0;
    border-radius: 999px;
  }

  .deck-button,
  .deck-icon-button {
    background: var(--deck-accent);
    color: white;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }

  .deck-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    font-weight: 600;
    border-radius: 4px;
    background: var(--deck-button-bg);
    color: var(--deck-button-text);
    box-shadow: none;
  }

  .deck-button--secondary {
    background: var(--deck-panel);
    color: var(--deck-text);
    border: 1px solid var(--deck-border);
    box-shadow: none;
  }

  .deck-button-label {
    white-space: nowrap;
  }

  .deck-topbar-button {
    height: 36px;
    padding: 0 12px;
    gap: 8px;
    font-size: calc(12px * var(--deck-font-scale));
  }

  .deck-plus-icon {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.8;
    fill: none;
    stroke-linecap: round;
  }

  .deck-views-icon {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    stroke-width: 1.4;
    fill: none;
  }

  .deck-button:disabled,
  .deck-icon-button:disabled,
  .deck-select:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .deck-icon-button {
    min-width: 36px;
    height: 36px;
    padding: 0 10px;
  }

  .deck-chevron {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.7;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    transform: rotate(90deg);
    transition: transform 140ms ease;
  }

  .deck-chevron--expanded {
    transform: rotate(-90deg);
  }

  .deck-close-icon {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.7;
    fill: none;
    stroke-linecap: round;
  }

  .deck-arrow-icon {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.7;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .deck-arrow-icon--left {
    transform: rotate(180deg);
    transform-origin: 50% 50%;
  }

  .deck-settings-icon {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 1.4;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .deck-menu-inline-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: none;
  }

  .deck-hamburger-icon {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 1.6;
    fill: none;
    stroke-linecap: round;
  }

  .deck-refresh-icon {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    stroke-width: 1.5;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex: none;
  }

  .deck-refresh-icon--spinning {
    animation: deck-spin 0.9s linear infinite;
  }

  .deck-drawer-icon {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.7;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    transform: rotate(180deg);
    transform-origin: 50% 50%;
  }

  .deck-drawer-icon--open {
    transform: none;
  }

  .deck-icon-button--ghost {
    background: rgba(255, 255, 255, 0.08);
    color: var(--deck-topbar-text);
    box-shadow: none;
    border: 1px solid var(--deck-border);
  }

  /* Pane-area and floating-menu buttons sit over the center-channel background,
     so use --deck-text (center-channel text color) instead of --deck-topbar-text
     (sidebar text color, which is white in many Mattermost themes). */
  .deck-column .deck-icon-button--ghost,
  .deck-add-menu .deck-icon-button--ghost {
    color: var(--deck-text);
    background: color-mix(in srgb, var(--deck-text) 5%, transparent);
  }

  .deck-icon-button--active {
    background: rgba(217, 119, 6, 0.18);
    color: #f59e0b;
    border-color: rgba(217, 119, 6, 0.35);
  }

  .deck-shell[data-theme="light"] .deck-icon-button--active {
    background: rgba(217, 119, 6, 0.12);
    color: #b45309;
    border-color: rgba(217, 119, 6, 0.3);
  }

  .deck-icon-button--plain {
    background: transparent;
    color: var(--deck-topbar-text);
    box-shadow: none;
    border: 0;
  }

  .deck-meta {
    margin-top: 2px;
    font-size: calc(11px * var(--deck-font-scale));
    line-height: 1.15;
    color: var(--deck-topbar-text-soft);
  }

  .deck-meta--compact {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-shell[data-theme="light"] .deck-meta,
  .deck-shell[data-theme="light"] .deck-column-header p,
  .deck-shell[data-theme="light"] .deck-log-time,
  .deck-shell[data-theme="light"] .deck-settings-copy p,
  .deck-shell[data-theme="light"] .deck-field {
    color: var(--deck-text-soft);
  }

  .deck-status-inline {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 180px;
    padding: 8px 10px;
    border-radius: 999px;
    background: var(--deck-bg-soft);
    border: 1px solid var(--deck-border);
    font-size: calc(12px * var(--deck-font-scale));
    color: var(--deck-text-soft);
  }

  .deck-status-inline span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-status-inline--hidden {
    display: none;
  }

  .deck-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--deck-success);
    flex: none;
  }

  .deck-scroll-wrap {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0px 14px 8px 14px;
    scrollbar-color: rgba(143, 164, 193, 0.45) transparent;
  }

  .deck-settings-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin: 0 0 12px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--deck-panel);
    border: 1px solid var(--deck-border);
  }

  .deck-settings-copy {
    min-width: 0;
  }

  .deck-settings-copy strong,
  .deck-settings-copy p {
    margin: 0;
  }

  .deck-settings-copy p {
    margin-top: 4px;
    font-size: 12px;
    color: #88a6cf;
  }

  .deck-settings-controls {
    display: flex;
    align-items: end;
    gap: 10px;
    flex-wrap: wrap;
    flex: none;
  }

  .deck-log-panel {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--deck-panel);
    border: 1px solid var(--deck-border);
    color: var(--deck-text);
  }

  .deck-shell[data-theme="light"] .deck-log-panel,
  .deck-shell[data-theme="light"] .deck-settings-panel {
    background: var(--deck-panel);
    border-color: var(--deck-border);
  }

  .deck-log-title {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--deck-text-faint);
    margin-bottom: 8px;
  }

  .deck-log-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .deck-log-entry {
    display: flex;
    gap: 10px;
    font-size: 12px;
    line-height: 1.4;
    min-width: 0;
  }

  .deck-log-entry--warn .deck-log-text {
    color: #d99a1e;
  }

  .deck-log-entry--error .deck-log-text {
    color: var(--deck-danger);
  }

  .deck-log-time {
    flex: none;
    color: var(--deck-text-faint);
  }

  .deck-log-text {
    color: var(--deck-text);
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-columns {
    display: flex;
    align-items: stretch;
    flex: 1 1 auto;
    gap: 12px;
    height: 100%;
    min-height: 0;
  }

  .deck-column-tail {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    flex: none;
    width: 44px;
    padding-top: 12px;
    z-index: 1;
  }

  .deck-column-add-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    border: 1px solid var(--deck-border);
    background: var(--deck-panel);
    color: var(--deck-text);
    cursor: pointer;
    position: relative;
    z-index: 2;
    pointer-events: auto;
  }

  .deck-column-motion {
    display: flex;
    flex: none;
    height: 100%;
    min-height: 0;
    will-change: transform;
  }

  .deck-column {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    min-height: 0;
    width: var(--deck-column-width);
    min-width: var(--deck-column-width);
    max-width: var(--deck-column-width);
    padding: 12px;
    border-radius: 10px;
    background: var(--deck-panel);
    border: 1px solid var(--deck-border);
    box-shadow: var(--deck-shadow);
    overflow: hidden;
    position: relative;
  }

  .deck-column::before {
    content: none;
  }

  .deck-shell[data-column-color-enabled="true"] .deck-column::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--deck-column-accent);
  }

  .deck-shell[data-theme="light"] .deck-column {
    background: var(--deck-panel);
    border-color: var(--deck-border);
  }

  .deck-stack--controls {
    flex: 0 0 auto;
    padding: 6px 0 8px;
    border-bottom: 1px solid var(--deck-border);
    margin-bottom: 4px;
  }

  .deck-inline-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .deck-column-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .deck-column-heading {
    min-width: 0;
    flex: 1 1 auto;
  }

  .deck-column-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .deck-inline-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .deck-inline-actions--stack {
    flex-direction: column;
    gap: 8px;
  }

  .deck-column-header h2 {
    font-size: calc(16px * var(--deck-font-scale));
    line-height: 1.2;
    color: var(--deck-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-title-with-icon {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .deck-search-icon {
    width: 14px;
    height: 14px;
    flex: none;
    stroke: currentColor;
    stroke-width: 1.5;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .deck-column-header p {
    margin-top: 4px;
    font-size: calc(12px * var(--deck-font-scale));
    color: var(--deck-text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-controls {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .deck-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: calc(12px * var(--deck-font-scale));
    color: var(--deck-text-soft);
  }

  .deck-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--deck-text);
  }

  .deck-field--inline {
    min-width: 280px;
  }

  .deck-shell .mm-custom-select {
    position: relative;
  }

  .deck-shell .mm-custom-select-button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 42px;
    padding: 10px 12px;
    border: 1px solid var(--deck-border);
    border-radius: 10px;
    background: var(--deck-card);
    color: var(--deck-text);
    text-align: left;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
  }

  .deck-shell .mm-custom-select-button:hover {
    border-color: color-mix(in srgb, var(--deck-border) 56%, var(--deck-accent) 44%);
  }

  .deck-shell .mm-custom-select-button:focus-visible {
    outline: none;
    border-color: color-mix(in srgb, var(--deck-border) 40%, var(--deck-accent) 60%);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--deck-accent) 22%, transparent);
  }

  .deck-shell .mm-custom-select-button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .deck-shell .mm-custom-select-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-shell .mm-custom-select-label--placeholder {
    color: var(--deck-text-faint);
  }

  .deck-shell .mm-custom-select-chevron {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.7;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    transform: rotate(90deg);
    transition: transform 140ms ease;
  }

  .deck-shell .mm-custom-select-chevron--expanded {
    transform: rotate(-90deg);
  }

  .deck-shell .mm-custom-select-menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    max-height: 240px;
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--deck-border-strong);
    border-radius: 12px;
    background: var(--deck-panel);
    box-shadow:
      var(--deck-shadow),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(10px);
    z-index: 8;
  }

  .deck-shell .mm-custom-select-current {
    padding: 6px 8px 8px;
  }

  .deck-shell .mm-custom-select-current-label {
    display: block;
    padding: 9px 12px;
    border-radius: 8px;
    background: var(--deck-card);
    color: var(--deck-text-soft);
    font-size: calc(12px * var(--deck-font-scale));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-shell .mm-custom-select-current-label--placeholder {
    color: var(--deck-text-faint);
  }

  .deck-shell .mm-custom-select-divider {
    height: 1px;
    margin: 2px 8px 8px;
    background: var(--deck-border);
  }

  .deck-shell .mm-custom-select-option {
    display: block;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--deck-text);
    text-align: left;
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
  }

  .deck-shell .mm-custom-select-option:hover {
    background: color-mix(in srgb, var(--deck-card) 76%, var(--deck-accent) 24%);
    border-color: color-mix(in srgb, var(--deck-border) 54%, var(--deck-accent) 46%);
  }

  .deck-shell .mm-custom-select-option:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--deck-accent) 22%, transparent);
    border-color: color-mix(in srgb, var(--deck-border) 40%, var(--deck-accent) 60%);
  }

  .deck-shell .mm-custom-select-option--selected {
    background: color-mix(in srgb, var(--deck-card) 68%, var(--deck-accent) 32%);
    border-color: color-mix(in srgb, var(--deck-border) 44%, var(--deck-accent) 56%);
  }

  .deck-shell .mm-custom-select-option--focused {
    background: color-mix(in srgb, var(--deck-card) 76%, var(--deck-accent) 24%);
    border-color: color-mix(in srgb, var(--deck-border) 40%, var(--deck-accent) 60%);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--deck-accent) 22%, transparent);
  }

  .deck-shell .mm-custom-select-option--placeholder {
    color: var(--deck-text-faint);
  }

  .deck-shell .mm-custom-select-search {
    padding: 4px 6px 6px;
  }

  .deck-shell .mm-custom-select-search-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--deck-border);
    border-radius: 7px;
    background: var(--deck-bg-soft);
    color: var(--deck-text);
    font-size: calc(12px * var(--deck-font-scale));
    outline: none;
    box-sizing: border-box;
  }

  .deck-shell .mm-custom-select-search-input:focus {
    border-color: color-mix(in srgb, var(--deck-border) 40%, var(--deck-accent) 60%);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--deck-accent) 22%, transparent);
  }

  .deck-shell .mm-custom-select-empty {
    padding: 10px 12px;
    color: var(--deck-text-faint);
    font-size: calc(12px * var(--deck-font-scale));
    text-align: center;
  }

  .deck-shell[data-theme="light"] .mm-custom-select-button {
    background: var(--deck-card);
  }

  .deck-shell[data-theme="light"] .mm-custom-select-menu {
    background: var(--deck-panel);
  }

  .deck-select {
    width: 100%;
    padding: 10px 12px;
    background: var(--deck-bg-soft);
    border: 1px solid var(--deck-border);
    color: var(--deck-text);
    border-radius: 8px;
    appearance: auto;
    color-scheme: dark;
  }

  .deck-shell[data-theme="light"] .deck-select,
  .deck-shell[data-theme="light"] .deck-input {
    background: var(--deck-bg-elevated);
    color: var(--deck-text);
    border-color: var(--deck-border);
    color-scheme: light;
  }

  .deck-select option {
    background: var(--deck-panel);
    color: var(--deck-text);
  }

  .deck-shell[data-theme="light"] .deck-select option {
    background: var(--deck-panel);
    color: var(--deck-text);
  }

  .deck-input {
    width: 100%;
    padding: 10px 12px;
    background: var(--deck-bg-soft);
    border: 1px solid var(--deck-border);
    color: var(--deck-text);
    border-radius: 8px;
    outline: none;
  }

  .deck-input::placeholder {
    color: var(--deck-text-faint);
  }

  .deck-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .deck-list-separator {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 2px 0 0;
    color: var(--deck-text-faint);
    font-size: calc(11px * var(--deck-font-scale));
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    list-style: none;
  }

  .deck-list-separator::before,
  .deck-list-separator::after {
    content: "";
    flex: 1 1 auto;
    height: 1px;
    background: var(--deck-border);
  }

  .deck-list-separator span {
    flex: none;
  }

  .deck-post-list {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    gap: 10px;
  }

  .deck-post-list--content-fit {
    flex: 0 0 auto;
  }

  .deck-list-viewport {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-right: 2px;
  }

  .deck-list-viewport--content-fit {
    flex: 0 0 auto;
    overflow-y: auto;
  }

  .deck-list-spacer {
    position: relative;
    min-height: 100%;
  }

  .deck-list--virtual {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
  }

  .deck-list-footer {
    display: flex;
    justify-content: center;
    padding: 8px 0;
  }

  .deck-list-end {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    color: rgba(143, 172, 213, 0.45);
    font-size: 11px;
  }

  .deck-list-end::before,
  .deck-list-end::after {
    content: "";
    flex: 1;
    height: 1px;
    background: rgba(123, 178, 255, 0.1);
  }

  .deck-shell[data-theme="light"] .deck-list-end,
  .deck-shell[data-theme="mattermost"] .deck-list-end {
    color: var(--deck-text-faint);
  }

  .deck-shell[data-theme="light"] .deck-list-end::before,
  .deck-shell[data-theme="light"] .deck-list-end::after,
  .deck-shell[data-theme="mattermost"] .deck-list-end::before,
  .deck-shell[data-theme="mattermost"] .deck-list-end::after {
    background: var(--deck-border);
  }

  .deck-list-floating-action {
    display: flex;
    justify-content: center;
  }

  .deck-new-posts-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 88px;
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--deck-column-accent, var(--deck-accent)) 36%, var(--deck-border) 64%);
    background: color-mix(in srgb, var(--deck-column-accent, var(--deck-accent)) 14%, var(--deck-panel) 86%);
    color: var(--deck-text);
    cursor: pointer;
  }

  .deck-load-more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 120px;
    height: 34px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid var(--deck-border);
    background: rgba(255, 255, 255, 0.08);
    color: var(--deck-text-soft);
    cursor: pointer;
  }

  .deck-load-more:disabled {
    opacity: 0.55;
    cursor: default;
  }

  @keyframes deck-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .deck-card {
    padding: 12px;
    border-radius: 10px;
    background: var(--deck-card);
    border: 1px solid var(--deck-border);
    font-size: calc(13px * var(--deck-font-scale));
    line-height: 1.45;
    color: var(--deck-text);
  }

  .deck-card-caption {
    margin: 8px 0 0;
    color: var(--deck-text-faint);
    font-size: calc(11px * var(--deck-font-scale));
  }

  .deck-metric-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .deck-card--metric strong {
    display: block;
    margin-bottom: 6px;
  }

  .deck-card--metric p {
    margin: 0;
    font-size: calc(18px * var(--deck-font-scale));
    font-weight: 700;
    line-height: 1.1;
  }

  .deck-card--metric span {
    display: block;
    margin-top: 6px;
    color: var(--deck-text-faint);
    font-size: calc(11px * var(--deck-font-scale));
  }

  .deck-metric-chart-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }

  .deck-metric-chart-header span {
    color: var(--deck-text-faint);
    font-size: calc(11px * var(--deck-font-scale));
  }

  .deck-sparkline {
    display: block;
    width: 100%;
    height: 42px;
    overflow: visible;
  }

  .deck-sparkline-line {
    fill: none;
    stroke: var(--deck-accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .deck-sparkline-hover-line {
    stroke: var(--deck-text-muted);
    stroke-width: 1;
    stroke-dasharray: 2 2;
    pointer-events: none;
  }

  .deck-sparkline-hover-dot {
    fill: var(--deck-accent);
    stroke: var(--deck-card);
    stroke-width: 1.5;
    pointer-events: none;
  }

  .deck-sparkline-hover-label {
    fill: var(--deck-text);
    font-size: 9px;
    font-family: var(--deck-font);
    pointer-events: none;
    dominant-baseline: auto;
  }

  .deck-shell[data-theme="light"] .deck-card {
    background: var(--deck-card);
    border-color: var(--deck-border);
  }

  .deck-card--muted {
    background: var(--deck-bg-soft);
  }

  .deck-card strong {
    display: block;
    margin-bottom: 4px;
  }

  .search-highlight {
    display: inline-block;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--deck-highlight-bg);
    color: var(--deck-highlight-text);
    font-weight: 700;
  }

  .deck-card--post p {
    margin-top: 8px;
  }

  .deck-card--post-compact {
    padding: 10px;
  }

  .deck-card--post-compact p {
    margin-top: 6px;
    font-size: calc(12px * var(--deck-font-scale));
    line-height: 1.35;
  }

  .deck-card--clickable {
    cursor: pointer;
  }

  .deck-card--clickable:hover {
    border-color: color-mix(in srgb, var(--deck-border) 52%, var(--deck-accent) 48%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--deck-accent) 18%, transparent);
  }

  .deck-card-meta {
    margin-top: 6px;
    font-size: calc(11px * var(--deck-font-scale));
    color: var(--deck-text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-card-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--deck-text-faint);
    font-size: calc(12px * var(--deck-font-scale));
  }

  .deck-shell[data-theme="light"] .deck-card-header {
    color: var(--deck-text-faint);
  }

  .deck-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--deck-badge-bg);
    color: var(--deck-badge-text);
    font-weight: 700;
    font-size: calc(12px * var(--deck-font-scale));
    line-height: 1;
  }

  .deck-stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* ── ファイル添付 ─────────────────────────────── */
  .deck-post-files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  .deck-file-thumb-wrap {
    display: inline-block;
    cursor: zoom-in;
    background: none;
    border: none;
    padding: 0;
    border-radius: 6px;
    transition: opacity 0.12s;
  }

  .deck-file-thumb-wrap:hover {
    opacity: 0.85;
  }

  .deck-file-thumb {
    display: block;
    width: 80px;
    height: 60px;
    object-fit: cover;
    border-radius: 6px;
    background: var(--deck-border);
  }

  .deck-lightbox-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0, 0, 0, 0.88);
  }

  /* ── top-right toolbar ─────────────────────────────────────────── */
  .deck-lightbox-toolbar {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    z-index: 1;
  }

  .deck-lightbox-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.12);
    border: none;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    text-decoration: none;
    transition: background 0.12s, color 0.12s;
    line-height: 0;
  }

  .deck-lightbox-btn:hover {
    background: rgba(255, 255, 255, 0.22);
    color: #fff;
  }

  .deck-lightbox-btn--close:hover {
    background: rgba(220, 53, 69, 0.75);
  }

  /* ── image stage ────────────────────────────────────────────────── */
  .deck-lightbox-stage {
    position: absolute;
    inset: 0 0 52px 0;
    overflow: hidden;
    cursor: grab;
    user-select: none;
  }

  .deck-lightbox-stage--grabbing {
    cursor: grabbing;
  }

  .deck-lightbox-img {
    position: absolute;
    top: 50%;
    left: 50%;
    width: auto;
    height: auto;
    transform-origin: center center;
    cursor: zoom-in;
    user-select: none;
    -webkit-user-drag: none;
  }

  .deck-lightbox-stage--grabbing .deck-lightbox-img {
    cursor: grabbing;
  }

  /* ── bottom controls ────────────────────────────────────────────── */
  .deck-lightbox-controls {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    gap: 8px;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
  }

  .deck-lightbox-filename {
    flex: 1;
    min-width: 0;
    font-size: calc(12px * var(--deck-font-scale));
    color: rgba(255, 255, 255, 0.65);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-lightbox-zoom-group {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }

  .deck-lightbox-ctrl {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
    line-height: 0;
  }

  .deck-lightbox-ctrl:hover {
    background: rgba(255, 255, 255, 0.22);
    color: #fff;
  }

  .deck-lightbox-ctrl--scale {
    min-width: 56px;
    font-size: calc(12px * var(--deck-font-scale));
    font-variant-numeric: tabular-nums;
  }

  .deck-file-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: var(--deck-surface);
    border: 1px solid var(--deck-border);
    border-radius: 6px;
    text-decoration: none;
    color: var(--deck-text);
    max-width: 180px;
    font-size: calc(12px * var(--deck-font-scale));
    font-family: inherit;
    cursor: pointer;
    transition: background 0.12s;
  }

  .deck-file-card:hover {
    background: var(--deck-surface-hover, rgba(255,255,255,0.06));
  }

  .deck-file-icon {
    flex: none;
    display: flex;
    align-items: center;
    color: var(--deck-accent);
    line-height: 0;
  }

  .deck-file-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-file-size {
    flex: none;
    font-size: calc(10px * var(--deck-font-scale));
    color: var(--deck-text-faint);
  }

  /* ── 保存済み検索 ─────────────────────────────── */
  .deck-saved-searches {
    margin-top: 4px;
  }

  .deck-saved-searches-label {
    font-size: calc(11px * var(--deck-font-scale));
    color: var(--deck-text-faint);
    display: block;
    margin-bottom: 4px;
  }

  .deck-saved-searches-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .deck-saved-search-chip {
    display: flex;
    align-items: center;
    background: var(--deck-accent-soft);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 999px;
    overflow: hidden;
  }

  .deck-saved-search-apply {
    padding: 3px 8px 3px 10px;
    background: none;
    border: none;
    color: var(--deck-text);
    font-size: calc(12px * var(--deck-font-scale));
    cursor: pointer;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-saved-search-apply:hover {
    color: var(--deck-accent);
  }

  .deck-saved-search-delete {
    padding: 3px 7px 3px 3px;
    background: none;
    border: none;
    color: var(--deck-text-faint);
    font-size: 14px;
    cursor: pointer;
    line-height: 1;
  }

  .deck-saved-search-delete:hover {
    color: var(--deck-danger);
  }

  .deck-column--diagnostics .deck-stack {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-right: 2px;
  }

  .deck-column--diagnostics .deck-stack--controls {
    flex: 0 0 auto;
    min-height: 0;
    overflow-y: visible;
  }

  .deck-menu-row {
    display: flex;
    align-items: stretch;
    gap: 8px;
  }

  .deck-menu-row--view .deck-add-item {
    flex: 1 1 auto;
    min-width: 0;
  }

  .deck-menu-row--view .deck-icon-button {
    align-self: center;
  }

  .deck-resizer {
    position: absolute;
    top: 0;
    left: 0;
    width: 14px;
    height: 100%;
    padding: 0;
    background: transparent;
    border: 0;
    cursor: col-resize;
    z-index: 2;
  }

  .deck-resizer span {
    position: absolute;
    top: 50%;
    left: 5px;
    transform: translateY(-50%);
    width: 4px;
    height: 84px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
  }

  .deck-resizer--active span,
  .deck-resizer:hover span {
    background: rgba(28, 88, 217, 0.8);
  }

  .deck-drawer-toggle {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 999px;
    background: var(--deck-panel);
    color: var(--deck-text-soft);
    line-height: 1;
    cursor: pointer;
    border: 1px solid var(--deck-border);
  }

  .deck-topbar--collapsed .deck-topbar-actions > .deck-add-wrap:not(.deck-actions-wrap),
  .deck-topbar--collapsed .deck-eyebrow {
    display: none;
  }

  @media (max-width: 1100px) {
    .deck-status-inline {
      max-width: none;
    }

    .deck-settings-panel {
      flex-direction: column;
      align-items: stretch;
    }

    .deck-settings-controls {
      align-items: stretch;
    }

    .deck-field--inline {
      min-width: 0;
    }
  }
`;
