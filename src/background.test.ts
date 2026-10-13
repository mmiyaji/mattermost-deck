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

async function loadBackground(
  localValues: Map<string, unknown>,
  uiLanguage = "en-US",
  navigatorLanguages: readonly string[] = ["fr-FR"],
) {
  vi.resetModules();
  const messageListeners: Array<(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void> = [];
  const installedListeners: Array<(details: chrome.runtime.InstalledDetails) => void> = [];
  const startupListeners: Array<() => void> = [];
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
  const getRegisteredContentScripts = vi.fn(
    async () => [] as chrome.scripting.RegisteredContentScript[],
  );
  const updateContentScripts = vi.fn(async () => undefined);
  const executeScript = vi.fn(
    async (_injection: unknown) =>
      [] as chrome.scripting.InjectionResult[],
  );
  const permissionsContains = vi.fn(async () => true);
  const tabsQuery = vi.fn(async () => [] as chrome.tabs.Tab[]);
  const tabsReload = vi.fn(async () => undefined);
  const tabsCreate = vi.fn(async () => ({ id: 42 }));

  vi.stubGlobal("navigator", {
    language: navigatorLanguages[0] ?? "",
    languages: navigatorLanguages,
  });
  vi.stubGlobal("chrome", {
    i18n: { getUILanguage: () => uiLanguage },
    storage: {
      local,
      session,
      onChanged: { addListener },
    },
    runtime: {
      getManifest: () => ({ version: "1.0.9" }),
      openOptionsPage: vi.fn(async () => undefined),
      onInstalled: {
        addListener: vi.fn((listener: (details: chrome.runtime.InstalledDetails) => void) => {
          installedListeners.push(listener);
        }),
      },
      onStartup: {
        addListener: vi.fn((listener: () => void) => startupListeners.push(listener)),
      },
      onMessage: { addListener: vi.fn((listener) => messageListeners.push(listener)) },
    },
    scripting: {
      unregisterContentScripts,
      registerContentScripts,
      getRegisteredContentScripts,
      updateContentScripts,
      executeScript,
    },
    permissions: { contains: permissionsContains },
    tabs: {
      query: tabsQuery,
      create: tabsCreate,
      reload: tabsReload,
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
    installedListeners,
    startupListeners,
    registerContentScripts,
    unregisterContentScripts,
    getRegisteredContentScripts,
    updateContentScripts,
    executeScript,
    permissionsContains,
    tabsQuery,
    tabsReload,
    tabsCreate,
    tabUpdatedListeners,
  };
}

function createDeckContentScript(originPattern: string): chrome.scripting.RegisteredContentScript {
  return {
    id: "mattermost-deck-content",
    matches: [originPattern],
    js: ["content.js"],
    allFrames: false,
    matchOriginAsFallback: false,
    runAt: "document_idle",
    world: "ISOLATED",
    persistAcrossSessions: true,
  };
}

function sendBackgroundMessage(
  listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void,
  message: unknown,
): Promise<unknown> {
  return new Promise((resolve) => {
    listener(message, {} as chrome.runtime.MessageSender, resolve);
  });
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

  it("uses the Chrome UI language for empty storage before navigator language", async () => {
    const { background } = await loadBackground(new Map(), "de-DE", ["fr-FR"]);

    await expect(background.getConfiguredLanguage()).resolves.toBe("de");
  });

  it("keeps the persistent registration during startup and repairs a restored tab", async () => {
    const serverUrl = "https://mattermost.example.test/company";
    const originPattern = "https://mattermost.example.test/*";
    const {
      startupListeners,
      getRegisteredContentScripts,
      registerContentScripts,
      updateContentScripts,
      unregisterContentScripts,
      executeScript,
      tabsQuery,
      tabsReload,
    } = await loadBackground(new Map([[SETTINGS_KEYS.serverUrl, serverUrl]]));
    getRegisteredContentScripts.mockResolvedValue([{
      id: "mattermost-deck-content",
      matches: [originPattern],
      js: ["content.js"],
    }]);
    tabsQuery.mockResolvedValue([{ id: 7 }] as chrome.tabs.Tab[]);
    executeScript.mockResolvedValueOnce([
      { result: false },
    ] as chrome.scripting.InjectionResult[]);

    expect(startupListeners).toHaveLength(1);
    startupListeners[0]?.();

    await vi.waitFor(() => {
      expect(executeScript).toHaveBeenCalledWith({
        target: { tabId: 7 },
        world: "ISOLATED",
        files: ["content.js"],
      });
    });
    expect(tabsQuery).toHaveBeenCalledWith({ url: originPattern });
    expect(registerContentScripts).not.toHaveBeenCalled();
    expect(updateContentScripts).not.toHaveBeenCalled();
    expect(unregisterContentScripts).not.toHaveBeenCalledWith({
      ids: ["mattermost-deck-content"],
    });
    expect(tabsReload).not.toHaveBeenCalled();
  });

  it("registers a missing content script and injects it into an already open tab", async () => {
    const serverUrl = "https://mattermost.example.test/company";
    const originPattern = "https://mattermost.example.test/*";
    const {
      messageListeners,
      registerContentScripts,
      updateContentScripts,
      unregisterContentScripts,
      executeScript,
      tabsQuery,
    } = await loadBackground(new Map([[SETTINGS_KEYS.serverUrl, serverUrl]]));
    tabsQuery.mockResolvedValue([{ id: 11 }] as chrome.tabs.Tab[]);
    executeScript.mockResolvedValueOnce([
      { result: false },
    ] as chrome.scripting.InjectionResult[]);

    const response = await sendBackgroundMessage(messageListeners[0], {
      type: "mattermost-deck:sync-content-script",
    });

    expect(response).toEqual({ success: true });
    expect(registerContentScripts).toHaveBeenCalledWith([
      createDeckContentScript(originPattern),
    ]);
    expect(updateContentScripts).not.toHaveBeenCalled();
    expect(unregisterContentScripts).not.toHaveBeenCalledWith({
      ids: ["mattermost-deck-content"],
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 11 },
      world: "ISOLATED",
      files: ["content.js"],
    });
  });

  it("does not let a blocked restored tab delay a newer registration sync", async () => {
    const firstServerUrl = "https://first-mattermost.example.test/company";
    const firstOriginPattern = "https://first-mattermost.example.test/*";
    const secondServerUrl = "https://second-mattermost.example.test/company";
    const secondOriginPattern = "https://second-mattermost.example.test/*";
    const localValues = new Map<string, unknown>([[SETTINGS_KEYS.serverUrl, firstServerUrl]]);
    const {
      messageListeners,
      getRegisteredContentScripts,
      updateContentScripts,
      executeScript,
      tabsQuery,
    } = await loadBackground(localValues);
    getRegisteredContentScripts.mockResolvedValue([
      createDeckContentScript(firstOriginPattern),
    ]);
    tabsQuery.mockResolvedValue([{ id: 21 }] as chrome.tabs.Tab[]);

    let releaseBlockedProbe: ((results: chrome.scripting.InjectionResult[]) => void) | undefined;
    const blockedProbe = new Promise<chrome.scripting.InjectionResult[]>((resolve) => {
      releaseBlockedProbe = resolve;
    });
    let probeCount = 0;
    executeScript.mockImplementation(async (injection: unknown) => {
      const request = injection as { files?: string[] };
      if (!request.files) {
        probeCount += 1;
        if (probeCount === 1) {
          return await blockedProbe;
        }
        return [{ result: true }] as chrome.scripting.InjectionResult[];
      }
      return [] as chrome.scripting.InjectionResult[];
    });

    await expect(sendBackgroundMessage(messageListeners[0], {
      type: "mattermost-deck:sync-content-script",
    })).resolves.toEqual({ success: true });
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledTimes(1));

    localValues.set(SETTINGS_KEYS.serverUrl, secondServerUrl);
    await expect(sendBackgroundMessage(messageListeners[0], {
      type: "mattermost-deck:sync-content-script",
    })).resolves.toEqual({ success: true });

    expect(updateContentScripts).toHaveBeenCalledWith([
      createDeckContentScript(secondOriginPattern),
    ]);
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledTimes(2));

    releaseBlockedProbe?.([{ result: false }] as chrome.scripting.InjectionResult[]);
    await blockedProbe;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const staleInjectionCalls = executeScript.mock.calls.filter(([injection]) =>
      (injection as { files?: string[] }).files?.includes("content.js")
    );
    expect(staleInjectionCalls).toHaveLength(0);
  });

  it("updates a changed registration in place without creating an injection gap", async () => {
    const originPattern = "https://mattermost.example.test/*";
    const {
      messageListeners,
      getRegisteredContentScripts,
      registerContentScripts,
      updateContentScripts,
      unregisterContentScripts,
    } = await loadBackground(new Map([[
      SETTINGS_KEYS.serverUrl,
      "https://mattermost.example.test/company",
    ]]));
    getRegisteredContentScripts.mockResolvedValue([
      createDeckContentScript("https://old-mattermost.example.test/*"),
    ]);

    const response = await sendBackgroundMessage(messageListeners[0], {
      type: "mattermost-deck:sync-content-script",
    });

    expect(response).toEqual({ success: true });
    expect(updateContentScripts).toHaveBeenCalledWith([
      createDeckContentScript(originPattern),
    ]);
    expect(registerContentScripts).not.toHaveBeenCalled();
    expect(unregisterContentScripts).not.toHaveBeenCalledWith({
      ids: ["mattermost-deck-content"],
    });
  });

  it("preserves an existing registration when the permission lookup fails", async () => {
    const originPattern = "https://mattermost.example.test/*";
    const {
      messageListeners,
      getRegisteredContentScripts,
      permissionsContains,
      registerContentScripts,
      updateContentScripts,
      unregisterContentScripts,
      tabsQuery,
    } = await loadBackground(new Map([[
      SETTINGS_KEYS.serverUrl,
      "https://mattermost.example.test/company",
    ]]));
    getRegisteredContentScripts.mockResolvedValue([
      createDeckContentScript(originPattern),
    ]);
    permissionsContains.mockRejectedValueOnce(new Error("permission lookup failed"));

    const response = await sendBackgroundMessage(messageListeners[0], {
      type: "mattermost-deck:sync-content-script",
    });

    expect(response).toEqual({ success: false, error: "permission lookup failed" });
    expect(registerContentScripts).not.toHaveBeenCalled();
    expect(updateContentScripts).not.toHaveBeenCalled();
    expect(unregisterContentScripts).not.toHaveBeenCalledWith({
      ids: ["mattermost-deck-content"],
    });
    expect(tabsQuery).not.toHaveBeenCalled();
  });

  it("does not remove the previous registration when an in-place update fails", async () => {
    const {
      messageListeners,
      getRegisteredContentScripts,
      registerContentScripts,
      updateContentScripts,
      unregisterContentScripts,
      tabsQuery,
    } = await loadBackground(new Map([[
      SETTINGS_KEYS.serverUrl,
      "https://mattermost.example.test/company",
    ]]));
    getRegisteredContentScripts.mockResolvedValue([
      createDeckContentScript("https://old-mattermost.example.test/*"),
    ]);
    updateContentScripts.mockRejectedValueOnce(new Error("update failed"));

    const response = await sendBackgroundMessage(messageListeners[0], {
      type: "mattermost-deck:sync-content-script",
    });

    expect(response).toEqual({ success: false, error: "update failed" });
    expect(registerContentScripts).not.toHaveBeenCalled();
    expect(unregisterContentScripts).not.toHaveBeenCalledWith({
      ids: ["mattermost-deck-content"],
    });
    expect(tabsQuery).not.toHaveBeenCalled();
  });

  it("removes a stale registration only when site access is intentionally absent", async () => {
    const originPattern = "https://mattermost.example.test/*";
    const {
      messageListeners,
      getRegisteredContentScripts,
      permissionsContains,
      registerContentScripts,
      updateContentScripts,
      unregisterContentScripts,
      tabsQuery,
    } = await loadBackground(new Map([[
      SETTINGS_KEYS.serverUrl,
      "https://mattermost.example.test/company",
    ]]));
    getRegisteredContentScripts.mockResolvedValue([
      createDeckContentScript(originPattern),
    ]);
    permissionsContains.mockResolvedValueOnce(false);

    const response = await sendBackgroundMessage(messageListeners[0], {
      type: "mattermost-deck:sync-content-script",
    });

    expect(response).toEqual({ success: true });
    expect(unregisterContentScripts).toHaveBeenCalledWith({
      ids: ["mattermost-deck-content"],
    });
    expect(registerContentScripts).not.toHaveBeenCalled();
    expect(updateContentScripts).not.toHaveBeenCalled();
    expect(tabsQuery).not.toHaveBeenCalled();
  });

  it("does not reinject when the existing tab already has a healthy runtime", async () => {
    const originPattern = "https://mattermost.example.test/*";
    const {
      messageListeners,
      getRegisteredContentScripts,
      executeScript,
      tabsQuery,
    } = await loadBackground(new Map([[
      SETTINGS_KEYS.serverUrl,
      "https://mattermost.example.test/company",
    ]]));
    getRegisteredContentScripts.mockResolvedValue([
      createDeckContentScript(originPattern),
    ]);
    tabsQuery.mockResolvedValue([{ id: 13 }] as chrome.tabs.Tab[]);
    executeScript.mockResolvedValueOnce([
      { result: true },
    ] as chrome.scripting.InjectionResult[]);

    const response = await sendBackgroundMessage(messageListeners[0], {
      type: "mattermost-deck:sync-content-script",
    });

    expect(response).toEqual({ success: true });
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 13 },
      world: "ISOLATED",
      func: expect.any(Function),
    }));
  });

  it("keeps the legacy-runtime update cleanup ahead of missing-runtime repair", async () => {
    const originPattern = "https://mattermost.example.test/*";
    const {
      installedListeners,
      getRegisteredContentScripts,
      executeScript,
      tabsQuery,
      tabsReload,
    } = await loadBackground(new Map([[
      SETTINGS_KEYS.serverUrl,
      "https://mattermost.example.test/company",
    ]]));
    getRegisteredContentScripts.mockResolvedValue([
      createDeckContentScript(originPattern),
    ]);
    tabsQuery.mockResolvedValue([{ id: 17 }] as chrome.tabs.Tab[]);
    executeScript.mockResolvedValueOnce([
      { result: false },
    ] as chrome.scripting.InjectionResult[]);

    expect(installedListeners).toHaveLength(1);
    installedListeners[0]?.({ reason: "update", previousVersion: "1.0.6" });

    await vi.waitFor(() => {
      expect(tabsReload).toHaveBeenCalledWith(17);
    });
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 17 },
      func: expect.any(Function),
    }));
  });

  it("carries an update refresh forward when a newer ordinary sync supersedes it", async () => {
    const originPattern = "https://mattermost.example.test/*";
    const {
      installedListeners,
      messageListeners,
      getRegisteredContentScripts,
      executeScript,
      tabsQuery,
    } = await loadBackground(new Map([[
      SETTINGS_KEYS.serverUrl,
      "https://mattermost.example.test/company",
    ]]));
    let releaseUpdateRegistration!: () => void;
    getRegisteredContentScripts
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseUpdateRegistration = () => resolve([
          createDeckContentScript(originPattern),
        ]);
      }))
      .mockResolvedValue([createDeckContentScript(originPattern)]);
    tabsQuery.mockResolvedValue([{ id: 18 }] as chrome.tabs.Tab[]);
    executeScript.mockResolvedValueOnce([
      { result: true },
    ] as chrome.scripting.InjectionResult[]);

    installedListeners[0]?.({ reason: "update", previousVersion: "1.0.6" });
    await vi.waitFor(() => expect(getRegisteredContentScripts).toHaveBeenCalledTimes(1));
    const newerSync = sendBackgroundMessage(messageListeners[0], {
      type: "mattermost-deck:sync-content-script",
    });
    releaseUpdateRegistration();

    await expect(newerSync).resolves.toEqual({ success: true });
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledTimes(2));
    expect(executeScript.mock.calls[1]?.[0]).toEqual({
      target: { tabId: 18 },
      files: ["content.js"],
    });
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

  it("disposes a registered content runtime before reinjecting the updated bundle", async () => {
    const serverUrl = "https://mattermost.example.test";
    const {
      background,
      executeScript,
      tabsQuery,
      tabsReload,
    } = await loadBackground(new Map([[SETTINGS_KEYS.serverUrl, serverUrl]]));
    tabsQuery.mockResolvedValue([{ id: 7 }] as chrome.tabs.Tab[]);
    executeScript
      .mockResolvedValueOnce([{ result: true }] as chrome.scripting.InjectionResult[])
      .mockResolvedValueOnce([{ result: undefined }] as chrome.scripting.InjectionResult[]);

    await background.refreshExistingDeckTabs();

    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript.mock.calls[1]?.[0]).toEqual({
      target: { tabId: 7 },
      files: ["content.js"],
    });
    expect(tabsReload).not.toHaveBeenCalled();
  });

  it("reloads a tab when an older content runtime cannot dispose itself", async () => {
    const serverUrl = "https://mattermost.example.test";
    const {
      background,
      executeScript,
      tabsQuery,
      tabsReload,
    } = await loadBackground(new Map([[SETTINGS_KEYS.serverUrl, serverUrl]]));
    tabsQuery.mockResolvedValue([{ id: 9 }] as chrome.tabs.Tab[]);
    executeScript.mockResolvedValueOnce([
      { result: false },
    ] as chrome.scripting.InjectionResult[]);

    await background.refreshExistingDeckTabs();

    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(tabsReload).toHaveBeenCalledWith(9);
  });

  it("serializes concurrent encryption seed requests and persists one shared seed", async () => {
    const localValues = new Map<string, unknown>();
    const { messageListeners, local } = await loadBackground(localValues);
    const listener = messageListeners[0];
    const request = () => sendBackgroundMessage(listener!, { type: "mattermost-deck:get-encryption-seed" });

    const responses = await Promise.all([request(), request(), request()]) as Array<{ success: boolean; seed: string }>;

    expect(responses.every((response) => response.success)).toBe(true);
    expect(new Set(responses.map((response) => response.seed)).size).toBe(1);
    expect(responses[0]?.seed).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(local.set).toHaveBeenCalledTimes(1);
    expect(localValues.get("mattermost-deck.enc-seed.v1")).toBe(responses[0]?.seed);
  });

  it("returns an existing encryption seed without replacing it", async () => {
    const originalSeed = "cGVyc2lzdGVkLWVuY3J5cHRpb24tc2VlZA==";
    const localValues = new Map<string, unknown>([["mattermost-deck.enc-seed.v1", originalSeed]]);
    const { messageListeners, local } = await loadBackground(localValues);

    await expect(sendBackgroundMessage(messageListeners[0]!, {
      type: "mattermost-deck:get-encryption-seed",
    })).resolves.toEqual({ success: true, seed: originalSeed });
    expect(local.set).not.toHaveBeenCalled();
    expect(localValues.get("mattermost-deck.enc-seed.v1")).toBe(originalSeed);
  });

  it("reports seed persistence failures so callers cannot derive a fallback key", async () => {
    const localValues = new Map<string, unknown>();
    const { messageListeners, local } = await loadBackground(localValues);
    local.set.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(sendBackgroundMessage(messageListeners[0]!, {
      type: "mattermost-deck:get-encryption-seed",
    })).resolves.toEqual({ success: false, error: "storage unavailable" });
    expect(localValues.has("mattermost-deck.enc-seed.v1")).toBe(false);
  });
});
