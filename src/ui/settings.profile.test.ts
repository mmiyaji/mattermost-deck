import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEYS, loadDeckSettings, normaliseServerUrl, originToPermissionPattern, saveDeckSettings } from "./settings";
import { createDeckProfile, loadDeckProfiles, switchDeckProfile } from "./profiles";

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
    expect(normaliseServerUrl("http://mattermost.example.test"))
      .toBe("");
  });

  it("rejects Mattermost screen URLs instead of treating them as Site URLs", () => {
    expect(normaliseServerUrl("https://example.test/company/mattermost/team/channels/town-square"))
      .toBe("");
    expect(normaliseServerUrl("https://example.test/company/mattermost/team/pl/post-id"))
      .toBe("");
    expect(normaliseServerUrl("https://example.test/#/team/messages/@alice"))
      .toBe("");
  });

  it("does not strip arbitrary supported deployment subpaths", () => {
    expect(normaliseServerUrl("https://example.test/company/mattermost/tenant-a"))
      .toBe("https://example.test/company/mattermost/tenant-a");
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
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension" },
      storage: {
        local: createStorageArea(localValues),
        session: createStorageArea(sessionValues),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
  });

  it("publishes the active server URL and reloads the last active server profile from Options", async () => {
    const serverUrl = "https://mattermost.example.test/company/mattermost";
    await saveDeckSettings({ ...DEFAULT_SETTINGS, serverUrl, compactMode: true }, serverUrl);

    const stored = await chrome.storage.local.get(null);
    expect(stored[SETTINGS_KEYS.serverUrl]).toBe(serverUrl);
    expect(Object.keys(stored)).toContainEqual(expect.stringMatching(/^mattermostDeck\.serverUrl\.v1\.profile\./));
    await expect(loadDeckSettings()).resolves.toMatchObject({ serverUrl, compactMode: true });
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
