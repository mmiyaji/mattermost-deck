import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("1.4.0 package exposes the current localized release notes in all supported languages", async ({}, info) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-release140-"));
  const extension = path.resolve(process.env.STORE_BUILD_PATH ?? "dist");
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    viewport: { width: 900, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await waitForInstalledOptions(context, worker);
    expect(await worker.evaluate(() => chrome.runtime.getManifest().version)).toBe("1.4.0");
    for (const language of ["ja", "en", "de", "es", "fr", "ko", "ru", "uk", "zh-CN"]) {
      const resource = JSON.parse(await fs.readFile(path.resolve(`src/ui/locales/${language}.json`), "utf8"));
      await worker.evaluate(language => chrome.storage.local.set({ "mattermostDeck.language.v1": language,
        "mattermostDeck.releaseNotice.v1": { version: "1.4.0", previousVersion: "1.3.3", seen: false } }), language);
      await page.goto(new URL("options.html", worker.url()).href);
      await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
      await expect(page.locator(".options-version")).toContainText("1.4.0");
      const banner = page.locator(".options-release-banner");
      await banner.locator(".options-release-banner-actions button").first().click();
      const dialog = page.getByRole("dialog", { name: "v1.4.0" });
      await expect(dialog).toBeVisible();
      for (const key of ["releaseNote140Settings", "releaseNote140Performance", "releaseNote140Cache", "releaseNote140Mentions"]) {
        await expect(dialog).toContainText(resource.options[key]);
      }
      if (language === "ja") await page.screenshot({ path: info.outputPath("release140-ja.png"), animations: "disabled" });
    }
  } finally { await context.close(); await fs.rm(profile, { recursive: true, force: true }); }
});
