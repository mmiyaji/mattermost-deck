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
    --deck-success: #1ca675;
    --deck-warn: #f0b429;
    --deck-danger: #d24b4e;
    --deck-shadow: 0 12px 28px rgba(7, 16, 30, 0.28);
  }

  * {
    box-sizing: border-box;
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
    padding: 14px 18px 12px 54px;
    border-bottom: 1px solid var(--deck-border);
    background: var(--deck-bg-elevated);
    min-height: 76px;
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
    color: var(--deck-text-faint);
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .deck-topbar-copy {
    min-width: 0;
  }

  .deck-topbar-copy h1,
  .deck-topbar--compact .deck-topbar-copy h1 {
    font-size: calc(16px * var(--deck-font-scale));
    line-height: 1.1;
  }

  .deck-topbar-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .deck-actions-wrap {
    display: none;
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
  }

  .deck-plus-icon {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.8;
    fill: none;
    stroke-linecap: round;
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
    flex: 1 1 auto;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 16px 14px 18px 14px;
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
  }

  .deck-columns {
    display: flex;
    align-items: stretch;
    gap: 12px;
    height: 100%;
  }

  .deck-column {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
  }

  .deck-shell[data-theme="light"] .deck-column {
    background: var(--deck-panel);
    border-color: var(--deck-border);
  }

  .deck-stack--controls {
    padding-bottom: 4px;
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

  .deck-column-header h2 {
    font-size: calc(16px * var(--deck-font-scale));
    line-height: 1.2;
    color: var(--deck-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .deck-post-list {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    gap: 10px;
  }

  .deck-list-viewport {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-right: 2px;
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

  .deck-card--post p {
    margin-top: 8px;
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
    min-width: 36px;
    height: 36px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--deck-accent);
    color: white;
    font-weight: 700;
  }

  .deck-stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
    top: 20px;
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

  .deck-topbar--collapsed .deck-topbar-actions > .deck-icon-button--ghost,
  .deck-topbar--collapsed .deck-topbar-actions > .deck-add-wrap:not(.deck-actions-wrap),
  .deck-topbar--collapsed .deck-eyebrow {
    display: none;
  }

  .deck-topbar--collapsed .deck-actions-wrap {
    display: block;
  }

  @media (max-width: 1100px) {
    .deck-topbar {
      flex-direction: column;
      align-items: stretch;
    }

    .deck-topbar-actions {
      flex-direction: column;
      align-items: stretch;
    }

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
