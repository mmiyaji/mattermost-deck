/** Deck settings: the same navy chrome, quiet surfaces and readable rows as the app. */
export const settingsShellCss = `
  html, body { width: 100%; height: 100%; margin: 0; padding: 0; }
  /* Only the sidebar and panel scroll. hidden would let scrollIntoView move
     these shells too, shifting the fixed header/footer and leaving a gap. */
  #options-root { position: fixed; inset: 0; overflow: clip; }
  .options-app { height: 100%; min-height: 0; overflow: clip; }
  .options-body { overflow: clip; }
  :root { font-family: "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif; }
  body {
    --settings-bg: #111c2e; --settings-surface: #18253a; --settings-subtle: #1c2c43;
    --settings-text: #e8edf5; --settings-muted: #b6c3d5; --settings-border: #3b4b63;
    --settings-accent: #9dbbff; --settings-focus: #93b4ff; --settings-selected: #263b5a;
    --settings-primary: #b8ceff; --settings-primary-text: #15233e;
    --perf-axis: var(--settings-muted); --perf-grid: var(--settings-border);
  }
  body[data-theme="light"] {
    --settings-bg: #ffffff; --settings-surface: #ffffff; --settings-subtle: #f6f7f9;
    --settings-text: #252a34; --settings-muted: #5d6573; --settings-border: #dce0e6;
    --settings-accent: #214a8d; --settings-focus: #315faa; --settings-selected: #e7edf6;
    --settings-primary: #182948; --settings-primary-text: #ffffff;
  }
  body[data-theme] { background: var(--settings-bg); color: var(--settings-text); font-family: inherit; }
  body[data-theme] .options-topbar {
    background: #16233f; color: #f5f7fc; border-bottom: 1px solid #283854;
    min-height: 66px; padding: 14px 28px; gap: 18px 28px; backdrop-filter: none;
  }
  .options-topbar-brand { gap: 12px; }
  .options-topbar-brand h1 { font-size: 19px; font-weight: 650; letter-spacing: .01em; }
  body[data-theme] .options-topbar .options-version { background: #293750; color: #e2e8f3; font-size: 12px; padding: 4px 10px; }
  body[data-theme] .options-topbar .options-editing-target { color: #e2e8f3; border-left: 1px solid #536078; padding-left: 24px; }
  body[data-theme] .options-topbar .options-editing-target > span:first-child { color: #bac7dd; }
  .options-editing-target > strong { max-width: min(45vw, 650px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .options-theme-control { margin-left: auto; display: flex; align-items: center; gap: 10px; position: relative; font-size: 12px; }
  .options-theme-buttons { display: flex; gap: 3px; padding: 3px; border: 1px solid #67768e; border-radius: 8px; background: #101c32; }
  .options-theme-buttons button { display: inline-flex; justify-content: center; align-items: center; width: 34px; height: 32px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #c7d2e4; cursor: pointer; }
  .options-theme-buttons button:hover { background: #2d405f; color: #fff; }
  .options-theme-buttons button[aria-pressed="true"] { background: #dce7ff; color: #172845; border-color: #fff; }
  .options-theme-buttons button:disabled { cursor: wait; }
  @media (forced-colors: active) { .options-theme-buttons button[aria-pressed="true"] { border-color: Highlight; color: Highlight; } }
  .options-theme-error { position: absolute; top: calc(100% + 8px); right: 0; width: 260px; padding: 10px; background: var(--settings-surface); color: var(--settings-text); border: 1px solid var(--settings-border); border-radius: 6px; z-index: 20; }
  @media (max-width: 900px) { .options-theme-control > span:first-child { display: none; } }
  @media (max-width: 720px) { .options-theme-control { order: 2; } .options-editing-target { order: 3; } .options-topbar-brand { flex-wrap: wrap; } }
  body[data-theme] .options-sidebar {
    width: 224px; background: var(--settings-subtle); border-right: 1px solid var(--settings-border);
  }
  .options-sidebar-nav { padding: 18px 14px; }
  body[data-theme] .options-nav-group > h2 { color: var(--settings-muted); font-size: 12px; padding: 10px 12px; }
  body[data-theme] .options-nav-group + .options-nav-group { border-color: var(--settings-border); margin-top: 18px; padding-top: 18px; }
  body[data-theme] .options-nav-item {
    min-height: 43px; padding: 11px 12px; gap: 12px; border-radius: 7px;
    color: var(--settings-text); font-size: 14px; line-height: 1.35;
  }
  body[data-theme] .options-nav-item:hover { background: var(--settings-selected); color: var(--settings-text); }
  body[data-theme] .options-nav-item.active { background: var(--settings-selected); color: var(--settings-accent); font-weight: 650; }
  body[data-theme] .options-sidebar-footer { border-color: var(--settings-border); gap: 9px; padding: 16px; }
  body[data-theme] .options-sidebar-footer a, body[data-theme] .options-sidebar-copyright { color: var(--settings-muted); }
  body[data-theme] .options-sidebar-open-btn { background: var(--settings-surface); border: 1px solid var(--settings-border); color: var(--settings-text); }
  .options-content, .options-panel-scroll { min-width: 0; }
  .options-panel-scroll { scroll-padding: 28px; }
  .options-panel, .options-panel--appearance { max-width: 1120px; margin: 0; padding: 30px 40px 40px; gap: 26px; min-width: 0; }
  .options-panel--appearance, .options-panel--wide { max-width: none; }
  body[data-theme] .options-panel-header { border-bottom-color: var(--settings-border); padding-bottom: 24px; gap: 10px; }
  .options-panel-header h2 { font-size: 24px; font-weight: 650; letter-spacing: .015em; line-height: 1.4; }
  body[data-theme] .options-panel-header p { color: var(--settings-muted); font-size: 14px; line-height: 1.7; margin-top: 6px; }
  body[data-theme] .options-label { color: var(--settings-text); font-size: 13px; font-weight: 600; line-height: 1.5; }
  body[data-theme] .options-hint, body[data-theme] .options-copy, body[data-theme] .options-status { color: var(--settings-muted); font-size: 12px; line-height: 1.65; }
  body[data-theme] .options-input {
    background: var(--settings-surface); border: 1px solid var(--settings-border); border-radius: 6px;
    color: var(--settings-text); min-width: 0; font-size: 14px;
  }
  body[data-theme] .options-input:focus { border-color: var(--settings-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--settings-focus) 18%, transparent); }
  body[data-theme] .options-content .mm-custom-select-button,
  body[data-theme] .options-content .mm-custom-select-search-input {
    background: var(--settings-surface); color: var(--settings-text); border-color: var(--settings-border); border-radius: 6px;
  }
  body[data-theme] .options-content .mm-custom-select-menu { background: var(--settings-surface); color: var(--settings-text); border-color: var(--settings-border); }
  body[data-theme] .options-content .mm-custom-select-current-label,
  body[data-theme] .options-content .mm-custom-select-label--placeholder,
  body[data-theme] .options-content .mm-custom-select-empty { color: var(--settings-muted); }
  body[data-theme] .options-content .mm-custom-select-option:hover,
  body[data-theme] .options-content .mm-custom-select-option--focused,
  body[data-theme] .options-content .mm-custom-select-option--selected { background: var(--settings-selected); color: var(--settings-text); }
  body[data-theme] .options-content .mm-custom-select-divider { border-color: var(--settings-border); }
  body[data-theme] .options-button {
    background: var(--settings-primary); color: var(--settings-primary-text); border: 1px solid transparent;
    border-radius: 6px; min-height: 38px; height: auto; padding: 9px 16px; line-height: 1.35; font-size: 13px;
    max-width: 100%; white-space: normal; overflow-wrap: anywhere;
  }
  .options-inline { flex-wrap: wrap; min-width: 0; }
  .options-inline .options-input { min-width: 0; }
  body[data-theme] .options-button:hover:not(:disabled) { filter: brightness(.96); }
  body[data-theme] .options-button--ghost,
  body[data-theme] [data-testid="options-clear-body-cache"],
  body[data-theme] .options-panel-expand {
    background: var(--settings-surface); border: 1px solid var(--settings-border); color: var(--settings-text);
  }
  body[data-theme] .options-choice { line-height: 1.65; }
  body[data-theme] .options-choice input { accent-color: var(--settings-accent); }
  body[data-theme] .options-field, .options-inline, .options-grid > *, .options-panel-header-copy { min-width: 0; }
  body[data-theme] .options-callout { background: var(--settings-subtle); border-color: var(--settings-border); border-radius: 6px; }
  body[data-theme] .options-callout strong, body[data-theme] .options-callout p { color: var(--settings-text); }
  body[data-theme] .options-connection-advanced,
  body[data-theme] .options-width-diagram,
  body[data-theme] .options-subsection,
  body[data-theme] .options-appearance-group > h3 { border-color: var(--settings-border); }
  body[data-theme] .options-subsection-label { color: var(--settings-muted); }
  body[data-theme] .options-inline-links a, body[data-theme] .options-mobile-links a { color: var(--settings-accent); }
  body[data-theme] .options-divider { background: var(--settings-border); }
  body[data-theme] .options-color-item { background: var(--settings-surface); border-color: var(--settings-border); }
  .options-banner-stack { max-width: 1120px; margin: 0; padding: 24px 40px 0; }
  body[data-theme] .options-metric-card, body[data-theme] .options-analysis-card { background: var(--settings-subtle); color: var(--settings-text); border-color: var(--settings-border); border-radius: 7px; }
  body[data-theme] .options-table-main, body[data-theme] .options-log-main, body[data-theme] .options-table-sort:hover { color: var(--settings-text); }
  body[data-theme] .options-table-url, body[data-theme] .options-table-heading, body[data-theme] .options-table-sort,
  body[data-theme] .options-log-meta { color: var(--settings-muted); }
  body[data-theme] .options-table th, body[data-theme] .options-table td { border-color: var(--settings-border); }
  body[data-theme] .options-save-footer { background: var(--settings-surface); border-top: 1px solid var(--settings-border); padding: 16px 40px; backdrop-filter: none; }
  .options-save-footer-inner { max-width: none; margin: 0; min-width: 0; }
  .options-save-actions .options-button { min-width: 86px; }
  body[data-theme] .options-status--error, body[data-theme] .options-required-hint { color: #ffb5af; }
  body[data-theme="light"] .options-status--error, body[data-theme="light"] .options-required-hint { color: #b33a35; }
  body[data-theme="light"] .options-required-badge { color: #a8322c; background: #ffedea; }
  body[data-theme] .options-switch-dialog, body[data-theme] .options-modal { background: var(--settings-surface); color: var(--settings-text); border-color: var(--settings-border); }
  body[data-theme] :is(button, input, select, summary, a):focus-visible { outline: 2px solid var(--settings-focus); outline-offset: 3px; }
  .options-required-note { margin: 0 0 16px; font-size: 12px; color: var(--settings-muted); }
  body[data-theme] .options-required-marker { color: #ffb5af; font-weight: 700; }
  body[data-theme="light"] .options-required-marker { color: #b33a35; }
  .options-setting-list { display: flex; flex-direction: column; gap: 0; }
  .options-setting-list > .options-field { padding: 22px 0; gap: 10px; border-bottom: 1px solid var(--settings-border); }
  .options-setting-list > .options-field:first-child { padding-top: 0; }
  .options-setting-list > .options-field:last-child { border-bottom: 0; }
  .options-setting-list > .options-field > .options-label { font-size: 15px; font-weight: 650; }
  .options-setting-list .options-choice { font-size: 13px; align-items: center; }
  .options-setting-list .options-button { align-self: start; }
  .options-setting-list .options-field--toggle { position: relative; padding-right: 76px; min-height: 90px; }
  .options-setting-list .options-field--toggle input[type="checkbox"] {
    appearance: none; position: absolute; right: 0; top: 27px; width: 44px; height: 25px;
    border-radius: 20px; border: 1px solid var(--settings-border); background: var(--settings-muted); margin: 0; cursor: pointer;
  }
  .options-setting-list .options-field--toggle:first-child input[type="checkbox"] { top: 10px; }
  .options-setting-list .options-field--toggle input[type="checkbox"]::after {
    content: ""; position: absolute; width: 19px; height: 19px; top: 2px; left: 2px;
    border-radius: 50%; background: #fff;
  }
  .options-setting-list .options-field--toggle input[type="checkbox"]:checked { background: #244c94; border-color: #244c94; }
  .options-setting-list .options-field--toggle input[type="checkbox"]:checked::after { left: 21px; }
  .options-setting-list .options-field--toggle .options-choice { cursor: pointer; }
  .options-toggle-state { align-self: start; font-size: 12px; font-weight: 650; color: var(--settings-text); }
  .options-toggle-state > span { font-weight: 400; color: var(--settings-muted); }
  .options-cache-retention { border: 0; margin: 16px 0 10px; padding: 0; min-width: 0; }
  .options-cache-retention legend { font-weight: 650; margin-bottom: 10px; }
  .options-cache-retention-choices { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .options-cache-retention-choices label { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border: 2px solid var(--settings-border); border-radius: 6px; background: var(--settings-surface); cursor: pointer; }
  .options-cache-retention-choices label.is-selected { border-color: var(--settings-accent); background: var(--settings-selected); font-weight: 700; }
  .options-cache-retention-choices input { appearance: auto; width: 20px; height: 20px; margin: 0; accent-color: var(--settings-accent); flex-shrink: 0; }
  .performance-preset { display: grid; gap: 12px; }
  .performance-preset > p { margin: 0; }
  .performance-preset-choices { min-width: 0; margin: 0; padding: 0; border: 0; }
  .performance-preset-choices legend { margin-bottom: 8px; color: var(--settings-text); font-size: 13px; font-weight: 650; }
  .performance-preset-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .performance-preset-card { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-content: start; align-items: start; gap: 2px 10px; min-width: 0; min-height: 92px; padding: 12px; border: 1px solid var(--settings-border); border-radius: 7px; background: var(--settings-surface); color: var(--settings-text); cursor: pointer; }
  .performance-preset-card:has(input:checked) { border-color: var(--settings-accent); background: var(--settings-selected); box-shadow: inset 0 0 0 1px var(--settings-accent); }
  .performance-preset-card:focus-within { outline: 2px solid var(--settings-focus); outline-offset: 2px; }
  .performance-preset-card input { grid-row: span 2; width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--settings-accent); }
  .performance-preset-card strong { margin: 0; font-size: 13px; line-height: 1.4; }
  .performance-preset-card span { min-width: 0; color: var(--settings-muted); font-size: 12px; line-height: 1.5; }
  .performance-preset-status { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 9px 11px; border: 1px solid var(--settings-border); border-radius: 6px; background: var(--settings-subtle); color: var(--settings-muted); font-size: 12px; }
  .performance-preset-status strong { display: inline; margin: 0; color: var(--settings-text); }
  .performance-preset-preview { min-width: 0; padding: 12px; border: 1px solid var(--settings-border); border-radius: 7px; background: var(--settings-subtle); }
  .performance-preset-preview h3 { margin: 0 0 8px; font-size: 14px; }
  .performance-preset-preview p { margin: 0 0 10px; color: var(--settings-muted); font-size: 12px; }
  .performance-preset-table-wrap { max-width: 100%; overflow-x: auto; margin-bottom: 12px; }
  .performance-preset-table { width: 100%; border-collapse: collapse; color: var(--settings-text); font-size: 12px; }
  .performance-preset-table th, .performance-preset-table td { padding: 8px 10px; border-bottom: 1px solid var(--settings-border); text-align: left; vertical-align: top; }
  .performance-preset-table th { color: var(--settings-muted); font-weight: 650; white-space: nowrap; }
  .performance-preset-table td:not(:first-child) { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .performance-preset-custom-hint { margin: 0; color: var(--settings-muted); font-size: 12px; }
  @media (max-width: 900px) { .performance-preset-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) {
    .performance-preset-grid { grid-template-columns: minmax(0, 1fr); }
    .performance-preset-card { min-height: 0; }
    .performance-preset-table thead { display: none; }
    .performance-preset-table, .performance-preset-table tbody { display: block; }
    .performance-preset-table tbody { display: grid; gap: 8px; }
    .performance-preset-table tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--settings-border); border-radius: 5px; }
    .performance-preset-table td { min-width: 0; border: 0; padding: 7px 8px; white-space: normal !important; overflow-wrap: anywhere; }
    .performance-preset-table td:first-child { grid-column: 1 / -1; padding-bottom: 3px; font-weight: 650; }
    .performance-preset-table td:not(:first-child) { display: grid; gap: 2px; }
    .performance-preset-table td:not(:first-child)::before { content: attr(data-label); color: var(--settings-muted); font-size: 10px; }
  }
  .options-cache-clear { border-top: 1px solid var(--settings-border); margin-top: 20px; padding-top: 18px; }
  .options-cache-clear .options-button { align-self: flex-start; }
  .options-trace-controls { align-items: center; }
  .options-trace-controls > fieldset { flex-basis: 100%; }
  .options-diagnostics-title { margin: 32px 0 16px; font-size: 18px; }
  @media (max-width: 480px) { .options-cache-retention-choices { flex-direction: column; } }
  .options-cache-fetch-preset { border-top: 1px solid var(--settings-border); margin-top: 20px; padding-top: 18px; }
  .options-cache-fetch-preset p { margin: 8px 0 12px !important; }
  .options-cache-fetch-preset > .options-hint { display: block; margin-top: 8px; }
  .options-setting-list .options-input, .options-setting-list .mm-custom-select { width: min(100%, 620px); }
  @media (max-width: 1100px) {
    .options-panel, .options-panel--appearance { padding: 28px; }
    .options-banner-stack { padding-inline: 28px; }
    .options-topbar-brand h1 { font-size: 17px; }
    body[data-theme] .options-sidebar { width: 196px; }
    body[data-theme] .options-save-footer { padding: 16px 28px; }
  }
  @media (max-width: 720px) {
    body[data-theme] .options-topbar { padding: 12px 16px; min-height: 58px; gap: 8px; }
    .options-topbar-brand h1 { font-size: 16px; }
    body[data-theme] .options-topbar .options-editing-target { border-left: 0; padding-left: 0; font-size: 11px; }
    .options-editing-target > strong { max-width: 66vw; }
    body[data-theme] .options-sidebar { width: 52px; }
    .options-sidebar-nav { padding: 12px 5px; }
    body[data-theme] .options-nav-item { padding: 11px 8px; justify-content: center; }
    .options-panel, .options-panel--appearance { padding: 24px 16px; }
    .options-banner-stack { padding-inline: 16px; }
    .options-panel-header h2 { font-size: 21px; }
    .options-grid { grid-template-columns: minmax(0, 1fr); }
    body[data-theme] .options-save-footer { padding: 12px 16px; }
    .options-save-footer-inner > .options-status { flex-basis: 100%; }
    .options-save-actions { width: 100%; }
    .options-setting-list .options-field--toggle { padding-right: 60px; }
  }
  @media (forced-colors: active) {
    .options-setting-list .options-field--toggle input[type="checkbox"] { appearance: auto; width: 24px; height: 24px; }
    .options-setting-list .options-field--toggle input[type="checkbox"]::after { content: none; }
  }
`;
