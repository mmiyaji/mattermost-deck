import { useEffect, useRef, type HTMLAttributes } from "react";

export function usePaneReorder(enabled: boolean, onMove: (source: string, target: string, after: boolean) => void): HTMLAttributes<HTMLDivElement> {
  const drag = useRef<{
    root: HTMLDivElement; source: HTMLElement; id: number; x: number; y: number;
    startX: number; startY: number; active: boolean; target: HTMLElement | null; after: boolean;
  } | null>(null);
  const animation = useRef<number | null>(null);
  const clear = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    current.root.classList.remove("deck-columns--dragging");
    current.source.classList.remove("deck-pane-frame--dragging");
    current.target?.removeAttribute("data-drop-side");
    if (current.root.hasPointerCapture(current.id)) current.root.releasePointerCapture(current.id);
  };
  useEffect(() => {
    if (!enabled) clear();
    window.addEventListener("blur", clear);
    return () => { window.removeEventListener("blur", clear); clear(); };
  }, [enabled]);
  const locate = () => {
    const current = drag.current;
    if (!current?.active) return;
    current.target?.removeAttribute("data-drop-side");
    current.target = null;
    for (const row of current.root.querySelectorAll<HTMLElement>(".deck-row-scroll")) {
      const r = row.getBoundingClientRect();
      const viewport = row.closest<HTMLElement>(".deck-scroll-wrap")!.getBoundingClientRect();
      const left = Math.max(r.left, viewport.left), right = Math.min(r.right, viewport.right);
      if (current.y < r.top || current.y > r.bottom || current.x < left || current.x > right) continue;
      const scroller = current.root.classList.contains("deck-columns--two-rows") ? row : row.closest<HTMLElement>(".deck-scroll-wrap")!;
      if (current.x < left + 28) scroller.scrollLeft -= 10;
      else if (current.x > right - 28) scroller.scrollLeft += 10;
      const panes = [...row.querySelectorAll<HTMLElement>(".deck-pane-frame")];
      const target = panes.find(pane => current.x < pane.getBoundingClientRect().right) ?? panes.at(-1);
      if (!target || target === current.source) break;
      const bounds = target.getBoundingClientRect();
      current.target = target;
      current.after = current.x >= bounds.left + bounds.width / 2;
      target.dataset.dropSide = current.after ? "after" : "before";
      break;
    }
    animation.current = requestAnimationFrame(locate);
  };
  return {
    tabIndex: -1,
    onPointerDownCapture: event => {
      if (!enabled || event.button !== 0 || !event.isPrimary || drag.current) return;
      const target = event.target as HTMLElement;
      if (!target.closest(".deck-column-heading h2") || target.closest("button, a, input, [contenteditable=true]")) return;
      const source = target.closest<HTMLElement>(".deck-pane-frame");
      if (!source?.dataset.paneId) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { root: event.currentTarget, source, id: event.pointerId, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, active: false, target: null, after: false };
    },
    onPointerMove: event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
        current.active = true;
        current.root.classList.add("deck-columns--dragging");
        current.source.classList.add("deck-pane-frame--dragging");
        locate();
      }
    },
    onPointerUp: event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      if (current.active) {
        current.x = event.clientX; current.y = event.clientY;
        if (animation.current !== null) cancelAnimationFrame(animation.current);
        locate();
      }
      const source = current.source.dataset.paneId!;
      const target = current.active ? current.target?.dataset.paneId : undefined;
      const after = current.after;
      clear();
      if (target) onMove(source, target, after);
    },
    onPointerCancel: clear,
    onLostPointerCapture: clear,
    onKeyDownCapture: event => {
      if (!drag.current) return;
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); clear(); }
    },
  };
}
