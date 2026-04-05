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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "mattermost-deck:open-options") {
        await chrome.runtime.openOptionsPage();
        sendResponse({ success: true });
        return;
      }

      if (message?.type === "mattermost-deck:install-pwa") {
        const url = typeof message.url === "string" ? message.url : "";
        const originPattern = originToPermissionPattern(url);
        if (!url || !originPattern) {
          sendResponse({ success: false, error: "Invalid URL" });
          return;
        }

        const INSTALL_SCRIPT_ID = "mattermost-deck-pwa-install";
        try {
          await chrome.scripting.unregisterContentScripts({ ids: [INSTALL_SCRIPT_ID] });
        } catch { /* not registered yet */ }

        await chrome.scripting.registerContentScripts([{
          id: INSTALL_SCRIPT_ID,
          matches: [originPattern],
          world: "MAIN" as chrome.scripting.ExecutionWorld,
          runAt: "document_start",
          js: ["pwa-install.js"],
          persistAcrossSessions: false,
        }]);

        chrome.tabs.create({ url }, (tab) => {
          if (!tab.id) return;
          const tabId = tab.id;
          const cleanup: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (id, info) => {
            if (id !== tabId || info.status !== "complete") return;

            chrome.tabs.onUpdated.removeListener(cleanup);
            void chrome.scripting.unregisterContentScripts({ ids: [INSTALL_SCRIPT_ID] });
          };
          chrome.tabs.onUpdated.addListener(cleanup);
        });
        sendResponse({ success: true });
        return;
      }

      if (message?.type === "mattermost-deck:open-tab") {
        const url = typeof message.url === "string" ? message.url : "";
        if (!url) {
          sendResponse({ success: false, error: "Missing URL" });
          return;
        }
        await chrome.tabs.create({ url });
        sendResponse({ success: true });
        return;
      }

      if (message?.type === "mattermost-deck:sync-content-script") {
        await syncDeckContentScript();
        sendResponse({ success: true });
        return;
      }

      sendResponse({ success: false, error: "Unknown message type" });
    } catch (error) {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();

  // Return true to indicate that sendResponse will be called asynchronously
  return true;
});
