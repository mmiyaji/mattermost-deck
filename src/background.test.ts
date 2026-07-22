import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_KEYS } from "./ui/settings";
import { getProfileStorageKey, PROFILES_STORAGE_KEY } from "./ui/profiles";

function createStorageArea(values: Map<string, unknown>) {
  return {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      const result: Record<string, unknown> = {};
      if (keys == null) {
        for (const [key, value] of values) result[key] = value;
      } else if (typeof keys === "string") {
        if (values.has(keys)) result[keys] = values.get(keys);
      } else if (Array.isArray(keys)) {
        for (const key of keys) if (values.has(key)) result[key] = values.get(key);
      } else {
        for (const [key, fallback] of Object.entries(keys)) result[key] = values.get(key) ?? fallback;
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) values.delete(key);
    }),
    setAccessLevel: vi.fn(async () => undefined),
  };
}

async function loadBackground(localValues: Map<string, unknown>) {
  vi.resetModules();
  const messageListeners: Array<(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void> = [];
  const tabUpdatedListeners: Array<(
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab,
  ) => void> = [];
  const addListener = vi.fn();
  const sessionValues = new Map<string, unknown>();
  const local = createStorageArea(localValues);
  const session = createStorageArea(sessionValues);
  const registerContentScripts = vi.fn(async () => undefined);
  const unregisterContentScripts = vi.fn(async () => undefined);
  const tabsCreate = vi.fn(async () => ({ id: 42 }));

  vi.stubGlobal("chrome", {
    storage: {
      local,
      session,
      onChanged: { addListener },
    },
    runtime: {
      getManifest: () => ({ version: "0.2.6" }),
      openOptionsPage: vi.fn(async () => undefined),
      onInstalled: { addListener },
      onStartup: { addListener },
      onMessage: { addListener: vi.fn((listener) => messageListeners.push(listener)) },
    },
    scripting: {
      unregisterContentScripts,
      registerContentScripts,
      executeScript: vi.fn(async () => undefined),
    },
    permissions: { contains: vi.fn(async () => true) },
    tabs: {
      query: vi.fn(async () => []),
      create: tabsCreate,
      onUpdated: { addListener: vi.fn((listener) => tabUpdatedListeners.push(listener)) },
      onRemoved: { addListener },
    },
    alarms: {
      clear: vi.fn(async () => true),
      create: vi.fn(async () => undefined),
      onAlarm: { addListener },
    },
  });

  const background = await import("./background.js");
  return {
    background,
    local,
    messageListeners,
    registerContentScripts,
    unregisterContentScripts,
    tabsCreate,
    tabUpdatedListeners,
  };
}

describe("background active profile settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers the active profile URL over a stale global migration value", async () => {
    const localValues = new Map<string, unknown>();
    const activeProfileId = "profile-two";
    const activeServerUrl = "https://mattermost.example.test/company/two";
    localValues.set(SETTINGS_KEYS.serverUrl, "https://mattermost.example.test/company/one");
    localValues.set(PROFILES_STORAGE_KEY, { lastActiveProfileId: activeProfileId });
    localValues.set(getProfileStorageKey(activeProfileId, SETTINGS_KEYS.serverUrl), activeServerUrl);

    const { background } = await loadBackground(localValues);

    await expect(background.getConfiguredServerUrl()).resolves.toBe(activeServerUrl);
    expect(localValues.get(SETTINGS_KEYS.serverUrl)).toBe(activeServerUrl);
  });

  it("uses the legacy global URL only when the active profile has no scoped URL", async () => {
    const legacyServerUrl = "https://mattermost.example.test/company/legacy";
    const localValues = new Map<string, unknown>([
      [SETTINGS_KEYS.serverUrl, legacyServerUrl],
      [PROFILES_STORAGE_KEY, { lastActiveProfileId: "profile-one" }],
    ]);
    const { background } = await loadBackground(localValues);

    await expect(background.getConfiguredServerUrl()).resolves.toBe(legacyServerUrl);
  });

  it("registers both the isolated configuration bridge and main install guide", async () => {
    const { messageListeners, registerContentScripts, unregisterContentScripts } =
      await loadBackground(new Map());
    const listener = messageListeners[0];
    const response = await new Promise<unknown>((resolve) => {
      listener(
        { type: "mattermost-deck:install-pwa", url: "https://mattermost.example.test/company/mattermost" },
        {} as chrome.runtime.MessageSender,
        resolve,
      );
    });

    expect(response).toEqual({ success: true });
    expect(unregisterContentScripts).toHaveBeenCalledWith({
      ids: ["mattermost-deck-pwa-install-config", "mattermost-deck-pwa-install"],
    });
    expect(registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "mattermost-deck-pwa-install-config",
        world: "ISOLATED",
        js: ["pwa-install-config.js"],
      }),
      expect.objectContaining({
        id: "mattermost-deck-pwa-install",
        world: "MAIN",
        js: ["pwa-install.js"],
      }),
    ]);

    const cleanupCallCount = unregisterContentScripts.mock.calls.length;
    const mismatchedReadyResponse = await new Promise<unknown>((resolve) => {
      listener(
        { type: "mattermost-deck:install-pwa-ready" },
        { tab: { id: 7 } } as chrome.runtime.MessageSender,
        resolve,
      );
    });
    expect(mismatchedReadyResponse).toEqual({ success: false });
    expect(unregisterContentScripts).toHaveBeenCalledTimes(cleanupCallCount);

    const readyResponse = await new Promise<unknown>((resolve) => {
      listener(
        { type: "mattermost-deck:install-pwa-ready" },
        { tab: { id: 42 } } as chrome.runtime.MessageSender,
        resolve,
      );
    });
    expect(readyResponse).toEqual({ success: true });
    expect(unregisterContentScripts).toHaveBeenCalledTimes(cleanupCallCount + 1);

    const duplicateReadyResponse = await new Promise<unknown>((resolve) => {
      listener(
        { type: "mattermost-deck:install-pwa-ready" },
        { tab: { id: 42 } } as chrome.runtime.MessageSender,
        resolve,
      );
    });
    expect(duplicateReadyResponse).toEqual({ success: false });
    expect(unregisterContentScripts).toHaveBeenCalledTimes(cleanupCallCount + 1);
  });

  it("keeps consecutive install lifecycles isolated and ignores stale or duplicate ready messages", async () => {
    const { messageListeners, registerContentScripts, unregisterContentScripts, tabsCreate } =
      await loadBackground(new Map());
    tabsCreate
      .mockResolvedValueOnce({ id: 42 })
      .mockResolvedValueOnce({ id: 43 });
    const listener = messageListeners[0];
    const send = (message: unknown, tabId?: number) => new Promise<unknown>((resolve) => {
      listener(
        message,
        (tabId === undefined ? {} : { tab: { id: tabId } }) as chrome.runtime.MessageSender,
        resolve,
      );
    });

    await expect(send({
      type: "mattermost-deck:install-pwa",
      url: "https://mattermost.example.test/one",
    })).resolves.toEqual({ success: true });
    await expect(send({
      type: "mattermost-deck:install-pwa",
      url: "https://mattermost.example.test/two",
    })).resolves.toEqual({ success: true });
    expect(registerContentScripts).toHaveBeenCalledTimes(2);

    const cleanupCallCount = unregisterContentScripts.mock.calls.length;
    await expect(send({ type: "mattermost-deck:install-pwa-ready" }, 42)).resolves.toEqual({ success: false });
    expect(unregisterContentScripts).toHaveBeenCalledTimes(cleanupCallCount);

    await expect(send({ type: "mattermost-deck:install-pwa-ready" }, 43)).resolves.toEqual({ success: true });
    expect(unregisterContentScripts).toHaveBeenCalledTimes(cleanupCallCount + 1);
    await expect(send({ type: "mattermost-deck:install-pwa-ready" }, 43)).resolves.toEqual({ success: false });
    expect(unregisterContentScripts).toHaveBeenCalledTimes(cleanupCallCount + 1);
  });
});
