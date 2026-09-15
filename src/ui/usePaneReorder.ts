import { preservePaneScroll } from "./paneScroll";
import { useEffect, useRef, type HTMLAttributes } from "react";

export function usePaneReorder(enabled: boolean, onMove: (source: string, target: string | null, after: boolean, row?: 0 | 1) => void): HTMLAttributes<HTMLDivElement> {
  const drag = useRef<{
    root: HTMLDivElement; source: HTMLElement; id: number; x: number; y: number;
    placeholder: HTMLElement | null; ghost: HTMLElement | null;
    restoreScroll: () => void;
    destination: 0 | 1 | null;
    rows: HTMLElement[]; panes: HTMLElement[][];
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
    // Restore React-owned sibling order before persisting the new layout or cancelling.
    if (current.active) current.rows.forEach((row, index) => current.panes[index].forEach(pane => row.insertBefore(pane, row.querySelector(".deck-column-tail"))));
    current.placeholder?.remove();
    current.ghost?.remove();
    current.target?.removeAttribute("data-drop-side");
    current.restoreScroll();
    if (current.root.hasPointerCapture(current.id)) current.root.releasePointerCapture(current.id);
  };
  useEffect(() => {
    if (!enabled) clear();
    // Catch Escape before host-app shortcuts, even if focus leaves the drag root.
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (!drag.current || event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      clear();
    };
    window.addEventListener("keydown", cancelOnEscape, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape, true);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, [enabled]);
  const locate = () => {
    const current = drag.current;
    if (!current?.active) return;
    current.ghost!.style.transform = `translate3d(${current.x + 16}px, ${current.y + 16}px, 0)`;
    let inside = false;
    for (const row of current.root.querySelectorAll<HTMLElement>(".deck-row-scroll")) {
      const r = row.getBoundingClientRect();
      const viewport = row.closest<HTMLElement>(".deck-scroll-wrap")!.getBoundingClientRect();
      const left = Math.max(r.left, viewport.left), right = Math.min(r.right, viewport.right);
      if (current.y < r.top || current.y > r.bottom || current.x < left || current.x > right) continue;
      const scroller = current.root.classList.contains("deck-columns--two-rows") ? row : row.closest<HTMLElement>(".deck-scroll-wrap")!;
      if (current.x < left + 28) scroller.scrollLeft -= 10;
      else if (current.x > right - 28) scroller.scrollLeft += 10;
      inside = true;
      const slot = current.placeholder!.getBoundingClientRect();
      // Keep the destination stable while the pointer rests inside the vacant slot.
      if (current.placeholder!.parentElement === row && current.x >= slot.left && current.x <= slot.right) break;
      const panes = [...row.querySelectorAll<HTMLElement>(".deck-pane-frame")].filter(pane => pane !== current.source);
      const target = panes.find(pane => current.x < pane.getBoundingClientRect().right) ?? panes.at(-1);
      const bounds = target?.getBoundingClientRect();
      const after = bounds ? current.x >= bounds.left + bounds.width / 2 : true;
      const destination = current.rows.indexOf(row) as 0 | 1;
      if (current.target === target && current.after === after && current.destination === destination) break;
      current.target?.removeAttribute("data-drop-side");
      current.target = target ?? null;
      current.after = after;
      current.destination = destination;
      if (target) target.dataset.dropSide = after ? "after" : "before";
      row.insertBefore(current.placeholder!, target ? (after ? target.nextSibling : target) : row.querySelector(".deck-column-tail"));
      break;
    }
    current.ghost!.classList.toggle("deck-drag-ghost--outside", !inside);
    current.placeholder!.classList.toggle("deck-drop-placeholder--outside", !inside);
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
      const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(".deck-row-scroll")];
      drag.current = { destination: null, restoreScroll: preservePaneScroll(event.currentTarget), rows, panes: rows.map(row => [...row.querySelectorAll<HTMLElement>(".deck-pane-frame")]), root: event.currentTarget, source, id: event.pointerId, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, active: false, target: null, after: false, placeholder: null, ghost: null };
    },
    onPointerMove: event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
        current.active = true;
        const placeholder = document.createElement("div");
        placeholder.className = "deck-drop-placeholder";
        placeholder.style.width = current.source.getBoundingClientRect().width + "px";
        placeholder.setAttribute("aria-hidden", "true");
        const title = current.source.querySelector("h2")?.textContent ?? "";
        placeholder.textContent = title;
        current.source.before(placeholder);
        current.placeholder = placeholder;
        const ghost = document.createElement("div");
        ghost.className = "deck-drag-ghost";
        ghost.setAttribute("aria-hidden", "true");
        ghost.textContent = title;
        current.root.append(ghost);
        current.ghost = ghost;
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
      const target = current.active && !current.ghost?.classList.contains("deck-drag-ghost--outside") ? current.target?.dataset.paneId : undefined;
      const after = current.after;
      clear();
      if (current.active && !current.ghost?.classList.contains("deck-drag-ghost--outside") && current.destination !== null) {
        onMove(source, target ?? null, after, current.root.classList.contains("deck-columns--two-rows") ? current.destination : undefined);
      }
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
