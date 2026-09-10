import { SETTINGS_KEYS, normaliseServerUrl, originToPermissionPattern } from "./ui/settings";
import { getProfileStorageKey, PROFILES_STORAGE_KEY } from "./ui/profiles";
import { resolveDeckLanguage } from "./ui/language";

const CONTENT_SCRIPT_ID = "mattermost-deck-content";
const INSTALL_CONFIG_SCRIPT_ID = "mattermost-deck-pwa-install-config";
const INSTALL_SCRIPT_ID = "mattermost-deck-pwa-install";
const INSTALL_SCRIPT_IDS = [INSTALL_CONFIG_SCRIPT_ID, INSTALL_SCRIPT_ID];
const RELEASE_NOTICE_STORAGE_KEY = "mattermostDeck.releaseNotice.v1";
const INSTALL_TAB_STORAGE_KEY = "mattermostDeck.pwaInstallTab.v1";
const INSTALL_CLEANUP_ALARM = "mattermost-deck-pwa-install-cleanup";
let contentScriptSyncQueue: Promise<void> = Promise.resolve();
let contentScriptSyncRevision = 0;
let pendingContentScriptUpdateRefresh = false;

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

export async function getConfiguredLanguage(): Promise<string> {
  const payload = await chrome.storage.local.get([SETTINGS_KEYS.language, PROFILES_STORAGE_KEY]);
  const registry = payload[PROFILES_STORAGE_KEY] as { lastActiveProfileId?: unknown } | undefined;
  const profileId = typeof registry?.lastActiveProfileId === "string" ? registry.lastActiveProfileId : "";
  if (profileId) {
    const profileKey = getProfileStorageKey(profileId, SETTINGS_KEYS.language);
    const profilePayload = await chrome.storage.local.get(profileKey);
    const profileValue = profilePayload[profileKey];
    if (typeof profileValue === "string" && profileValue) {
      return resolveDeckLanguage(profileValue);
    }
  }

  const value = payload[SETTINGS_KEYS.language];
  return resolveDeckLanguage(value);
}

function createDeckContentScript(originPattern: string): chrome.scripting.RegisteredContentScript {
  return {
    id: CONTENT_SCRIPT_ID,
    matches: [originPattern],
    js: ["content.js"],
    allFrames: false,
    matchOriginAsFallback: false,
    runAt: "document_idle",
    world: "ISOLATED",
    persistAcrossSessions: true,
  };
}

function stringArraysEqual(actual: string[] | undefined, expected: string[]): boolean {
  return actual?.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function isCurrentDeckContentScript(
  script: chrome.scripting.RegisteredContentScript,
  expected: chrome.scripting.RegisteredContentScript,
): boolean {
  return stringArraysEqual(script.matches, expected.matches ?? [])
    && stringArraysEqual(script.js, expected.js ?? [])
    && (script.allFrames ?? false) === false
    && (script.matchOriginAsFallback ?? false) === false
    && (script.runAt ?? "document_idle") === "document_idle"
    && (script.world ?? "ISOLATED") === "ISOLATED"
    && (script.persistAcrossSessions ?? true) === true;
}

async function ensureDeckContentScriptInExistingTabs(
  originPattern: string,
  shouldContinue: () => boolean = () => true,
): Promise<void> {
  if (!shouldContinue()) {
    return;
  }

  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ url: originPattern });
  } catch {
    return;
  }
  if (!shouldContinue()) {
    return;
  }

  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number" || !shouldContinue()) {
        return;
      }

      try {
        const runtimeResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "ISOLATED",
          func: () => typeof (
            globalThis as typeof globalThis & {
              __mattermostDeckContentRuntimeV1?: {
                dispose?: unknown;
              };
            }
          ).__mattermostDeckContentRuntimeV1?.dispose === "function",
        });
        if (runtimeResults[0]?.result === true || !shouldContinue()) {
          return;
        }

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "ISOLATED",
          files: ["content.js"],
        });
      } catch {
        // Ignore tabs that navigated, are discarded, or otherwise cannot accept injection.
      }
    }),
  );
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

type ExistingTabSyncMode = "repair-missing" | "refresh-after-update";

async function performDeckContentScriptRegistrationSync(): Promise<string | null> {
  // Read and validate the desired state before mutating the persisted registration.
  // Removing it first creates a startup gap in which restored tabs can miss injection.
  const serverUrl = await getConfiguredServerUrl();
  const originPattern = originToPermissionPattern(serverUrl);
  const registeredScripts = await chrome.scripting.getRegisteredContentScripts({
    ids: [CONTENT_SCRIPT_ID],
  });
  const registeredScript = registeredScripts[0];

  if (!originPattern) {
    if (registeredScript) {
      await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }
    return null;
  }

  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (!hasPermission) {
    if (registeredScript) {
      await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }
    return null;
  }

  const expectedScript = createDeckContentScript(originPattern);
  if (!registeredScript) {
    await chrome.scripting.registerContentScripts([expectedScript]);
  } else if (!isCurrentDeckContentScript(registeredScript, expectedScript)) {
    // Updating in place keeps the previous valid registration if validation fails.
    await chrome.scripting.updateContentScripts([expectedScript]);
  }
  return originPattern;
}

