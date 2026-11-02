import { beforeEach, describe, expect, it, vi } from "vitest";

const seed = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

function installChrome(sendMessage: ReturnType<typeof vi.fn>) {
  const values = new Map<string, unknown>();
  const local = {
    get: vi.fn(async (key: string) => values.has(key) ? { [key]: values.get(key) } : {}),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) values.delete(key);
    }),
  } as unknown as chrome.storage.StorageArea;

  vi.stubGlobal("chrome", {
    runtime: { id: "test-extension-id", sendMessage },
    storage: { local },
  });
  return { local, values };
}

describe("encrypted storage seed coordination", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses the background seed across independently loaded storage clients", async () => {
    const sendMessage = vi.fn(async () => ({ success: true, seed }));
    const { local, values } = installChrome(sendMessage);

    const clientOne = await import("./storage");
    vi.resetModules();
    const clientTwo = await import("./storage");

    await Promise.all([
      clientOne.saveStoredEncryptedString("secret.one", "first client secret"),
      clientTwo.saveStoredEncryptedString("secret.two", "second client secret"),
    ]);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith({ type: "mattermost-deck:get-encryption-seed" });
    expect(values.get("secret.one")).toMatch(/^enc:v2:/);
    expect(values.get("secret.two")).toMatch(/^enc:v2:/);

    await expect(clientTwo.loadStoredEncryptedString("secret.one")).resolves.toBe("first client secret");
    await expect(clientOne.loadStoredEncryptedString("secret.two")).resolves.toBe("second client secret");
    expect(local.set).toHaveBeenCalledTimes(2);

    vi.resetModules();
    const restartedClient = await import("./storage");
    await expect(restartedClient.loadStoredEncryptedString("secret.one")).resolves.toBe("first client secret");
    await expect(restartedClient.loadStoredEncryptedString("secret.two")).resolves.toBe("second client secret");
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it("rejects encrypted persistence failures without writing a page copy", async () => {
    const { local } = installChrome(vi.fn(async () => ({ success: true, seed })));
    const page = { setItem: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal("window", { localStorage: page });
    const storage = await import("./storage");
    await storage.saveStoredEncryptedString("secret", "previous");
    vi.mocked(local.set).mockRejectedValueOnce(new Error("quota"));
    await expect(storage.saveStoredEncryptedString("secret", "replacement")).rejects.toThrow("quota");
    expect(await storage.loadStoredEncryptedString("secret")).toBe("previous");
    vi.mocked(local.get).mockRejectedValueOnce(new Error("context invalidated"));
    await expect(storage.loadStoredEncryptedString("secret")).rejects.toThrow("context invalidated");
    expect(page.setItem).not.toHaveBeenCalled();
    expect(page.getItem).not.toHaveBeenCalled();
  });

  it("rejects encryption when the background cannot provide a persisted seed", async () => {
    const sendMessage = vi.fn(async () => ({ success: false, error: "storage unavailable" }));
    const { local, values } = installChrome(sendMessage);
    const storage = await import("./storage");

    await expect(storage.encodeStoredEncryptedString("must not use an ephemeral key"))
      .rejects.toThrow("storage unavailable");
    expect(local.set).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });

  it("shares one failed initialization among concurrent calls and retries on the next save", async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error("temporary background failure"))
      .mockResolvedValue({ success: true, seed });
    const { values } = installChrome(sendMessage);
    const storage = await import("./storage");

    const concurrentAttempts = [
      storage.encodeStoredEncryptedString("first concurrent value"),
      storage.encodeStoredEncryptedString("second concurrent value"),
    ];
    await expect(Promise.all(concurrentAttempts)).rejects.toThrow("temporary background failure");
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await storage.saveStoredEncryptedString("secret.after-retry", "saved after retry");
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(values.get("secret.after-retry")).toMatch(/^enc:v2:/);
    await expect(storage.loadStoredEncryptedString("secret.after-retry")).resolves.toBe("saved after retry");
  });
});
