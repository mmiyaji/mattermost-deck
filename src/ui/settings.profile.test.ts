import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  loadDeckSettings,
  normaliseAllowedRouteKinds,
  normaliseServerUrl,
  originToPermissionPattern,
  saveDeckSettings,
  subscribeDeckSettings,
} from "./settings";
import {
  createDeckProfile,
  duplicateDeckProfile,
  deleteDeckProfile,
  getProfileStorageKey,
  loadDeckProfiles,
  PROFILE_SETTINGS_INITIALIZED_KEY,
  PROFILES_STORAGE_KEY,
  switchDeckProfile,
} from "./profiles";
import { PERFORMANCE_DEFAULTS, PERFORMANCE_LIMITS, RESPONSIVE_PERFORMANCE_PRESET, type PerformanceSettings } from "../performanceSettings";

let localValues: Map<string, unknown>;
let sessionValues: Map<string, unknown>;

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
  };
}

describe("server URL normalization", () => {
  it("preserves supported Mattermost subpaths", () => {
    expect(normaliseServerUrl("https://example.test/company/mattermost/"))
      .toBe("https://example.test/company/mattermost");
    expect(originToPermissionPattern("https://example.test/company/mattermost"))
      .toBe("https://example.test/*");
  });

  it("allows loopback HTTP but rejects remote clear-text servers", () => {
    expect(normaliseServerUrl("http://127.0.0.1:8065/mattermost"))
      .toBe("http://127.0.0.1:8065/mattermost");
    expect(originToPermissionPattern("http://127.0.0.1:8065/mattermost"))
      .toBe("http://127.0.0.1/*");
    expect(normaliseServerUrl("http://mattermost.example.test"))
      .toBe("");
  });

  it("omits non-default ports from Chrome host permission patterns", () => {
    expect(originToPermissionPattern("https://example.test:8443/company/mattermost"))
      .toBe("https://example.test/*");
  });

  it("rejects Mattermost screen URLs instead of treating them as Site URLs", () => {
    expect(normaliseServerUrl("https://example.test/company/mattermost/team/channels/town-square"))
      .toBe("");
    expect(normaliseServerUrl("https://example.test/company/mattermost/team/pl/post-id"))
      .toBe("");
    expect(normaliseServerUrl("https://example.test/company/threads"))
      .toBe("https://example.test/company/threads");
    expect(normaliseServerUrl("https://example.test/company/mattermost/team/threads/thread-id"))
      .toBe("");
    expect(normaliseServerUrl("https://example.test/#/team/messages/@alice"))
      .toBe("");
  });

  it("does not strip arbitrary supported deployment subpaths", () => {
    expect(normaliseServerUrl("https://example.test/company/mattermost/tenant-a"))
      .toBe("https://example.test/company/mattermost/tenant-a");
  });
});

describe("allowed Mattermost routes", () => {
  it("keeps the team Threads screen enabled by default without changing explicit route choices", () => {
    expect(DEFAULT_SETTINGS.allowedRouteKinds).toContain("threads");
    expect(normaliseAllowedRouteKinds("channels,threads,unknown"))
      .toBe("channels,threads");
    expect(normaliseAllowedRouteKinds("channels,messages,pl"))
      .toBe("channels,messages,pl");
  });
});

