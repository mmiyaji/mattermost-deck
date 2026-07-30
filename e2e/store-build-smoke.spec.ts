import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const baseUrlParts = new URL(baseUrl);
const permissionPattern =
  `${baseUrlParts.protocol}//${baseUrlParts.hostname}/*`;
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");

test.skip(
  process.env.STORE_BUILD_SMOKE !== "true",
  "Runs only after STORE_BUILD=true has produced the release candidate.",
);

test("store release candidate starts ungranted and handles native permission denial safely", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const extensionPath = path.resolve(
    process.env.STORE_BUILD_PATH ?? "./dist",
  );
  const packageJson = JSON.parse(
    await fs.readFile(path.resolve("./package.json"), "utf8"),
  ) as { version: string };
  const state = JSON.parse(
    await fs.readFile(stateFile, "utf8"),
  ) as {
    team: { name: string };
    memberUser: { username: string; password: string };
  };
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
    // Headless Chromium cannot render the native optional-host permission
    // dialog and leaves request() pending. Keep the real archive and storage
    // APIs, but replace only that browser-owned boundary with a deterministic
    // denial so the product's safe-denial path is exercised.
    const permissionDenialPatched = await optionsPage.evaluate(() => {
      const replacement = async () => false;
      try {
        chrome.permissions.request = replacement;
        return chrome.permissions.request === replacement;
      } catch {
        return false;
      }
    });
    expect(permissionDenialPatched).toBe(true);
    await expect(optionsPage.locator("nav button").nth(1)).toBeVisible({ timeout: 10_000 });
    await optionsPage.locator("nav button").nth(1).click();
    const serverUrlInput = optionsPage.locator('input[type="url"]');
    await expect(serverUrlInput).toBeVisible({ timeout: 10_000 });
    await serverUrlInput.fill(baseUrl);
    await optionsPage.locator(".options-save-footer .options-button").click();
    const saveStatus = optionsPage.locator("#options-save-status");
    await expect(saveStatus).toHaveAttribute("role", "alert", {
      timeout: 20_000,
    });
    await expect(saveStatus).toHaveAttribute(
      "data-status-code",
      "permission-denied",
      { timeout: 20_000 },
    );
    await expect(saveStatus).toHaveText(
      /Mattermost origin.*Chrome.*権限.*拒否/,
    );

    // Require a safe, visible denial without persisting or injecting.
    await expect
      .poll(
        () => sw.evaluate(async ({ originPattern }) => {
          const [hasPermission, scripts, storage] = await Promise.all([
            chrome.permissions.contains({
              origins: [originPattern],
            }),
            chrome.scripting.getRegisteredContentScripts({
              ids: ["mattermost-deck-content"],
            }),
            chrome.storage.local.get(null),
          ]);
          const persistedServerUrlKeys = Object.keys(storage).filter(
            (key) =>
              key === "mattermostDeck.serverUrl.v1" ||
              key.startsWith("mattermostDeck.serverUrl.v1.profile."),
          );
          return {
            hasPermission,
            registeredScriptCount: scripts.length,
            persistedServerUrlKeys,
          };
        }, { originPattern: permissionPattern }),
        { timeout: 20_000 },
      )
      .toEqual({
        hasPermission: false,
        registeredScriptCount: 0,
        persistedServerUrlKeys: [],
      });

    const mattermostPage = await context.newPage();
    await mattermostPage.goto(`${baseUrl}/landing#/login`);
    const browserChoice = mattermostPage.getByText("View in Browser");
    const loginId = mattermostPage.locator(
      'input[name="loginId"], #input_loginId',
    ).first();
    await Promise.race([
      browserChoice
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => undefined),
      loginId
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => undefined),
    ]);
    if (await browserChoice.isVisible().catch(() => false)) {
      await browserChoice.click();
    }
    await loginId.waitFor({ state: "visible", timeout: 30_000 });
    await loginId.fill(state.memberUser.username);
    await mattermostPage
      .locator('input[name="password-input"], #input_password-input')
      .first()
      .fill(state.memberUser.password);
    await mattermostPage.getByRole("button", { name: /log in/i }).click();
    await mattermostPage.waitForURL(/\/(?:channels|messages)\//, {
      timeout: 30_000,
    });
    await expect(mattermostPage.locator("#mattermost-deck-root")).toHaveCount(0);
    await expect
      .poll(
        () => mattermostPage.evaluate(() =>
          document.body.classList.contains("mattermost-deck-body-offset")
        ),
      )
      .toBe(false);
    await optionsPage.screenshot({
      path: testInfo.outputPath("store-build-options.png"),
      fullPage: true,
    });
    await mattermostPage.screenshot({
      path: testInfo.outputPath("store-build-ungranted-mattermost.png"),
      fullPage: false,
    });
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
