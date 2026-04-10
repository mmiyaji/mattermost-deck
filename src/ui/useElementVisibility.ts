import { useEffect, useState } from "react";

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

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry?.isIntersecting ?? false);
      },
      {
        root: options?.root ?? null,
        rootMargin: options?.rootMargin,
        threshold: options?.threshold ?? 0,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [element, options?.defaultVisible, options?.root, options?.rootMargin, options?.threshold]);

  return isVisible;
}
