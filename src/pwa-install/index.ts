import {
  detectBrowser,
  getInstallMessages,
  resolveInstallLocale,
  type InstallMessages,
} from "./installGuide";

interface PromptChoice {
  outcome: "accepted" | "dismissed";
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void | PromptChoice>;
  userChoice?: Promise<PromptChoice>;
}

interface NavigatorWithInstallHints extends Navigator {
  standalone?: boolean;
  userAgentData?: {
    brands?: Array<{ brand: string }>;
  };
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

function getMessages(): InstallMessages {
  const languages = [
    document.documentElement.lang,
    ...navigator.languages,
    navigator.language,
  ];
  return getInstallMessages(resolveInstallLocale(languages));
}

function getBrowserKind() {
  const extendedNavigator = navigator as NavigatorWithInstallHints;
  const brands = extendedNavigator.userAgentData?.brands?.map(({ brand }) => brand) ?? [];
  return detectBrowser(navigator.userAgent, brands);
}

function isStandalone(): boolean {
  const extendedNavigator = navigator as NavigatorWithInstallHints;
  return window.matchMedia("(display-mode: standalone)").matches || extendedNavigator.standalone === true;
}

function removeInstallUi(): void {
  document.getElementById("mmd-install-fallback")?.remove();
  document.getElementById("mmd-install-overlay")?.remove();
}

function runWhenBodyExists(callback: () => void): void {
  if (document.body) {
    callback();
    return;
  }
  document.addEventListener("DOMContentLoaded", callback, { once: true });
}

function createCloseButton(messages: InstallMessages, onClose: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "×";
  button.setAttribute("aria-label", messages.closeLabel);
  button.style.cssText = [
    "position:absolute", "top:10px", "right:12px", "background:none", "border:none",
    "color:#94a3b8", "cursor:pointer", "font-size:22px", "padding:2px 6px", "line-height:1",
  ].join(";");
  button.addEventListener("click", onClose);
  return button;
}

function showStatus(message: string): void {
  runWhenBodyExists(() => {
    removeInstallUi();
    const messages = getMessages();
    const banner = document.createElement("div");
    banner.id = "mmd-install-fallback";
    banner.setAttribute("role", "status");
    banner.style.cssText = [
      "position:fixed", "bottom:24px", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483647", "background:#1e293b", "color:#e2e8f0",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-size:14px", "line-height:1.5", "padding:16px 48px 16px 20px", "border-radius:10px",
      "box-shadow:0 8px 32px rgba(0,0,0,0.5)", "max-width:520px", "width:calc(100% - 48px)",
      "border:1px solid rgba(255,255,255,0.12)", "box-sizing:border-box",
    ].join(";");
    banner.textContent = message;
    banner.appendChild(createCloseButton(messages, () => banner.remove()));
    document.body.appendChild(banner);
  });
}

function showManualInstallGuide(): void {
  runWhenBodyExists(() => {
    if (deferredPrompt !== null || document.getElementById("mmd-install-fallback")) return;

    const messages = getMessages();
    const banner = document.createElement("section");
    banner.id = "mmd-install-fallback";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-labelledby", "mmd-install-fallback-title");
    banner.style.cssText = [
      "position:fixed", "bottom:24px", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483647", "background:#1e293b", "color:#e2e8f0",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-size:14px", "line-height:1.55", "padding:18px 48px 18px 20px", "border-radius:10px",
      "box-shadow:0 8px 32px rgba(0,0,0,0.5)", "max-width:560px", "width:calc(100% - 48px)",
      "border:1px solid rgba(255,255,255,0.12)", "box-sizing:border-box",
    ].join(";");

    const title = document.createElement("strong");
    title.id = "mmd-install-fallback-title";
    title.textContent = messages.manualTitle;
    title.style.cssText = "display:block;font-size:15px;margin-bottom:6px;color:#fff";

    const explanation = document.createElement("p");
    explanation.style.cssText = "margin:0";
    if (!window.isSecureContext) {
      explanation.textContent = messages.insecureContext;
    } else {
      explanation.textContent = `${messages.manualIntro} ${messages.manualInstructions[getBrowserKind()]}`;
    }

    banner.append(title, explanation, createCloseButton(messages, () => banner.remove()));
    document.body.appendChild(banner);
  });
}

function showInstallPrompt(): void {
  runWhenBodyExists(() => {
    if (!deferredPrompt || document.getElementById("mmd-install-overlay")) return;
    removeInstallUi();

    const messages = getMessages();
    const overlay = document.createElement("div");
    overlay.id = "mmd-install-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "mmd-install-title");
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483647", "background:rgba(0,0,0,0.72)",
      "display:flex", "align-items:center", "justify-content:center",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", "padding:24px",
    ].join(";");

    const panel = document.createElement("div");
    panel.style.cssText = "background:#1e1e2e;border-radius:14px;padding:36px 40px;text-align:center;color:#e2e8f0;max-width:420px;box-shadow:0 24px 64px rgba(0,0,0,0.6)";

    const icon = document.createElement("div");
    icon.textContent = "📲";
    icon.setAttribute("aria-hidden", "true");
    icon.style.cssText = "font-size:48px;margin-bottom:16px";

    const title = document.createElement("h2");
    title.id = "mmd-install-title";
    title.textContent = messages.promptTitle;
    title.style.cssText = "margin:0 0 10px;font-size:20px;font-weight:700";

    const description = document.createElement("p");
    description.textContent = messages.promptDescription;
    description.style.cssText = "margin:0 0 28px;font-size:14px;opacity:0.75;line-height:1.6";

    const installButton = document.createElement("button");
    installButton.type = "button";
    installButton.textContent = messages.installButton;
    installButton.style.cssText = "background:#1c58d9;color:#fff;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;margin-right:10px";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = messages.cancelButton;
    cancelButton.style.cssText = "background:rgba(255,255,255,0.1);color:#e2e8f0;border:none;border-radius:8px;padding:12px 20px;font-size:15px;cursor:pointer";

    panel.append(icon, title, description, installButton, cancelButton);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    installButton.focus();

    installButton.addEventListener("click", async () => {
      const promptEvent = deferredPrompt;
      if (!promptEvent) return;
      deferredPrompt = null;
      overlay.remove();
      const promptResult = await promptEvent.prompt();
      const choice = promptEvent.userChoice ? await promptEvent.userChoice : promptResult;
      if (choice?.outcome === "accepted") {
        showStatus(messages.installed);
        window.close();
      } else {
        showManualInstallGuide();
      }
    });

    cancelButton.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") overlay.remove();
    });
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event as BeforeInstallPromptEvent;
  showInstallPrompt();
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  removeInstallUi();
  showStatus(getMessages().installed);
});

function handlePageReady(): void {
  if (isStandalone()) {
    showStatus(getMessages().alreadyInstalled);
  } else if (deferredPrompt) {
    showInstallPrompt();
  } else {
    showManualInstallGuide();
  }
}

if (document.readyState === "complete") {
  handlePageReady();
} else {
  window.addEventListener("load", handlePageReady, { once: true });
}
