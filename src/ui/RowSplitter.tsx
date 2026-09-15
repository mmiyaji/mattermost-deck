import React, { useEffect, useRef, useState } from "react";
import i18n from "./i18n";
import { DEFAULT_ROW_SPLIT, MIN_ROW_SPLIT, MAX_ROW_SPLIT, normaliseRowSplit } from "./rowSplit";

export function RowSplitter({ value, onChange }: {
  value: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{ id: number; y: number; start: number; height: number; next: number; container: HTMLElement } | null>(null);
  const restore = () => {
    const current = drag.current;
    if (current) {
      current.container.style.setProperty("--deck-top-row-grow", String(current.start));
      current.container.style.setProperty("--deck-bottom-row-grow", String(100 - current.start));
    }
    drag.current = null;
  };
  const cancel = () => { restore(); setPreview(null); };
  useEffect(() => {
    cancel();
    const container = elementRef.current?.closest<HTMLElement>(".deck-columns");
    container?.style.setProperty("--deck-top-row-grow", String(value));
    container?.style.setProperty("--deck-bottom-row-grow", String(100 - value));
    return restore;
  }, [value]);
  return <div ref={elementRef} className="deck-row-resize" role="separator" tabIndex={0}
    aria-label={i18n.t("deck.resizeRows")} title={i18n.t("deck.resizeRowsHint")}
    aria-orientation="horizontal" aria-valuemin={MIN_ROW_SPLIT} aria-valuemax={MAX_ROW_SPLIT}
    aria-valuenow={preview ?? value} aria-valuetext={i18n.t("deck.rowHeightRatio", { top: preview ?? value, bottom: 100 - (preview ?? value) })}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      const container = event.currentTarget.closest<HTMLElement>(".deck-columns");
      if (!container) return;
      const rows = container.querySelectorAll<HTMLElement>(".deck-column-row");
      const height = Array.from(rows).reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
      if (height <= 0) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, y: event.clientY, start: value, height, next: value, container };
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      current.next = normaliseRowSplit(current.start + (event.clientY - current.y) * 100 / current.height);
      current.container.style.setProperty("--deck-top-row-grow", String(current.next));
      current.container.style.setProperty("--deck-bottom-row-grow", String(100 - current.next));
      setPreview(current.next);
    }}
    onPointerUp={event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const next = current.next;
      restore(); setPreview(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
      onChange(next);
    }} onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }}
    onDoubleClick={() => { cancel(); onChange(DEFAULT_ROW_SPLIT); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
      if (drag.current) return;
      if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
      event.preventDefault();
      onChange(event.key === "Home" ? DEFAULT_ROW_SPLIT : normaliseRowSplit(value + (event.key === "ArrowDown" ? 1 : -1) * (event.shiftKey ? 10 : 2)));
    }} onKeyUp={event => event.stopPropagation()} onKeyPress={event => event.stopPropagation()}
  ><span /></div>;
}
