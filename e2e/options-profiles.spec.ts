import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";

test("options page can create and switch profiles", async () => {
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
        chrome.storage.local.set({ "mattermostDeck.serverUrl.v1": serverUrl }, () => resolve());
      });
    }, baseUrl);

    const extensionId = new URL(sw.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    const profileSelect = page.locator("select.options-input").first();
    await expect(profileSelect).toBeVisible({ timeout: 10_000 });
    await expect(profileSelect.locator("option")).toHaveCount(1);

    const nameInput = page.getByPlaceholder("Ops, Support, Night Shift");
    await nameInput.fill("Night Shift");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(profileSelect.locator("option")).toHaveCount(2);
    await expect(profileSelect.locator("option", { hasText: "Night Shift" })).toBeAttached();

    await profileSelect.selectOption({ label: "Default" });
    await expect(profileSelect).toHaveValue(await profileSelect.locator("option", { hasText: "Default" }).getAttribute("value"));
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
