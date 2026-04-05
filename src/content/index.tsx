import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../ui/App";
import { DEFAULT_SETTINGS, loadDeckSettings, subscribeDeckSettings, type DeckSettings } from "../ui/settings";
import { railCssText } from "../ui/styles";

const ROOT_ID = "mattermost-deck-root";
const STYLE_ID = "mattermost-deck-page-style";
const REACT_ROOT_ID = "mattermost-deck-react-root";
const BODY_CLASS = "mattermost-deck-body-offset";
const RAIL_WIDTH_VAR = "--mattermost-deck-rail-width";
const OFFSET_WIDTH_VAR = "--mattermost-deck-offset-width";
const ROOT_WIDTH_EXPR = "clamp(320px, 32vw, 420px)";
const MATTERMOST_GUARD_SUCCESS_TTL_MS = 30_000;
const MATTERMOST_GUARD_FAILURE_TTL_MS = 10_000;

let appRoot: ReturnType<typeof createRoot> | null = null;
let routePoller: number | null = null;
let lastRenderKey = "";
let currentSettings: DeckSettings = DEFAULT_SETTINGS;
let settingsLoaded = false;
let guardCache:
  | {
      origin: string;
      expiresAt: number;
      ok: boolean;
    }
  | null = null;
let guardInflight: Promise<boolean> | null = null;

function matchesConfiguredRoute(): boolean {
  if (!settingsLoaded) {
    return false;
  }

  if (!currentSettings.serverUrl || window.location.origin !== currentSettings.serverUrl) {
    return false;
  }

  const route = `${window.location.pathname}${window.location.hash}`;
  const allowedKinds = currentSettings.allowedRouteKinds
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const routePattern = new RegExp(`/(?:${allowedKinds.join("|")})/`);
  if (!routePattern.test(route)) {
    return false;
  }

  if (!currentSettings.teamSlug) {
    return true;
  }

  return route.includes(`/${currentSettings.teamSlug}/`);
}

