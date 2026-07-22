import { SETTINGS_KEYS, normaliseServerUrl, originToPermissionPattern } from "./ui/settings";
import { getProfileStorageKey, PROFILES_STORAGE_KEY } from "./ui/profiles";

const CONTENT_SCRIPT_ID = "mattermost-deck-content";
const INSTALL_CONFIG_SCRIPT_ID = "mattermost-deck-pwa-install-config";
const INSTALL_SCRIPT_ID = "mattermost-deck-pwa-install";
const INSTALL_SCRIPT_IDS = [INSTALL_CONFIG_SCRIPT_ID, INSTALL_SCRIPT_ID];
const RELEASE_NOTICE_STORAGE_KEY = "mattermostDeck.releaseNotice.v1";
const INSTALL_TAB_STORAGE_KEY = "mattermostDeck.pwaInstallTab.v1";
const INSTALL_CLEANUP_ALARM = "mattermost-deck-pwa-install-cleanup";
let contentScriptSyncQueue: Promise<void> = Promise.resolve();

async function configureSessionStorageAccess(): Promise<void> {
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
  } catch {
    // Older Chromium builds may not expose setAccessLevel; keep default behavior there.
  }
}

export async function getConfiguredServerUrl(): Promise<string> {
  const payload = await chrome.storage.local.get([SETTINGS_KEYS.serverUrl, PROFILES_STORAGE_KEY]);
  const registry = payload[PROFILES_STORAGE_KEY] as { lastActiveProfileId?: unknown } | undefined;
  const profileId = typeof registry?.lastActiveProfileId === "string" ? registry.lastActiveProfileId : "";
  if (profileId) {
    const profileKey = getProfileStorageKey(profileId, SETTINGS_KEYS.serverUrl);
    const profilePayload = await chrome.storage.local.get(profileKey);
    const profileValue = normaliseServerUrl(
      typeof profilePayload[profileKey] === "string" ? profilePayload[profileKey] as string : "",
    );
    if (profileValue) {
      if (payload[SETTINGS_KEYS.serverUrl] !== profileValue) {
        await chrome.storage.local.set({ [SETTINGS_KEYS.serverUrl]: profileValue });
      }
      return profileValue;
    }
  }

  // Legacy installations stored only one global URL. Keep it as a migration
  // fallback, but never let it override the active profile's scoped value.
  return normaliseServerUrl(
    typeof payload[SETTINGS_KEYS.serverUrl] === "string" ? payload[SETTINGS_KEYS.serverUrl] as string : "",
  );
}

async function getConfiguredLanguage(): Promise<string> {
  const payload = await chrome.storage.local.get([SETTINGS_KEYS.language, PROFILES_STORAGE_KEY]);
  const registry = payload[PROFILES_STORAGE_KEY] as { lastActiveProfileId?: unknown } | undefined;
  const profileId = typeof registry?.lastActiveProfileId === "string" ? registry.lastActiveProfileId : "";
  if (profileId) {
    const profileKey = getProfileStorageKey(profileId, SETTINGS_KEYS.language);
    const profilePayload = await chrome.storage.local.get(profileKey);
    const profileValue = profilePayload[profileKey];
    if (typeof profileValue === "string" && profileValue) return profileValue;
  }

  const value = payload[SETTINGS_KEYS.language];
  return typeof value === "string" && value ? value : "en";
}

async function unregisterDeckContentScript(): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch {
    // Ignore when the script was not registered yet.
  }
}

let pwaInstallLifecycle = Promise.resolve();

function runPwaInstallLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const result = pwaInstallLifecycle.then(operation);
  pwaInstallLifecycle = result.then(() => undefined, () => undefined);
  return result;
}

async function cleanupPwaInstallScriptNow(expectedTabId?: number): Promise<void> {
  const payload = await chrome.storage.session.get(INSTALL_TAB_STORAGE_KEY).catch(() => ({})) as Record<string, unknown>;
  const pendingTabId = payload[INSTALL_TAB_STORAGE_KEY];
  if (expectedTabId !== undefined && pendingTabId !== expectedTabId) return;
  await chrome.storage.session.remove(INSTALL_TAB_STORAGE_KEY).catch(() => undefined);
  await chrome.alarms.clear(INSTALL_CLEANUP_ALARM).catch(() => false);
  await chrome.scripting.unregisterContentScripts({ ids: INSTALL_SCRIPT_IDS }).catch(() => undefined);
}

function cleanupPwaInstallScript(expectedTabId?: number): Promise<void> {
  return runPwaInstallLifecycle(() => cleanupPwaInstallScriptNow(expectedTabId));
}

