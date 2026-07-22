import { getPopupMessages, resolvePopupLocale } from "./messages";

document.addEventListener("DOMContentLoaded", async () => {
  const result = await chrome.runtime.sendMessage({ type: "mattermost-deck:get-server-url" }).catch(() => null) as { url?: unknown; language?: unknown } | null;
  const serverUrl = typeof result?.url === "string" ? result.url : "";
  const locale = resolvePopupLocale(result?.language, navigator.languages);
  const messages = getPopupMessages(locale);

  document.documentElement.lang = locale;
  document.getElementById("label-install")!.textContent = messages.installApp;
  document.getElementById("label-page")!.textContent = messages.openMattermost;
  document.getElementById("label-settings")!.textContent = messages.settings;

  const btnInstall = document.getElementById("btn-install") as HTMLButtonElement;
  const btnPage = document.getElementById("btn-page") as HTMLButtonElement;
  const btnSettings = document.getElementById("btn-settings") as HTMLButtonElement;
  const errorMessage = document.getElementById("popup-error") as HTMLParagraphElement;
  const showError = (message: string) => {
    errorMessage.textContent = message;
    errorMessage.dataset.visible = "true";
  };

  if (!serverUrl) {
    void chrome.runtime.openOptionsPage();
    window.close();
    return;
  }

  btnInstall.addEventListener("click", async () => {
    btnInstall.disabled = true;
    errorMessage.dataset.visible = "false";
    try {
      const response = await chrome.runtime.sendMessage({ type: "mattermost-deck:install-pwa", url: serverUrl }) as { success?: boolean } | undefined;
      if (!response?.success) {
        showError(messages.installFailed);
        btnInstall.disabled = false;
        return;
      }
      window.close();
    } catch {
      showError(messages.installFailed);
      btnInstall.disabled = false;
    }
  });

  btnPage.addEventListener("click", async () => {
    btnPage.disabled = true;
    errorMessage.dataset.visible = "false";
    try {
      const existing = await chrome.tabs.query({ url: `${serverUrl}/*` });
      if (existing.length > 0 && existing[0].id != null && existing[0].windowId != null) {
        await chrome.tabs.update(existing[0].id, { active: true });
        await chrome.windows.update(existing[0].windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: serverUrl });
      }
      window.close();
    } catch {
      showError(messages.openFailed);
      btnPage.disabled = false;
    }
  });

  btnSettings.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
    window.close();
  });
});
