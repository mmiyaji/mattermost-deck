import type { CurrentRoute } from "../mattermost/api.js";

const MATTERMOST_CHANNEL_ROUTE_KINDS = new Set([
  "channels",
  "messages",
  "pl",
]);
const MATTERMOST_ROUTE_KINDS = new Set([
  ...MATTERMOST_CHANNEL_ROUTE_KINDS,
  "threads",
]);

export function getDeckRoutePath(pathname: string, hash: string): string {
  return hash.startsWith("#/") ? hash.slice(1) : pathname;
}

export function resolveDeckCurrentRoute(
  pathname: string,
  genericRoute: CurrentRoute,
): CurrentRoute {
  const segments = pathname.split("/").filter(Boolean);
  const genericTeamName = genericRoute.teamName;
  if (genericTeamName) {
    let genericTeamThreadsIndex = -1;
    segments.forEach((segment, index) => {
      if (
        segment === genericTeamName &&
        segments[index + 1] === "threads"
      ) {
        genericTeamThreadsIndex = index;
      }
    });
    if (genericTeamThreadsIndex >= 0) {
      return {
        teamName: genericTeamName,
        channelName: null,
      };
    }
  }

  // readCurrentRoute() cannot identify hash routes or the terminal
  // /<team>/threads form. Resolve the final canonical route-kind position,
  // excluding a route-like channel name such as /team/channels/threads.
  let canonicalRouteIndex = -1;
  segments.forEach((segment, index) => {
    const previousSegment = segments[index - 1];
    if (
      index > 0 &&
      MATTERMOST_ROUTE_KINDS.has(segment) &&
      previousSegment &&
      !MATTERMOST_ROUTE_KINDS.has(previousSegment)
    ) {
      canonicalRouteIndex = index;
    }
  });
  if (canonicalRouteIndex > 0) {
    const routeKind = segments[canonicalRouteIndex];
    return {
      teamName: segments[canonicalRouteIndex - 1] ?? null,
      channelName:
        routeKind === "channels" || routeKind === "messages"
          ? segments[canonicalRouteIndex + 1] ?? null
          : null,
    };
  }

  return genericRoute;
}

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

export async function focusMattermostPost(postId: string, timeoutMs = 5000, fallbackPostId?: string): Promise<boolean> {
  const existing = findPostElement(postId) ?? (fallbackPostId ? findPostElement(fallbackPostId) : null);
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
      const element = findPostElement(postId) ?? (fallbackPostId ? findPostElement(fallbackPostId) : null);
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
