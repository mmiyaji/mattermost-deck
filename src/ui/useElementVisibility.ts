import { useEffect, useState } from "react";
import { observeElementVisibility } from "./elementVisibility";

interface UseElementVisibilityOptions {
  root?: Element | null;
  rootMargin?: string;
  threshold?: number;
  defaultVisible?: boolean;
}

export function useElementVisibility<T extends Element>(
  element: T | null,
  options?: UseElementVisibilityOptions,
): boolean {
  const [isVisible, setIsVisible] = useState(options?.defaultVisible ?? true);

  useEffect(() => {
    if (!element) {
      setIsVisible(options?.defaultVisible ?? true);
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = observeElementVisibility(element, visible => {
      clearTimeout(hiddenTimer);
      if (visible) setIsVisible(true);
      // Reparenting and the 160ms pane animation can briefly clip a visible pane.
      // Wait for layout to settle before slowing polling for a hidden pane.
      else hiddenTimer = setTimeout(() => {
        if (!element.closest(".deck-pane-frame--dragging")) setIsVisible(false);
      }, 250);
    }, options);
    return () => { clearTimeout(hiddenTimer); stop(); };
  }, [element, options?.defaultVisible, options?.root, options?.rootMargin, options?.threshold]);

  return isVisible;
}
