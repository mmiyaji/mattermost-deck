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
    // The extension opens Options on first install. Use a dedicated page so
    // that automatic navigation cannot race this test's explicit goto.
    const page = await context.newPage();
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

test("official website resources stay reachable on wide and narrow settings layouts", async ({}, testInfo) => {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-options-website-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1_280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await sw.evaluate(() => new Promise<void>((resolve) => {
      chrome.storage.local.set({
        "mattermostDeck.language.v1": "ja",
      }, () => resolve());
    }));

    const extensionId = new URL(sw.url()).host;
    const manifestHomepage = await sw.evaluate(
      () => chrome.runtime.getManifest().homepage_url,
    );
    expect(manifestHomepage).toBe("https://mattermost-deck.ruhenheim.org/");
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator(".options-nav-item").first().click();

    const websiteUrl = "https://mattermost-deck.ruhenheim.org/";
    const websiteCta = page.locator(".options-website-link");
    await expect(websiteCta).toBeVisible({ timeout: 10_000 });
    await expect(websiteCta).toHaveAttribute("href", websiteUrl);
    await expect(websiteCta).toHaveAttribute("target", "_blank");
    await expect(websiteCta).toHaveAttribute("rel", /noopener/);
    await expect(websiteCta).toHaveAttribute("rel", /noreferrer/);

    const sidebarLinks = page.locator(".options-sidebar-footer a");
    await expect(sidebarLinks.filter({ hasText: "公式サイト" })).toHaveAttribute("href", websiteUrl);
    await expect(sidebarLinks.filter({ hasText: "プライバシーポリシー" })).toHaveAttribute(
      "href",
      `${websiteUrl}privacy/`,
    );
    await expect(sidebarLinks.filter({ hasText: "利用規約" })).toHaveAttribute(
      "href",
      `${websiteUrl}terms/`,
    );

    let websiteFocusedFromKeyboard = false;
    for (let index = 0; index < 24; index += 1) {
      await page.keyboard.press("Tab");
      websiteFocusedFromKeyboard = await page.evaluate(
        () => document.activeElement?.classList.contains("options-website-link") ?? false,
      );
      if (websiteFocusedFromKeyboard) {
        break;
      }
    }
    expect(websiteFocusedFromKeyboard).toBe(true);
    const focusStyle = await websiteCta.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(focusStyle.outlineWidth).not.toBe("0px");
    await page.screenshot({
      path: testInfo.outputPath("options-official-website-wide.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 480, height: 800 });
    await expect(websiteCta).toBeVisible();
    const narrowLayout = await page.evaluate(() => {
      const cta = document.querySelector<HTMLElement>(".options-website-link")!;
      const rect = cta.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(narrowLayout.left).toBeGreaterThanOrEqual(0);
    expect(narrowLayout.right).toBeLessThanOrEqual(narrowLayout.viewportWidth);
    expect(narrowLayout.pageScrollWidth).toBeLessThanOrEqual(narrowLayout.clientWidth);
    await page.screenshot({
      path: testInfo.outputPath("options-official-website-narrow.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test("1.0.3 release notice stays aligned, wraps actions, and explains the performance release", async () => {
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
            version: "1.0.3",
            previousVersion: "1.0.2",
            seen: false,
          },
        }, () => resolve());
      });
    });

    const extensionId = new URL(sw.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    const releaseBanner = page.locator(".options-release-banner");
    await expect(releaseBanner).toBeVisible({ timeout: 10_000 });
    await expect(releaseBanner).toContainText("v1.0.3");
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

    await releaseBanner.getByRole("button", { name: "新機能" }).click();
    const releaseDialog = page.getByRole("dialog", { name: "v1.0.3" });
    await expect(releaseDialog).toBeVisible();
    await expect(releaseDialog.locator(".options-modal-section")).toHaveCount(3);
    await expect(releaseDialog).toContainText("Mattermost右ペインの実測幅");
    await expect(releaseDialog).toContainText("User Timing蓄積");
    await expect(releaseDialog).toContainText("20分メモリ耐久テスト");
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
    const page = await context.newPage();
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