describe("profile-aware settings", () => {
  beforeEach(() => {
    localValues = new Map<string, unknown>();
    sessionValues = new Map<string, unknown>();
    vi.stubGlobal("window", {
      location: { origin: "chrome-extension://test-extension" },
      localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("navigator", {
      language: "fr-FR",
      languages: ["fr-FR"],
    });
    vi.stubGlobal("chrome", {
      i18n: { getUILanguage: () => "de-DE" },
      runtime: { id: "test-extension" },
      storage: {
        local: createStorageArea(localValues),
        session: createStorageArea(sessionValues),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
  });

  it("enables persistent mention caching by default while preserving an explicit opt-out", async () => {
    const origin = "https://mattermost.example.test";
    expect(DEFAULT_SETTINGS.persistMentionCache).toBe(true);
    expect((await loadDeckSettings(origin)).persistMentionCache).toBe(true);
    await saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl: origin, persistMentionCache: false }, origin);
    expect((await loadDeckSettings(origin)).persistMentionCache).toBe(false);
    const copy = await duplicateDeckProfile((await loadDeckProfiles(origin)).activeProfileId);
    expect(copy).not.toBeNull();
    expect((await loadDeckSettings(origin)).persistMentionCache).toBe(false);
  });

  it("persists every performance field locally across restart and profile copy/switch/delete", async () => {
    const origin = "https://mattermost.example.test";
    expect(await loadDeckSettings(origin)).toMatchObject(PERFORMANCE_DEFAULTS);
    const custom = Object.fromEntries(
      (Object.keys(PERFORMANCE_DEFAULTS) as (keyof PerformanceSettings)[])
        .map((key) => [key, PERFORMANCE_LIMITS[key].max]),
    ) as unknown as PerformanceSettings;
    await saveDeckSettings({ ...DEFAULT_SETTINGS, ...custom, serverUrl: origin }, origin);
    const original = (await loadDeckProfiles(origin)).activeProfileId;
    sessionValues.clear();
    vi.resetModules();
    const restartedSettings = await import("./settings");
    expect(await restartedSettings.loadDeckSettings(origin)).toMatchObject(custom);
    for (const key of Object.keys(custom) as (keyof PerformanceSettings)[]) {
      expect(localValues.get(getProfileStorageKey(original, SETTINGS_KEYS[key]))).toBe(String(custom[key]));
    }

    const copy = await duplicateDeckProfile(original);
    expect(copy).not.toBeNull();
    expect(await loadDeckSettings(origin)).toMatchObject(custom);
    await saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl: origin }, origin);
    await switchDeckProfile(original);
    expect(await loadDeckSettings(origin)).toMatchObject(custom);
    await switchDeckProfile(copy!.id);
    expect(await loadDeckSettings(origin)).toMatchObject(PERFORMANCE_DEFAULTS);
    await deleteDeckProfile(copy!.id);
    for (const key of Object.keys(custom) as (keyof PerformanceSettings)[]) {
      expect(localValues.has(getProfileStorageKey(copy!.id, SETTINGS_KEYS[key]))).toBe(false);
    }
  });

  it("copies the responsive preset and cache flag together and removes the copied settings on delete", async () => {
    const origin = "https://mattermost.example.test";
    const responsiveSettings = {
      ...DEFAULT_SETTINGS,
      ...RESPONSIVE_PERFORMANCE_PRESET,
      serverUrl: origin,
      persistMentionCache: true,
    };
    await saveDeckSettings(responsiveSettings, origin);
    const original = (await loadDeckProfiles(origin)).activeProfileId;
    const copy = await duplicateDeckProfile(original);
    expect(copy).not.toBeNull();
    expect(await loadDeckSettings(origin)).toMatchObject({
      ...RESPONSIVE_PERFORMANCE_PRESET,
      persistMentionCache: true,
    });
    const copiedCacheKey = getProfileStorageKey(copy!.id, SETTINGS_KEYS.persistMentionCache);
    expect(localValues.get(copiedCacheKey)).toBe("true");

    expect((await deleteDeckProfile(copy!.id)).deleted).toBe(true);
    expect(localValues.has(copiedCacheKey)).toBe(false);
    for (const field of Object.keys(RESPONSIVE_PERFORMANCE_PRESET) as (keyof PerformanceSettings)[]) {
      expect(localValues.has(getProfileStorageKey(copy!.id, SETTINGS_KEYS[field]))).toBe(false);
    }
    expect(await loadDeckSettings(origin)).toMatchObject({
      ...RESPONSIVE_PERFORMANCE_PRESET,
      persistMentionCache: true,
    });
    expect(localValues.get(getProfileStorageKey(original, SETTINGS_KEYS.persistMentionCache))).toBe("true");
  });

  it("clamps every performance field on save and falls back for malformed stored values", async () => {
    const origin = "https://mattermost.example.test";
    const keys = Object.keys(PERFORMANCE_DEFAULTS) as (keyof PerformanceSettings)[];
    for (const edge of ["min", "max"] as const) {
      const input = Object.fromEntries(keys.map((key) => [key, edge === "min" ? -100 : 100000]));
      await saveDeckSettings({ ...DEFAULT_SETTINGS, ...input, serverUrl: origin }, origin);
      const loaded = await loadDeckSettings(origin);
      for (const key of keys) expect(loaded[key]).toBe(PERFORMANCE_LIMITS[key][edge]);
    }
    const { activeProfileId } = await loadDeckProfiles(origin);
    for (const key of keys) localValues.set(getProfileStorageKey(activeProfileId, SETTINGS_KEYS[key]), "invalid");
    expect(await loadDeckSettings(origin)).toMatchObject(PERFORMANCE_DEFAULTS);
  });

  it("reloads subscriptions for a profile-scoped performance change", async () => {
    const origin = "https://mattermost.example.test";
    await saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl: origin }, origin);
    const { activeProfileId } = await loadDeckProfiles(origin);
    const listener = vi.fn();
    const unsubscribe = subscribeDeckSettings(listener);
    const handleChange = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
    const key = getProfileStorageKey(activeProfileId, SETTINGS_KEYS.apiMaxConcurrentRequests);
    localValues.set(key, "6");
    handleChange({ [key]: { oldValue: "3", newValue: "6" } }, "local");
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(expect.objectContaining({ apiMaxConcurrentRequests: 6 })));
    unsubscribe();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(handleChange);
  });

  it("defaults new font settings to 95 percent and preserves saved legacy and profile values", async () => {
    const origin = "https://mattermost.example.test";
    expect((await loadDeckSettings(origin)).fontScalePercent).toBe(95);

    localValues.set(SETTINGS_KEYS.fontScalePercent, "100");
    expect((await loadDeckSettings(origin)).fontScalePercent).toBe(100);

    for (const fontScalePercent of [90, 100, 120]) {
      await saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl: origin, fontScalePercent }, origin);
      expect((await loadDeckSettings(origin)).fontScalePercent).toBe(fontScalePercent);
    }
  });

  it("distinguishes the generated default profile from a user profile with the same name", async () => {
    const serverUrl = "https://mattermost.example.test";
    const generated = (await loadDeckProfiles(serverUrl)).profiles[0];
    const userCreated = await createDeckProfile("Default", serverUrl);

    expect(generated).toMatchObject({
      name: "Default",
      isBuiltInDefault: true,
    });
    expect(userCreated).toMatchObject({
      name: "Default",
      isBuiltInDefault: false,
    });

    const reloaded = await loadDeckProfiles(serverUrl);
    expect(reloaded.profiles.find((profile) => profile.id === generated.id)?.isBuiltInDefault).toBe(true);
    expect(reloaded.profiles.find((profile) => profile.id === userCreated.id)?.isBuiltInDefault).toBe(false);
  });

  it("does not translate a user-created Default profile after a legacy default was renamed", async () => {
    const origin = "https://mattermost.example.test";
    localValues.set(PROFILES_STORAGE_KEY, {
      version: 1,
      profiles: [
        {
          id: "renamed-built-in",
          name: "Work",
          origin,
          createdAt: 100,
          updatedAt: 300,
        },
        {
          id: "user-default",
          name: "Default",
          origin,
          createdAt: 200,
          updatedAt: 200,
        },
      ],
      activeProfileIdByOrigin: { [origin]: "renamed-built-in" },
      lastActiveProfileId: "renamed-built-in",
    });

    const registry = await loadDeckProfiles(origin);
    expect(registry.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "renamed-built-in", isBuiltInDefault: false }),
      expect.objectContaining({ id: "user-default", isBuiltInDefault: false }),
    ]));
  });

  it("publishes the active server URL and reloads the last active server profile from Options", async () => {
    const serverUrl = "https://mattermost.example.test/company/mattermost";
    await saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl, compactMode: true }, serverUrl);

    const stored = await chrome.storage.local.get(null);
    expect(stored[SETTINGS_KEYS.serverUrl]).toBe(serverUrl);
    expect(Object.keys(stored)).toContainEqual(expect.stringMatching(/^mattermostDeck\.serverUrl\.v1\.profile\./));
    await expect(loadDeckSettings()).resolves.toMatchObject({ serverUrl, compactMode: true });
  });

  it.each([
    ["persistent", "local", true],
    ["session-only", "session", false],
  ] as const)("keeps a cleared migrated %s PAT empty", async (_kind, area, persistPat) => {
    const origin = "https://mattermost.example.test";
    (area === "local" ? localValues : sessionValues).set(SETTINGS_KEYS.wsPat, "legacy-secret-token");
    localValues.set(SETTINGS_KEYS.persistPat, persistPat ? "true" : "false");

    const migrated = await loadDeckSettings(origin);
    expect(migrated.wsPat).toBe("legacy-secret-token");
    await saveDeckSettings({ ...migrated, serverUrl: origin, wsPat: "" }, origin);

    await expect(loadDeckSettings(origin)).resolves.toMatchObject({ wsPat: "", persistPat });
    const { activeProfileId } = await loadDeckProfiles(origin);
    expect(localValues.get(getProfileStorageKey(activeProfileId, PROFILE_SETTINGS_INITIALIZED_KEY))).toBe("true");
  });

  it("keeps cleared team and keyword values empty after migrating legacy text settings", async () => {
    const origin = "https://mattermost.example.test";
    localValues.set(SETTINGS_KEYS.teamSlug, "old-team");
    localValues.set(SETTINGS_KEYS.highlightKeywords, "old keyword");

    const migrated = await loadDeckSettings(origin);
    expect(migrated).toMatchObject({ teamSlug: "old-team", highlightKeywords: "old keyword" });
    await saveDeckSettings({ ...migrated, serverUrl: origin, teamSlug: "", highlightKeywords: "" }, origin);

    await expect(loadDeckSettings(origin)).resolves.toMatchObject({ teamSlug: "", highlightKeywords: "" });
  });

  it("does not fall back to a known legacy PAT on another server", async () => {
    localValues.set(SETTINGS_KEYS.serverUrl, "https://legacy.example.test");
    localValues.set(SETTINGS_KEYS.wsPat, "legacy-secret-token");
    localValues.set(SETTINGS_KEYS.persistPat, "true");

    await expect(loadDeckSettings("https://new.example.test")).resolves.toMatchObject({ wsPat: "" });
  });

  it("does not write profile settings when session credential storage fails", async () => {
    const origin = "https://mattermost.example.test";
    const { activeProfileId } = await loadDeckProfiles(origin);
    vi.mocked(chrome.storage.session.remove).mockRejectedValueOnce(new Error("session unavailable"));

    await expect(saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl: origin }, origin)).rejects.toThrow("session unavailable");
    expect(localValues.has(getProfileStorageKey(activeProfileId, PROFILE_SETTINGS_INITIALIZED_KEY))).toBe(false);
  });

  it("makes the last explicitly saved connection profile authoritative after A/B/A", async () => {
    const urls = ["https://a.example.test", "https://b.example.test", "https://a.example.test"];

    for (const serverUrl of urls) {
      await saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl }, serverUrl);
    }

    const registry = localValues.get(PROFILES_STORAGE_KEY) as {
      profiles: Array<{ id: string; origin: string }>;
      lastActiveProfileId: string;
    };
    const lastActive = registry.profiles.find((profile) => profile.id === registry.lastActiveProfileId);
    expect(lastActive?.origin).toBe("https://a.example.test");
    expect(localValues.get(getProfileStorageKey(lastActive!.id, SETTINGS_KEYS.serverUrl))).toBe("https://a.example.test");
    expect(localValues.get(SETTINGS_KEYS.serverUrl)).toBe("https://a.example.test");
  });

  it("uses the Chrome UI language for empty storage before navigator language", async () => {
    await expect(loadDeckSettings()).resolves.toMatchObject({
      language: "de",
    });
  });

  it("enables thread layout adjustment by default and persists an opt-out per profile", async () => {
    await expect(loadDeckSettings()).resolves.toMatchObject({
      autoAdjustThreadLayout: true,
    });

    const serverUrl = "https://mattermost.example.test/company/mattermost";
    await saveDeckSettings({
      ...DEFAULT_SETTINGS,
      serverUrl,
      autoAdjustThreadLayout: false,
    }, serverUrl);

    const stored = await chrome.storage.local.get(null);
    const scopedKey = Object.keys(stored).find((key) => (
      key.startsWith(`${SETTINGS_KEYS.autoAdjustThreadLayout}.profile.`)
    ));
    expect(scopedKey).toBeDefined();
    expect(stored[scopedKey!]).toBe("false");
    await expect(loadDeckSettings()).resolves.toMatchObject({
      autoAdjustThreadLayout: false,
    });
  });

  it("migrates the former default routes once for the active profile", async () => {
    const { activeProfileId } = await loadDeckProfiles();
    const allowedRouteKindsKey = getProfileStorageKey(
      activeProfileId,
      SETTINGS_KEYS.allowedRouteKinds,
    );
    const migrationMarkerKey = getProfileStorageKey(
      activeProfileId,
      SETTINGS_KEYS.allowedRouteKindsThreadsMigration,
    );
    localValues.set(allowedRouteKindsKey, "channels,messages,pl");

    await expect(loadDeckSettings()).resolves.toMatchObject({
      allowedRouteKinds: "channels,messages,pl,threads",
    });
    expect(localValues.get(allowedRouteKindsKey)).toBe("channels,messages,pl,threads");
    expect(localValues.get(migrationMarkerKey)).toBe("true");

    localValues.set(allowedRouteKindsKey, "channels,messages,pl");
    await expect(loadDeckSettings()).resolves.toMatchObject({
      allowedRouteKinds: "channels,messages,pl",
    });
  });

  it("marks an explicit three-route save as migrated and keeps Threads disabled", async () => {
    const serverUrl = "https://mattermost.example.test/company/mattermost";
    await saveDeckSettings({
      ...DEFAULT_SETTINGS,
      serverUrl,
      allowedRouteKinds: "channels,messages,pl",
    }, serverUrl);

    const { activeProfileId } = await loadDeckProfiles(serverUrl);
    const allowedRouteKindsKey = getProfileStorageKey(
      activeProfileId,
      SETTINGS_KEYS.allowedRouteKinds,
    );
    const migrationMarkerKey = getProfileStorageKey(
      activeProfileId,
      SETTINGS_KEYS.allowedRouteKindsThreadsMigration,
    );
    expect(localValues.get(allowedRouteKindsKey)).toBe("channels,messages,pl");
    expect(localValues.get(migrationMarkerKey)).toBe("true");
    await expect(loadDeckSettings(serverUrl)).resolves.toMatchObject({
      allowedRouteKinds: "channels,messages,pl",
    });
  });

  it("mirrors the selected profile URL when profiles use different subpaths on one origin", async () => {
    const firstServerUrl = "https://mattermost.example.test/company/one";
    const secondServerUrl = "https://mattermost.example.test/company/two";

    await saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl: firstServerUrl }, firstServerUrl);
    const firstProfile = (await loadDeckProfiles(firstServerUrl)).profiles[0];
    const secondProfile = await createDeckProfile("Second", firstServerUrl);
    await switchDeckProfile(secondProfile.id);
    await saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl: secondServerUrl }, firstServerUrl);

    await switchDeckProfile(firstProfile.id);
    expect(localValues.get(SETTINGS_KEYS.serverUrl)).toBe(firstServerUrl);

    await switchDeckProfile(secondProfile.id);
    expect(localValues.get(SETTINGS_KEYS.serverUrl)).toBe(secondServerUrl);
    await expect(loadDeckSettings(firstServerUrl)).resolves.toMatchObject({ serverUrl: secondServerUrl });
  });
});