function syncDeckContentScript(options: { existingTabs?: ExistingTabSyncMode } = {}): Promise<void> {
  const existingTabMode = options.existingTabs ?? "repair-missing";
  if (existingTabMode === "refresh-after-update") {
    // An ordinary storage-triggered sync can supersede an update sync while the
    // registration queue is still running. Keep the stronger refresh intent
    // until the newest sync has actually refreshed the already-open tabs.
    pendingContentScriptUpdateRefresh = true;
  }
  const revision = ++contentScriptSyncRevision;
  // Storage writes for a profile switch can arrive in quick succession. Keep
  // registration updates ordered so a slower, stale sync cannot win the shared
  // dynamic content-script ID after a newer one. Existing-tab repair is kept
  // outside this queue because executeScript can wait for a loading document.
  const registrationSync = contentScriptSyncQueue.then(
    () => performDeckContentScriptRegistrationSync(),
    () => performDeckContentScriptRegistrationSync(),
  );
  contentScriptSyncQueue = registrationSync.then(() => undefined, () => undefined);

  return registrationSync.then((originPattern) => {
    if (!originPattern || revision !== contentScriptSyncRevision) {
      return;
    }

    const shouldContinue = () => revision === contentScriptSyncRevision;
    const shouldRefreshAfterUpdate = pendingContentScriptUpdateRefresh;
    const existingTabSync = shouldRefreshAfterUpdate
      ? refreshExistingDeckTabs({ originPattern, shouldContinue })
      : ensureDeckContentScriptInExistingTabs(originPattern, shouldContinue);
    void existingTabSync.then(
      () => {
        if (shouldRefreshAfterUpdate && revision === contentScriptSyncRevision) {
          pendingContentScriptUpdateRefresh = false;
        }
      },
      (error) => {
        console.error("[Mattermost Deck] Failed to synchronize existing tabs", error);
      },
    );
  });
}

interface ExistingTabSyncOptions {
  originPattern?: string;
  shouldContinue?: () => boolean;
}

export async function refreshExistingDeckTabs(options: ExistingTabSyncOptions = {}): Promise<void> {
  const shouldContinue = options.shouldContinue ?? (() => true);
  if (!shouldContinue()) {
    return;
  }

  const originPattern = options.originPattern
    ?? originToPermissionPattern(await getConfiguredServerUrl());
  if (!originPattern) {
    return;
  }

  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (!hasPermission || !shouldContinue()) {
    return;
  }

  const tabs = await chrome.tabs.query({ url: originPattern });
  if (!shouldContinue()) {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number" || !shouldContinue()) {
        return;
      }

      try {
        const cleanupResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const runtime = (
              globalThis as typeof globalThis & {
                __mattermostDeckContentRuntimeV1?: {
                  dispose?: () => void;
                };
              }
            ).__mattermostDeckContentRuntimeV1;
            let disposed = false;
            if (typeof runtime?.dispose === "function") {
              try {
                runtime.dispose();
                disposed = true;
              } catch {
                disposed = false;
              }
            } else {
              // Transitional builds may understand the event without exposing
              // the registry. A reload is still used below because it is the
              // only way to remove history wrappers from older releases.
              window.dispatchEvent(
                new CustomEvent("mattermost-deck:dispose-content-runtime"),
              );
            }
            document.body?.classList.remove("mattermost-deck-body-offset");
            document.getElementById("mattermost-deck-root")?.remove();
            return disposed;
          },
        });
        if (!shouldContinue()) {
          return;
        }
        if (cleanupResults[0]?.result === true) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });
        } else {
          // Releases before the runtime registry cannot restore patched
          // history methods or detach observers. Reload once on extension
          // update so the old isolated-world state is fully discarded.
          await chrome.tabs.reload(tab.id);
        }
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
    await syncDeckContentScript({
      existingTabs: details.reason === "update" ? "refresh-after-update" : "repair-missing",
    });
  })().catch((error) => {
    console.error("[Mattermost Deck] Failed to synchronize the content script after installation", error);
  });

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
  void syncDeckContentScript().catch((error) => {
    console.error("[Mattermost Deck] Failed to synchronize the content script during startup", error);
  });
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

  void syncDeckContentScript().catch((error) => {
    console.error("[Mattermost Deck] Failed to synchronize the content script after a settings change", error);
  });
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
