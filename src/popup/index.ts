const SERVER_URL_KEY = "mattermostDeck.serverUrl.v1";

document.addEventListener("DOMContentLoaded", async () => {
  const result = await chrome.storage.local.get(SERVER_URL_KEY);
  const serverUrl: string = typeof result[SERVER_URL_KEY] === "string" ? result[SERVER_URL_KEY] : "";

  const btnInstall = document.getElementById("btn-install") as HTMLButtonElement;
  const btnPage = document.getElementById("btn-page") as HTMLButtonElement;
  const btnSettings = document.getElementById("btn-settings") as HTMLButtonElement;

  if (!serverUrl) {
    void chrome.runtime.openOptionsPage();
    window.close();
    return;
  }

  btnInstall.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "mattermost-deck:install-pwa", url: serverUrl });
    window.close();
  });

  btnPage.addEventListener("click", async () => {
    const existing = await chrome.tabs.query({ url: `${serverUrl}/*` });
    if (existing.length > 0 && existing[0].id != null && existing[0].windowId != null) {
      await chrome.tabs.update(existing[0].id, { active: true });
      await chrome.windows.update(existing[0].windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: serverUrl });
    }
    window.close();
  });

  btnSettings.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
    window.close();
  });
});
