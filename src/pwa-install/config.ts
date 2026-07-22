import {
  INSTALL_GUIDE_READY_ATTRIBUTE,
  INSTALL_GUIDE_READY_EVENT,
  INSTALL_LANGUAGE_ATTRIBUTE,
  INSTALL_LANGUAGE_READY_EVENT,
  waitForDocumentElement,
} from "./bridge";
import { getProfileStorageKey, PROFILES_STORAGE_KEY } from "../ui/profiles";
import { SETTINGS_KEYS } from "../ui/settings";

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
  return typeof value === "string" ? value : "";
}

function waitForInstallGuide(documentElement: HTMLElement): Promise<void> {
  if (documentElement.hasAttribute(INSTALL_GUIDE_READY_ATTRIBUTE)) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      observer.disconnect();
      documentElement.removeEventListener(INSTALL_GUIDE_READY_EVENT, finish);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (documentElement.hasAttribute(INSTALL_GUIDE_READY_ATTRIBUTE)) finish();
    });
    observer.observe(documentElement, {
      attributes: true,
      attributeFilter: [INSTALL_GUIDE_READY_ATTRIBUTE],
    });
    documentElement.addEventListener(INSTALL_GUIDE_READY_EVENT, finish, { once: true });
    if (documentElement.hasAttribute(INSTALL_GUIDE_READY_ATTRIBUTE)) finish();
  });
}

async function notifyBackgroundWhenReady(): Promise<void> {
  // The tab ID is persisted immediately after tabs.create() resolves. The
  // document_start scripts can win that race, so retry only until the
  // background confirms that this exact sender tab is the pending install tab.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await chrome.runtime.sendMessage({
      type: "mattermost-deck:install-pwa-ready",
    }).catch(() => null) as { success?: boolean } | null;
    if (response?.success) return;
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
}

async function publishConfiguredLanguage(): Promise<void> {
  const documentElement = await waitForDocumentElement();
  const installGuideReady = waitForInstallGuide(documentElement);
  try {
    const language = await getConfiguredLanguage();
    if (language) {
      documentElement.setAttribute(INSTALL_LANGUAGE_ATTRIBUTE, language);
    }
  } catch {
    // The MAIN-world guide falls back to the page/browser language when
    // extension storage is unavailable.
  } finally {
    documentElement.dispatchEvent(new CustomEvent(INSTALL_LANGUAGE_READY_EVENT));
  }
  await installGuideReady;
  await notifyBackgroundWhenReady();
}

void publishConfiguredLanguage();
