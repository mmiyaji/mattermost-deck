export const railCssText = `
  :host {
    color-scheme: light;
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
    background:
      linear-gradient(180deg, rgba(17, 29, 45, 0.98), rgba(13, 23, 36, 0.98)),
      radial-gradient(circle at top, rgba(61, 117, 190, 0.18), transparent 30%);
    border-left: 1px solid rgba(24, 39, 75, 0.12);
    font-family: "Segoe UI", sans-serif;
    color: #dce8f8;
    position: relative;
    overflow: hidden;
  }

  .deck-topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 14px 18px 12px 22px;
    border-bottom: 1px solid rgba(110, 154, 219, 0.16);
    background: linear-gradient(180deg, rgba(14, 24, 36, 0.96), rgba(10, 18, 29, 0.9));
    min-height: 76px;
  }

  .deck-topbar-copy {
    min-width: 0;
  }

  .deck-topbar-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
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
    font-size: 22px;
    line-height: 1.2;
    color: #f3f7ff;
  }

  .deck-eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: #7bb2ff;
  }

  .deck-button,
  .deck-icon-button,
  .deck-select {
    border: 0;
    border-radius: 999px;
  }

  .deck-button,
  .deck-icon-button {
    background: linear-gradient(180deg, #1f9dff, #0f71d7);
    color: white;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .deck-button {
    padding: 10px 16px;
    font-weight: 600;
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

  .deck-icon-button--ghost {
    background: rgba(123, 178, 255, 0.12);
    color: #c4dcff;
    box-shadow: none;
  }

  .deck-meta {
    margin-top: 6px;
    font-size: 12px;
    color: #88a6cf;
  }

  .deck-status-inline {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    max-width: 420px;
    padding: 10px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(123, 178, 255, 0.12);
    font-size: 12px;
    color: #c7dbf8;
  }

  .deck-status-inline span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2dc26b;
    flex: none;
  }

  .deck-scroll-wrap {
    flex: 1 1 auto;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 16px 14px 18px 14px;
    scrollbar-color: rgba(125, 166, 221, 0.38) transparent;
  }

  .deck-columns {
    display: flex;
    align-items: stretch;
    gap: 14px;
    height: 100%;
  }

  .deck-column {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    width: 320px;
    min-width: 320px;
    max-width: 320px;
    padding: 14px;
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(18, 33, 51, 0.98), rgba(14, 26, 41, 0.98));
    border: 1px solid rgba(127, 168, 222, 0.14);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28);
    overflow-y: auto;
  }

  .deck-column-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .deck-column-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .deck-column-header h2 {
    font-size: 16px;
    line-height: 1.2;
    color: #eff6ff;
  }

  .deck-column-header p {
    margin-top: 4px;
    font-size: 12px;
    color: #84a4cf;
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
    font-size: 12px;
    color: #90afda;
  }

  .deck-select {
    width: 100%;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(122, 167, 226, 0.18);
    color: #eff6ff;
    border-radius: 14px;
    appearance: none;
  }

  .deck-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .deck-card {
    padding: 12px 14px;
    border-radius: 16px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.03));
    border: 1px solid rgba(126, 167, 221, 0.12);
    font-size: 13px;
    line-height: 1.5;
    color: #d9e8fb;
  }

  .deck-card--muted {
    background: rgba(255, 255, 255, 0.03);
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
    color: #88a6cf;
    font-size: 12px;
  }

  .deck-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 36px;
    padding: 0 10px;
    border-radius: 999px;
    background: linear-gradient(180deg, #1f9dff, #0f71d7);
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
    background: rgba(143, 184, 235, 0.36);
  }

  .deck-resizer--active span,
  .deck-resizer:hover span {
    background: rgba(77, 159, 255, 0.82);
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
  }
`;
