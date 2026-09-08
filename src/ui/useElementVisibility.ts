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

    return observeElementVisibility(element, setIsVisible, options);
  }, [element, options?.defaultVisible, options?.root, options?.rootMargin, options?.threshold]);

  return isVisible;
}
