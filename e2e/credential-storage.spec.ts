import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("a saved PAT decrypts in a new options page and remains cleared after reload", async () => {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-credential-storage-"));
  const extensionPath = path.resolve("dist");
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await waitForInstalledOptions(context, worker);
    await worker.evaluate(async () => {
      const serverUrl = "http://127.0.0.1:8066";
      const id = "credential-profile";
      await chrome.storage.local.set({
        "mattermostDeck.serverUrl.v1": serverUrl,
        "mattermostDeck.wsPat.v1": "old-legacy-test-token",
        "mattermostDeck.persistPat.v1": "true",
        [`mattermostDeck.serverUrl.v1.profile.${id}`]: serverUrl,
        [`mattermostDeck.language.v1.profile.${id}`]: "en",
        "mattermostDeck.profiles.v1": {
          version: 1,
          profiles: [{ id, name: "Credentials", origin: serverUrl, createdAt: 1, updatedAt: 1 }],
          activeProfileIdByOrigin: { [serverUrl]: id }, lastActiveProfileId: id,
        },
      });
    });
    const optionsUrl = `chrome-extension://${new URL(worker.url()).host}/options.html`;
    const page = await context.newPage();
    await page.goto(optionsUrl);
    await page.getByTestId("options-nav-realtime").click();
    const token = page.locator('input[aria-labelledby="pat-label"]');
    await expect(token).toHaveValue("old-legacy-test-token");
    await token.fill("new-test-token");
    await page.locator('button[aria-describedby="options-save-status"]').click();
    await expect.poll(() => worker.evaluate(async () => {
      const key = "mattermostDeck.wsPat.v1.profile.credential-profile";
      return (await chrome.storage.local.get(key))[key];
    })).toMatch(/^enc:v2:/);
    await page.close();

    const freshPage = await context.newPage();
    await freshPage.goto(optionsUrl);
    await freshPage.getByTestId("options-nav-realtime").click();
    const freshToken = freshPage.locator('input[aria-labelledby="pat-label"]');
    await expect(freshToken).toHaveValue("new-test-token");
    await freshToken.fill("");
    await freshPage.locator('button[aria-describedby="options-save-status"]').click();
    await expect.poll(() => worker.evaluate(async () => {
      const key = "mattermostDeck.wsPat.v1.profile.credential-profile";
      return (await chrome.storage.local.get(key))[key] ?? null;
    })).toBeNull();
    await freshPage.reload();
    await freshPage.getByTestId("options-nav-realtime").click();
    await expect(freshToken).toHaveValue("");
  } finally {
    await context.close();
    if (path.dirname(profileDir) === os.tmpdir() && path.basename(profileDir).startsWith("deck-credential-storage-")) {
      await fs.rm(profileDir, { recursive: true, force: true });
    }
  }
});
