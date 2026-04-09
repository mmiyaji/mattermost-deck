export function getMattermostPostSelectors(postId: string): string[] {
  const safeId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(postId)
    : postId.replace(/"/g, '\\"');

  return [
    `#post_${safeId}`,
    `#postMessage_${safeId}`,
    `[data-postid="${safeId}"]`,
    `[data-post-id="${safeId}"]`,
    `[data-aid="post_${safeId}"]`,
    `[id="${safeId}"]`,
  ];
}

function findPostElement(postId: string): HTMLElement | null {
  for (const selector of getMattermostPostSelectors(postId)) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

function scrollElementIntoView(element: HTMLElement): void {
  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest",
  });
}

export async function focusMattermostPost(postId: string, timeoutMs = 5000): Promise<boolean> {
  const existing = findPostElement(postId);
  if (existing) {
    scrollElementIntoView(existing);
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(value);
    };

    const check = () => {
      const element = findPostElement(postId);
      if (!element) {
        return;
      }
      scrollElementIntoView(element);
      finish(true);
    };

    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(check);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["id", "data-postid", "data-post-id", "data-aid"],
    });

    const timer = window.setTimeout(() => finish(false), timeoutMs);
    window.requestAnimationFrame(check);
  });
}
