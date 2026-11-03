export const performanceDrilldownCss = `
  .perf-overview {
    --perf-surface: var(--settings-surface, #18263a); --perf-text: var(--settings-text, #e5edf8); --perf-muted: var(--settings-muted, #b3c1d3);
    --perf-grid: var(--settings-border, #40516a); --perf-selection: var(--settings-selected, #2c3b52);
    --perf-network: #79acd9; --perf-wait: #d4ab67; --perf-error: #ef8c91;
  }
  body[data-theme="light"] .perf-overview {
    --perf-network: #4d82b5; --perf-wait: #a57535; --perf-error: #b43e44;
  }
  .perf-metric-action { color: inherit; text-align: left; font: inherit; cursor: pointer; border: 1px solid var(--perf-grid); }
  .perf-metric-action:hover { border-color: var(--perf-network); background: var(--perf-selection); }
  .perf-metric-action:focus-visible, .perf-request-details:focus-visible { outline: 2px solid var(--perf-network); outline-offset: 3px; }
  /* A hidden tooltip can retain its pre-resize transform. Keep its layout
     overflow inside the chart instead of widening the settings scroll area. */
  .perf-recharts-host { min-width: 0; width: 100%; min-height: 240px; overflow: clip; }
  .perf-key::before { background: var(--perf-network); }
  .perf-key--wait::before { background: var(--perf-wait); }
  .perf-key--error::before { background: var(--perf-error); }
  .perf-recharts-host .recharts-surface:focus-visible { outline: 2px solid var(--perf-network); outline-offset: -2px; }
  .perf-request-details { min-width: 0; padding-top: 24px; border-top: 1px solid var(--perf-grid); scroll-margin-top: 20px; }
  .perf-request-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
  .perf-request-heading h3 { margin: 0 0 8px; font-size: 18px; }
  .perf-request-heading p { margin: 0; }
  .perf-request-heading > span { font-size: 13px; color: var(--perf-muted); white-space: nowrap; }
  .perf-request-filters { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; }
  .perf-request-filters label { display: flex; flex-direction: column; gap: 7px; min-width: 140px; font-size: 12px; color: var(--perf-muted); }
  .perf-request-filters select, .perf-request-filters input { box-sizing: border-box; max-width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--perf-grid); border-radius: 5px; background: var(--perf-surface); color: var(--perf-text); font: inherit; font-size: 13px; min-height: 38px; }
  .perf-request-filters select:focus-visible, .perf-request-filters input:focus-visible { outline: 2px solid var(--perf-network); outline-offset: 2px; }
  .perf-request-search { flex: 1 1 220px; }
  .perf-filter-segment { display: flex; gap: 0; }
  .perf-filter-segment button { font: inherit; font-size: 13px; background: var(--perf-surface); color: var(--perf-text); border: 1px solid var(--perf-grid); padding: 9px 12px; min-height: 38px; cursor: pointer; }
  .perf-filter-segment button:first-child { border-radius: 5px 0 0 5px; }
  .perf-filter-segment button:last-child { border-radius: 0 5px 5px 0; margin-left: -1px; }
  .perf-filter-segment button[aria-pressed="true"] { background: var(--perf-selection); border-color: var(--perf-network); position: relative; font-weight: 600; }
  .perf-filter-segment button:focus-visible { outline: 2px solid var(--perf-network); outline-offset: 2px; z-index: 1; }
  .perf-active-filter { font-size: 12px; color: var(--perf-muted); margin: 14px 0; overflow-wrap: anywhere; }
  .perf-request-table-scroll { max-width: 100%; overflow-x: auto; border-top: 1px solid var(--perf-grid); }
  .perf-request-table { border-collapse: collapse; width: 100%; font-size: 12px; color: var(--perf-text); }
  .perf-request-table th { text-align: left; font-weight: 600; color: var(--perf-muted); background: var(--perf-selection); }
  .perf-request-table th, .perf-request-table td { padding: 12px 10px; vertical-align: top; border-bottom: 1px solid var(--perf-grid); }
  .perf-request-table td:not(.perf-request-path) { white-space: nowrap; }
  .perf-request-path { min-width: 210px; max-width: 600px; overflow-wrap: anywhere; }
  .perf-request-path strong { color: var(--perf-muted); font-size: 11px; }
  .perf-request-path code { font-size: 12px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  .perf-request-outcome { color: var(--perf-muted); }
  .perf-request-outcome--failed { color: var(--perf-error); font-weight: 600; }
  .perf-request-table .perf-request-expand { padding: 4px 9px; min-height: 28px; font-size: 12px; }
  .perf-request-detail-row > td { padding: 0; white-space: normal !important; }
  .perf-request-expanded { padding: 20px; background: var(--perf-selection); white-space: normal; overflow-wrap: anywhere; }
  .perf-request-expanded h4 { margin: 0 0 16px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
  .perf-request-expanded dl { display: grid; grid-template-columns: minmax(140px, auto) minmax(0, 1fr); gap: 10px 20px; line-height: 1.6; margin: 0; }
  .perf-request-expanded dt { color: var(--perf-muted); }
  .perf-request-expanded dd { margin: 0; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .perf-error-message { color: var(--perf-error); }
  .perf-request-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 16px; font-size: 12px; color: var(--perf-muted); }
  .perf-request-pagination > span { margin-right: auto; }
  .perf-request-empty { padding: 24px 0; color: var(--perf-muted); font-size: 14px; line-height: 1.6; }
  .perf-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  @media (max-width: 720px) {
    .perf-request-filters { align-items: stretch; }
    .perf-request-filters label { flex: 1 1 200px; }
    .perf-request-expanded dl { grid-template-columns: minmax(0, 1fr); gap: 4px; }
    .perf-request-expanded dd { margin-bottom: 8px; }
  }
`;
