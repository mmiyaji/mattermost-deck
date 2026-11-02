import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("settings load failure stays unsavable and retries without saving defaults", async () => {
  const extensionPath = path.resolve("dist");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-options-storage-failure-"));
  const context = await chromium.launchPersistentContext(directory, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await waitForInstalledOptions(context, worker);
    await page.addInitScript(() => {
      const state = window as unknown as { failSettingsRead: boolean; settingsWrites: number };
      state.failSettingsRead = true;
      state.settingsWrites = 0;
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      const set = chrome.storage.local.set.bind(chrome.storage.local);
      Object.defineProperty(chrome.storage.local, "get", { configurable: true,
        value: async (...args: Parameters<typeof get>) => {
          if (state.failSettingsRead) throw new Error("storage read unavailable");
          return get(...args);
        } });
      Object.defineProperty(chrome.storage.local, "set", { configurable: true,
        value: async (...args: Parameters<typeof set>) => {
          state.settingsWrites++;
          return set(...args);
        } });
    });
    await page.reload();
    await expect(page.getByTestId("options-load-error")).toBeVisible();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "false");
    await expect(page.getByTestId("options-save")).toBeDisabled();
    expect(await page.evaluate(() => (window as unknown as { settingsWrites: number }).settingsWrites)).toBe(0);
    await page.getByTestId("options-nav-performance").click();
    await expect(page.getByTestId("options-load-error")).toBeVisible();
    await page.evaluate(() => { (window as unknown as { failSettingsRead: boolean }).failSettingsRead = false; });
    await page.getByTestId("options-load-error").getByRole("button").click();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await expect(page.getByTestId("options-load-error")).toHaveCount(0);
    await expect(page.getByTestId("options-save")).toBeDisabled();
  } finally {
    await context.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