async function performDeckContentScriptSync(): Promise<void> {
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

function syncDeckContentScript(): Promise<void> {
  // Storage writes for a profile switch can arrive in quick succession. Keep
  // unregister/register operations ordered so a slower, stale sync cannot win
  // the shared dynamic content-script ID after a newer one.
  const sync = contentScriptSyncQueue.then(
    async () => await performDeckContentScriptSync(),
    async () => await performDeckContentScriptSync(),
  );
  contentScriptSyncQueue = sync.catch(() => undefined);
  return sync;
}

async function refreshExistingDeckTabs(): Promise<void> {
  const serverUrl = await getConfiguredServerUrl();
  const originPattern = originToPermissionPattern(serverUrl);
  if (!originPattern) {
    return;
  }

  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (!hasPermission) {
    return;
  }

  const tabs = await chrome.tabs.query({ url: originPattern });
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) {
        return;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            document.body?.classList.remove("mattermost-deck-body-offset");
            document.getElementById("mattermost-deck-root")?.remove();
          },
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
      } catch {
        // Ignore tabs that navigated, are discarded, or otherwise cannot accept injection.
      }
    }),
  );
}

void configureSessionStorageAccess();

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await cleanupPwaInstallScript();
    await syncDeckContentScript();
    if (details.reason === "update") {
      await refreshExistingDeckTabs();
    }
  })();

  if (details.reason === "install") {
    void chrome.runtime.openOptionsPage();
    return;
  }

  if (details.reason === "update") {
    void chrome.storage.local.set({
      [RELEASE_NOTICE_STORAGE_KEY]: {
        version: chrome.runtime.getManifest().version,
        previousVersion: details.previousVersion ?? null,
        seen: false,
      },
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  void cleanupPwaInstallScript();
  void syncDeckContentScript().catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void cleanupPwaInstallScript(tabId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === INSTALL_CLEANUP_ALARM) void cleanupPwaInstallScript();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  const changedKeys = Object.keys(changes);
  const profileServerUrlPrefix = `${SETTINGS_KEYS.serverUrl}.profile.`;
  if (
    areaName !== "local" ||
    !changedKeys.some((key) =>
      key === SETTINGS_KEYS.serverUrl || key === PROFILES_STORAGE_KEY || key.startsWith(profileServerUrlPrefix)
    )
  ) {
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

      if (message?.type === "mattermost-deck:get-server-url") {
        const [url, language] = await Promise.all([getConfiguredServerUrl(), getConfiguredLanguage()]);
        sendResponse({ success: true, url, language });
        return;
      }

      if (message?.type === "mattermost-deck:install-pwa-ready") {
        const tabId = sender.tab?.id;
        if (typeof tabId !== "number") {
          sendResponse({ success: false });
          return;
        }
        const cleaned = await runPwaInstallLifecycle(async () => {
          const payload = await chrome.storage.session.get(INSTALL_TAB_STORAGE_KEY).catch(() => ({})) as Record<string, unknown>;
          if (payload[INSTALL_TAB_STORAGE_KEY] !== tabId) return false;
          await cleanupPwaInstallScriptNow(tabId);
          return true;
        });
        if (!cleaned) {
          sendResponse({ success: false });
          return;
        }
        sendResponse({ success: true });
        return;
      }

      if (message?.type === "mattermost-deck:install-pwa") {
        const url = normaliseServerUrl(typeof message.url === "string" ? message.url : "");
        const originPattern = originToPermissionPattern(url);
        if (!url || !originPattern) {
          sendResponse({ success: false, error: "Invalid URL" });
          return;
        }

        const created = await runPwaInstallLifecycle(async () => {
          await cleanupPwaInstallScriptNow();
          try {
            await chrome.scripting.registerContentScripts([
              {
                id: INSTALL_CONFIG_SCRIPT_ID,
                matches: [originPattern],
                world: "ISOLATED" as chrome.scripting.ExecutionWorld,
                runAt: "document_start",
                js: ["pwa-install-config.js"],
                persistAcrossSessions: false,
              },
              {
                id: INSTALL_SCRIPT_ID,
                matches: [originPattern],
                world: "MAIN" as chrome.scripting.ExecutionWorld,
                runAt: "document_start",
                js: ["pwa-install.js"],
                persistAcrossSessions: false,
              },
            ]);

            const tab = await chrome.tabs.create({ url });
            if (!tab.id) {
              await cleanupPwaInstallScriptNow();
              return false;
            }

            await chrome.storage.session.set({ [INSTALL_TAB_STORAGE_KEY]: tab.id });
            await chrome.alarms.create(INSTALL_CLEANUP_ALARM, { delayInMinutes: 0.5 });
            return true;
          } catch (error) {
            await cleanupPwaInstallScriptNow();
            throw error;
          }
        });
        if (!created) {
          sendResponse({ success: false, error: "Failed to create install tab" });
          return;
        }
        sendResponse({ success: true });
        return;
      }

      if (message?.type === "mattermost-deck:open-tab") {
        const url = typeof message.url === "string" ? message.url : "";
        if (!url) {
          sendResponse({ success: false, error: "Missing URL" });
          return;
        }
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
          sendResponse({ success: false, error: "Invalid URL scheme" });
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