function hasBlockingDialog(): boolean {
  const candidates = document.querySelectorAll<HTMLElement>(
    [
      "[role='dialog'][aria-modal='true']",
      "[role='dialog']",
      ".modal-dialog",
      ".Modal_dialog",
      ".modal",
    ].join(", "),
  );

  return Array.from(candidates).some((element) => {
    if (element.closest(`#${ROOT_ID}`)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
  });
}

async function verifyMattermostSession(): Promise<boolean> {
  if (!currentSettings.serverUrl || window.location.origin !== currentSettings.serverUrl) {
    return false;
  }

  const now = Date.now();
  if (guardCache && guardCache.origin === window.location.origin && guardCache.expiresAt > now) {
    return guardCache.ok;
  }

  if (guardInflight) {
    return await guardInflight;
  }

  guardInflight = (async () => {
    const csrfToken = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("MMCSRF="))
      ?.split("=")[1];

    try {
      const response = await fetch(currentSettings.healthCheckPath, {
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {}),
        },
      });

      const ok = response.ok;
      guardCache = {
        origin: window.location.origin,
        expiresAt: Date.now() + (ok ? MATTERMOST_GUARD_SUCCESS_TTL_MS : MATTERMOST_GUARD_FAILURE_TTL_MS),
        ok,
      };
      return ok;
    } catch {
      guardCache = {
        origin: window.location.origin,
        expiresAt: Date.now() + MATTERMOST_GUARD_FAILURE_TTL_MS,
        ok: false,
      };
      return false;
    } finally {
      guardInflight = null;
    }
  })();

  return await guardInflight;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      ${RAIL_WIDTH_VAR}: ${ROOT_WIDTH_EXPR};
      ${OFFSET_WIDTH_VAR}: var(${RAIL_WIDTH_VAR});
    }

    body.${BODY_CLASS} {
      overflow: hidden !important;
    }

    #${ROOT_ID} {
      transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    }

    body.${BODY_CLASS} #root {
      width: calc(100vw - var(${OFFSET_WIDTH_VAR})) !important;
      max-width: calc(100vw - var(${OFFSET_WIDTH_VAR})) !important;
      transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                  max-width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    }

    body.${BODY_CLASS} #root .app__content {
      flex: 1 1 auto !important;
      width: auto !important;
      min-width: 0 !important;
      max-width: none !important;
    }

    body.${BODY_CLASS} #root .app__content,
    body.${BODY_CLASS} #root .post-list__dynamic,
    body.${BODY_CLASS} #root .inner-wrap {
      max-width: 100%;
    }

    body.${BODY_CLASS} #root .inner-wrap {
      width: 100% !important;
      min-width: 0 !important;
    }

    body.${BODY_CLASS} #root .post-list__dynamic {
      width: 100% !important;
      left: 0 !important;
      right: 0 !important;
    }

    @media (max-width: 1100px) {
      :root {
        ${RAIL_WIDTH_VAR}: clamp(280px, 38vw, 360px);
      }
    }
  `;
  document.documentElement.append(style);
}

function ensureRoot(): HTMLDivElement {
  const existing = document.getElementById(ROOT_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.style.position = "fixed";
  root.style.top = "0";
  root.style.right = "0";
  root.style.height = "100vh";
  root.style.width = `var(${OFFSET_WIDTH_VAR})`;
  root.style.zIndex = "2147483646";
  document.body.append(root);
  return root;
}

function cleanup(): void {
  document.body?.classList.remove(BODY_CLASS);
  document.getElementById(ROOT_ID)?.remove();
  if (appRoot) {
    appRoot.unmount();
    appRoot = null;
  }
}

async function render(): Promise<void> {
  if (!(document.body instanceof HTMLBodyElement)) {
    return;
  }

  const routeKey = `${window.location.pathname}${window.location.hash}`;
  const dialogOpen = hasBlockingDialog();
  const renderKey = `${routeKey}|dialog:${dialogOpen ? "open" : "closed"}`;
  lastRenderKey = renderKey;

  if (!matchesConfiguredRoute()) {
    cleanup();
    return;
  }

  if (!(await verifyMattermostSession())) {
    cleanup();
    return;
  }

  if (routeKey !== `${window.location.pathname}${window.location.hash}`) {
    return;
  }

  ensureStyle();
  document.body.classList.add(BODY_CLASS);

  const mountPoint = ensureRoot();
  // When Mattermost shows a blocking dialog, lower z-index so the dialog renders on top.
  const normalZIndex = currentSettings.highZIndex ? "2147483646" : "999";
  mountPoint.style.zIndex = dialogOpen ? "0" : normalZIndex;
  const shadowRoot = mountPoint.shadowRoot ?? mountPoint.attachShadow({ mode: "open" });

  if (!shadowRoot.getElementById("mattermost-deck-style")) {
    const style = document.createElement("style");
    style.id = "mattermost-deck-style";
    style.textContent = railCssText;
    shadowRoot.append(style);
  }

  let reactRoot = shadowRoot.getElementById(REACT_ROOT_ID);
  if (!(reactRoot instanceof HTMLDivElement)) {
    reactRoot = document.createElement("div");
    reactRoot.id = REACT_ROOT_ID;
    shadowRoot.append(reactRoot);
    appRoot = createRoot(reactRoot);
  }

  appRoot ??= createRoot(reactRoot);
  appRoot.render(<App routeKey={`${window.location.pathname}${window.location.hash}`} />);
}

function installRouteWatcher(): void {
  if (routePoller !== null) {
    return;
  }

  const { pushState, replaceState } = window.history;
  const notify = (): void => {
    const routeKey = `${window.location.pathname}${window.location.hash}`;
    const renderKey = `${routeKey}|dialog:${hasBlockingDialog() ? "open" : "closed"}`;
    if (renderKey === lastRenderKey) {
      return;
    }

    window.requestAnimationFrame(() => {
      void render();
    });
  };

  window.history.pushState = function pushStatePatched(...args) {
    pushState.apply(this, args);
    notify();
  };

  window.history.replaceState = function replaceStatePatched(...args) {
    replaceState.apply(this, args);
    notify();
  };

  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
  routePoller = window.setInterval(notify, 1_000);
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      void loadDeckSettings().then((settings) => {
        currentSettings = settings;
        settingsLoaded = true;
        void render();
      });
      subscribeDeckSettings((settings) => {
        currentSettings = settings;
        settingsLoaded = true;
        guardCache = null;
        void render();
      });
      installRouteWatcher();
    },
    { once: true },
  );
} else {
  void loadDeckSettings().then((settings) => {
    currentSettings = settings;
    settingsLoaded = true;
    void render();
  });
  subscribeDeckSettings((settings) => {
    currentSettings = settings;
    settingsLoaded = true;
    guardCache = null;
    void render();
  });
  installRouteWatcher();
}
