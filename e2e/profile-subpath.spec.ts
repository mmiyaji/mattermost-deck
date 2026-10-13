import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

for (const action of ["create", "duplicate"] as const) {
  test(`${action} profile preserves the saved deployment path despite an unsaved URL edit`, async () => {
    const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-profile-subpath-"));
    const extensionPath = path.resolve("dist");
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      await waitForInstalledOptions(context, worker);
      const savedUrl = "https://example.test/company/mattermost";
      await worker.evaluate(async (serverUrl) => {
        const origin = new URL(serverUrl).origin;
        const id = "subpath-source";
        await chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          [`mattermostDeck.serverUrl.v1.profile.${id}`]: serverUrl,
          [`mattermostDeck.language.v1.profile.${id}`]: "en",
          "mattermostDeck.profiles.v1": {
            version: 1,
            profiles: [{ id, name: "Source", origin, createdAt: 1, updatedAt: 1 }],
            activeProfileIdByOrigin: { [origin]: id }, lastActiveProfileId: id,
          },
        });
      }, savedUrl);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
      const urlInput = page.locator('input[type="url"]');
      await expect(urlInput).toHaveValue(savedUrl);
      await urlInput.fill("https://unsaved.example.test/other");
      await page.getByTestId("options-nav-profiles").click();
      if (action === "create") {
        await page.locator('input[aria-labelledby="create-profile-label"]').fill("New profile");
        await page.getByRole("button", { name: "Create", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "Duplicate", exact: true }).click();
      }
      await expect.poll(() => worker.evaluate(async () => {
        const data = await chrome.storage.local.get("mattermostDeck.profiles.v1");
        return data["mattermostDeck.profiles.v1"].lastActiveProfileId;
      })).not.toBe("subpath-source");
      await page.getByTestId("options-nav-conn").click();
      await expect(urlInput).toHaveValue(savedUrl);
      await page.reload();
      await expect(urlInput).toHaveValue(savedUrl);
      const storedUrl = await worker.evaluate(async () => {
        const data = await chrome.storage.local.get("mattermostDeck.profiles.v1");
        const id = data["mattermostDeck.profiles.v1"].lastActiveProfileId;
        const key = `mattermostDeck.serverUrl.v1.profile.${id}`;
        return (await chrome.storage.local.get(key))[key];
      });
      expect(storedUrl).toBe(savedUrl);
    } finally {
      await context.close();
      // Only remove the exact temporary directory created by this test.
      if (path.dirname(profileDir) === os.tmpdir() && path.basename(profileDir).startsWith("deck-profile-subpath-")) {
        await fs.rm(profileDir, { recursive: true, force: true });
      }
    }
  });
}
