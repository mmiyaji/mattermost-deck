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

test("release notice banner stays aligned and wraps actions on narrow screens", async () => {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-release-banner-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 640, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await sw.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.language.v1": "ja",
          "mattermostDeck.releaseNotice.v1": {
            version: "0.2.6",
            previousVersion: "0.2.5",
            seen: false,
          },
        }, () => resolve());
      });
    });

    const extensionId = new URL(sw.url()).host;
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    const releaseBanner = page.locator(".options-release-banner");
    await expect(releaseBanner).toBeVisible({ timeout: 10_000 });
    await expect(releaseBanner.locator(".options-release-banner-actions .options-button")).toHaveCount(3);

    const narrowLayout = await page.evaluate(() => {
      const banner = document.querySelector<HTMLElement>(".options-release-banner")!;
      const body = document.querySelector<HTMLElement>(".options-release-banner-body")!;
      const actions = document.querySelector<HTMLElement>(".options-release-banner-actions")!;
      const panel = document.querySelector<HTMLElement>(".options-panel")!;
      const buttons = Array.from(actions.querySelectorAll<HTMLElement>(".options-button"));
      const bannerRect = banner.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      return {
        alignedLeft: Math.abs(bannerRect.left - (panelRect.left + 16)) <= 1,
        actionsBelowBody: actionsRect.top >= bodyRect.bottom,
        noHorizontalOverflow: banner.scrollWidth <= banner.clientWidth,
        buttonsContained: buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left >= bannerRect.left && rect.right <= bannerRect.right;
        }),
        buttonHeights: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      };
    });

    expect(narrowLayout).toEqual({
      alignedLeft: true,
      actionsBelowBody: true,
      noHorizontalOverflow: true,
      buttonsContained: true,
      buttonHeights: [36, 36, 36],
    });

    await page.setViewportSize({ width: 1_280, height: 800 });
    const wideLayout = await page.evaluate(() => {
      const banner = document.querySelector<HTMLElement>(".options-release-banner")!;
      const actions = document.querySelector<HTMLElement>(".options-release-banner-actions")!;
      const panel = document.querySelector<HTMLElement>(".options-panel")!;
      const bannerRect = banner.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      return {
        alignedLeft: Math.abs(bannerRect.left - (panelRect.left + 32)) <= 1,
        alignedRight: Math.abs(bannerRect.right - (panelRect.right - 32)) <= 1,
        actionsContained: actionsRect.right <= bannerRect.right,
        noHorizontalOverflow: banner.scrollWidth <= banner.clientWidth,
      };
    });

    expect(wideLayout).toEqual({
      alignedLeft: true,
      alignedRight: true,
      actionsContained: true,
      noHorizontalOverflow: true,
    });
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test("narrow navigation stays accessible and PWA launch failures remain visible", async () => {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-options-a11y-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 640, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await sw.evaluate(() => new Promise<void>((resolve) => {
      chrome.storage.local.clear(() => {
        chrome.storage.local.set({ "mattermostDeck.language.v1": "ja" }, () => resolve());
      });
    }));

    const extensionId = new URL(sw.url()).host;
    const page = context.pages()[0] ?? await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(chrome.permissions, "request", {
        configurable: true,
        value: async () => true,
      });
    });
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    const navItems = page.locator(".options-nav-item");
    await expect(navItems).toHaveCount(8);
    const navAccessibility = await navItems.evaluateAll((items) => items.map((item) => ({
      label: item.getAttribute("aria-label"),
      current: item.getAttribute("aria-current"),
    })));
    expect(navAccessibility.every(({ label }) => Boolean(label?.trim()))).toBe(true);
    expect(navAccessibility.filter(({ current }) => current === "page")).toHaveLength(1);

    const serverUrlInput = page.locator('input[type="url"]');
    await serverUrlInput.fill(baseUrl);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const installBanner = page.locator(".options-install-banner");
    await expect(installBanner).toBeVisible({ timeout: 10_000 });

    // Keep the banner open but make the launch request invalid so the real
    // background response exercises the in-page failure path.
    await serverUrlInput.fill("not-a-valid-url");
    await installBanner.getByRole("button", { name: "インストール", exact: true }).click();
    await expect(installBanner.getByRole("alert")).toHaveText(
      "インストール用の Mattermost を開けませんでした。Server URL を確認して、もう一度お試しください。",
    );
    await expect(installBanner).toBeVisible();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
