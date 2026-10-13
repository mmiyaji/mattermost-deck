export const settingsExperienceCss = `
  .options-content { min-width: 0; }
  .options-topbar { height: auto; min-height: 54px; flex-wrap: wrap; gap: 10px 24px; padding: 12px 20px; }
  .options-editing-target { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-size: 12px; min-width: 0; }
  .options-editing-target > strong { overflow-wrap: anywhere; }
  .options-editing-target > span:first-child { color: #8facd5; }
  .options-nav-group { display: flex; flex-direction: column; gap: 2px; }
  .options-nav-group + .options-nav-group { border-top: 1px solid rgba(123,178,255,.2); margin-top: 12px; padding-top: 12px; }
  .options-nav-group > h2 { font-size: 11px; font-weight: 600; color: #8facd5; padding: 8px 12px; }
  .options-save-footer-inner { gap: 12px; flex-wrap: wrap; }
  .options-save-actions, .options-switch-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
  .options-save-actions { margin-left: auto; }
  .options-switch-dialog { margin: auto; max-width: min(540px, calc(100vw - 32px)); padding: 24px; border-radius: 12px; border: 1px solid #496583; background: #142237; color: #e5eefb; }
  .options-switch-dialog::backdrop { background: rgba(0,0,0,.55); }
  .options-switch-dialog h2 { font-size: 18px; }
  .options-switch-dialog p { margin: 16px 0; line-height: 1.6; overflow-wrap: anywhere; }
  .options-switch-dialog button:focus-visible { outline: 2px solid #1f9dff; outline-offset: 3px; }
  .options-appearance-group { display: flex; flex-direction: column; gap: 18px; border: 0; padding: 0; margin: 0; min-width: 0; }
  .options-appearance-group > h3 { font-size: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(123,178,255,.2); }
  .options-appearance-preview { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .options-appearance-body, .options-appearance-controls { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
  .options-panel--appearance { max-width: 1260px; }
  .options-appearance-body > .options-appearance-preview { order: -1; }
  .options-appearance-preview > h3 { font-size: 15px; }
  .options-preview-scroll { overflow-x: auto; border: 1px solid #496583; border-radius: 10px; max-width: 100%; }
  .options-preview-scroll:focus-visible { outline: 2px solid #1f9dff; outline-offset: 3px; }
  .options-preview-deck { display: flex; gap: 12px; padding: 12px; overflow: hidden; background: #101b2b; color: #e5eefb; }
  .options-preview-deck[data-theme="light"] { background: #edf2f8; color: #1f2d3d; }
  .options-preview-pane { flex: none; border-radius: 8px; background: #18263a; padding: 12px; }
  .options-preview-deck[data-theme="light"] .options-preview-pane { background: #fff; }
  .options-preview-type-icon { display: inline-flex; }
  .options-preview-type-icon .deck-type-icon { width: 14px; height: 14px; stroke: currentColor; stroke-width: 1.5; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .options-preview-type-icon .deck-type-glyph { width: 14px; font-size: 13px; font-weight: 700; text-align: center; }
  .options-preview-pane h4 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 1em; }
  .options-preview-post { border: 1px solid #496583; border-radius: 8px; margin-top: 10px; line-height: 1.6; padding: 12px; }
  .options-preview-deck[data-theme="light"] .options-preview-post { border-color: #dce3eb; }
  .options-preview-post-meta { display: flex; justify-content: space-between; gap: 12px; font-size: .8em; }
  .options-preview-post p { margin: 8px 0 0; }
  .options-preview-post img { margin-top: 8px; object-fit: contain; }
  .options-preview-file { display: block; border: 1px solid #496583; border-radius: 4px; padding: 8px; margin-top: 8px; font-size: .85em; }
  .options-preview-post--compact { display: flex; align-items: baseline; gap: 6px; border: 0; border-radius: 0; margin-top: 2px; padding: 4px 0; }
  .options-preview-post--compact .options-preview-post-meta { flex: none; gap: 6px; }
  .options-preview-post--compact p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0; }
  .options-width-diagram { padding: 16px; border: 1px solid rgba(123,178,255,.25); border-radius: 10px; }
  .options-width-track { height: 42px; background: rgba(123,178,255,.08); border-radius: 6px; }
  .options-width-deck { height: 100%; border: 2px solid #1f9dff; border-radius: 6px; padding: 4px; }
  .options-width-pane { height: 100%; background: #1f9dff; border: 2px solid #7bc8ff; border-radius: 3px; }
  .options-width-diagram figcaption { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 12px; font-size: 12px; line-height: 1.5; }
  .options-width-diagram small { flex-basis: 100%; }
  .options-method-status { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  .options-realtime-details > .options-subsection { gap: 18px; }
  body[data-theme="light"] .options-nav-group > h2,
  body[data-theme="light"] .options-editing-target > span:first-child { color: #496583; }
  body[data-theme="light"] .options-switch-dialog { background: #fff; color: #16263b; }
  @media (min-width: 1100px) {
    .options-appearance-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, .9fr); align-items: start; }
    .options-appearance-body > .options-appearance-preview { order: 0; position: sticky; top: 16px; }
    .options-appearance-controls .options-grid { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 720px) {
    .options-nav-group > h2 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .options-topbar { padding: 10px 12px; }
    .options-editing-target { flex-basis: 100%; font-size: 11px; }
    .options-switch-actions { flex-direction: column; }
    .options-switch-actions button { justify-content: center; }
  }
`;
