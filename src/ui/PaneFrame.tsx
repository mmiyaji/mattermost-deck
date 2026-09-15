import React, { useEffect, useRef, useState } from "react";
import i18n from "./i18n";
import { MIN_PREFERRED_COLUMN_WIDTH, MAX_PREFERRED_COLUMN_WIDTH, normalisePreferredColumnWidth } from "./columnWidth";

/** Resize only this frame during a gesture; persist once when the pointer is released. */
export function PaneFrame({ children, frameRef, className, width, focused, row, track, onResize }: {
  children: React.ReactNode;
  frameRef: (node: HTMLDivElement | null) => void;
  className: string;
  width: number;
  focused: boolean;
  row?: number;
  track?: number;
  onResize: (width: number | undefined) => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState<number | null>(null);
  const gesture = useRef<{ pointer: number; x: number; width: number; next: number } | null>(null);
  useEffect(() => { gesture.current = null; setPreview(null); }, [width, focused]);
  const cancel = () => { gesture.current = null; setPreview(null); };
  return <div ref={frameRef} className={`${className} deck-pane-frame`} style={{
    "--deck-column-width": `${preview ?? width}px`,
    width: focused ? undefined : preview ?? width,
    gridRow: focused ? undefined : row,
    gridColumn: focused ? undefined : track,
  } as React.CSSProperties}>
    {children}
    {!focused && <div className="deck-column-resize" role="separator" tabIndex={0}
      aria-label={i18n.t("deck.resizeColumn")}
      aria-orientation="vertical" aria-valuemin={MIN_PREFERRED_COLUMN_WIDTH}
      aria-valuemax={MAX_PREFERRED_COLUMN_WIDTH} aria-valuenow={preview ?? width}
      title={i18n.t("deck.resizeColumnHint")}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { pointer: event.pointerId, x: event.clientX, width, next: width };
      }}
      onPointerMove={event => {
        const current = gesture.current;
        if (!current || current.pointer !== event.pointerId) return;
        current.next = normalisePreferredColumnWidth(current.width + event.clientX - current.x);
        setPreview(current.next);
      }}
      onPointerUp={event => {
        const current = gesture.current;
        if (!current || current.pointer !== event.pointerId) return;
        gesture.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setPreview(null);
        onResize(current.next);
      }}
      onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel(); }}
      onDoubleClick={() => { cancel(); onResize(undefined); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
        if (gesture.current) return;
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") onResize(undefined);
        else if (event.key === "End") onResize(MAX_PREFERRED_COLUMN_WIDTH);
        else onResize(normalisePreferredColumnWidth(width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 40 : 10)));
      }} onKeyUp={event => event.stopPropagation()} onKeyPress={event => event.stopPropagation()}
    />}
  </div>;
}
