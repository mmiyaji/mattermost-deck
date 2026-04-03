import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../ui/App";
import { railCssText } from "../ui/styles";

const ROOT_ID = "mattermost-deck-root";
const STYLE_ID = "mattermost-deck-page-style";
const REACT_ROOT_ID = "mattermost-deck-react-root";
const BODY_CLASS = "mattermost-deck-body-offset";
const RAIL_WIDTH_VAR = "--mattermost-deck-rail-width";
const OFFSET_WIDTH_VAR = "--mattermost-deck-offset-width";
const ROOT_WIDTH_EXPR = "clamp(320px, 32vw, 420px)";

let appRoot: ReturnType<typeof createRoot> | null = null;
let routePoller: number | null = null;
let lastRouteKey = "";

function shouldActivate(): boolean {
  const route = `${window.location.pathname}${window.location.hash}`;
  return /\/(?:channels|messages)\//.test(route);
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

    body.${BODY_CLASS} #root {
      width: calc(100vw - var(${OFFSET_WIDTH_VAR})) !important;
      max-width: calc(100vw - var(${OFFSET_WIDTH_VAR})) !important;
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

function render(): void {
  if (!(document.body instanceof HTMLBodyElement)) {
    return;
  }

  lastRouteKey = `${window.location.pathname}${window.location.hash}`;

  if (!shouldActivate()) {
    cleanup();
    return;
  }

  ensureStyle();
  document.body.classList.add(BODY_CLASS);

  const mountPoint = ensureRoot();
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
    if (routeKey === lastRouteKey) {
      return;
    }

    window.requestAnimationFrame(() => render());
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
      installRouteWatcher();
      render();
    },
    { once: true },
  );
} else {
  installRouteWatcher();
  render();
}
