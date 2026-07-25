import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test.skip(
  process.env.STORE_BUILD_SMOKE !== "true",
  "Runs only after STORE_BUILD=true has produced the release candidate.",
);

test("store build loads without pre-granted host access", async ({}, testInfo) => {
  test.setTimeout(60_000);
  const extensionPath = path.resolve("./dist");
  const packageJson = JSON.parse(
    await fs.readFile(path.resolve("./package.json"), "utf8"),
  ) as { version: string };
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-store-smoke-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const extensionId = new URL(sw.url()).host;
    const packageState = await sw.evaluate(async () => {
      const manifest = chrome.runtime.getManifest();
      const [hasLocalhostPermission, scripts] = await Promise.all([
        chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] }),
        chrome.scripting.getRegisteredContentScripts({ ids: ["mattermost-deck-content"] }),
      ]);
      return {
        version: manifest.version,
        homepageUrl: manifest.homepage_url,
        hasLocalhostPermission,
        registeredScriptCount: scripts.length,
      };
    });

    expect(packageState).toEqual({
      version: packageJson.version,
      homepageUrl: "https://mattermost-deck.ruhenheim.org/",
      hasLocalhostPermission: false,
      registeredScriptCount: 0,
    });

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(optionsPage.locator(".options-app")).toBeVisible({ timeout: 10_000 });
    await expect(optionsPage.locator("nav button").nth(1)).toBeVisible({ timeout: 10_000 });
    await optionsPage.locator("nav button").nth(1).click();
    await expect(optionsPage.locator('input[type="url"]')).toBeVisible({ timeout: 10_000 });
    await optionsPage.screenshot({
      path: testInfo.outputPath("store-build-options.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
