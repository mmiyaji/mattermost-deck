import { SETTINGS_KEYS, originToPermissionPattern } from "./ui/settings";

const CONTENT_SCRIPT_ID = "mattermost-deck-content";

async function getConfiguredServerUrl(): Promise<string> {
  const payload = await chrome.storage.local.get(SETTINGS_KEYS.serverUrl);
  const value = payload[SETTINGS_KEYS.serverUrl];
  return typeof value === "string" ? value : "";
}

async function unregisterDeckContentScript(): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch {
    // Ignore when the script was not registered yet.
  }
}

async function syncDeckContentScript(): Promise<void> {
  await unregisterDeckContentScript();

  const serverUrl = await getConfiguredServerUrl();
  const originPattern = originToPermissionPattern(serverUrl);
  if (!originPattern) {
    return;
  }

  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (!hasPermission) {
    return;
  }

  await chrome.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      matches: [originPattern],
      js: ["content.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  void syncDeckContentScript();
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  void syncDeckContentScript();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(SETTINGS_KEYS.serverUrl in changes)) {
    return;
  }

  void syncDeckContentScript();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "mattermost-deck:open-options") {
    void chrome.runtime.openOptionsPage();
    return;
  }

  if (message?.type === "mattermost-deck:sync-content-script") {
    void syncDeckContentScript();
  }
});
