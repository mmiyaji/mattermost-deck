import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";

async function openProfilesPanel(page: import("@playwright/test").Page) {
  const navButtons = page.locator("nav button");
  await expect(navButtons.nth(2)).toBeVisible({ timeout: 10_000 });
  await navButtons.nth(2).click();
  await expect(page.getByRole("heading", { name: /Profiles|プロファイル/i })).toBeVisible({ timeout: 10_000 });
}

test("options page shows server-scoped profiles", async () => {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-options-"));
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
    await sw.evaluate((serverUrl: string) => {
      return new Promise<void>((resolve) => {
        const profileId = "e2e-default-profile";
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          [`mattermostDeck.serverUrl.v1.profile.${profileId}`]: serverUrl,
          "mattermostDeck.profiles.v1": {
            version: 1,
            profiles: [
              {
                id: profileId,
                name: "Default",
                origin: serverUrl,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
            activeProfileIdByOrigin: {
              [serverUrl]: profileId,
            },
            lastActiveProfileId: profileId,
          },
        }, () => resolve());
      });
    }, baseUrl);

    const extensionId = new URL(sw.url()).host;
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await openProfilesPanel(page);

    const profileSelect = page.locator(".mm-custom-select").first();
    await expect(profileSelect).toBeVisible({ timeout: 10_000 });
    await expect(profileSelect.locator(".mm-custom-select-label")).toContainText("Default");
    await expect(page.locator("main")).toContainText(baseUrl);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
