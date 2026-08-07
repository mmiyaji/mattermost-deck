import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type OptionsFixture = {
  context: BrowserContext;
  page: Page;
  userDataDir: string;
};

async function openOptions(): Promise<OptionsFixture> {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-options-a11y-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const serviceWorker = context.serviceWorkers()[0]
    ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.set({
      "mattermostDeck.language.v1": "en",
      "mattermostDeck.traceEntries.v1": [
        {
          timestamp: Date.now(),
          source: "api",
          level: "info",
          event: "request.complete",
          payload: {
            method: "GET",
            path: "/users/me/teams",
            fullPath: "/api/v4/users/me/teams",
            purpose: "Joined teams",
            status: 200,
            durationMs: 42,
            queueWaitMs: 3,
            failed: false,
          },
        },
      ],
    });
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as typeof window & { __optionsInvalidBeforeLoaded?: boolean }).__optionsInvalidBeforeLoaded = false;
    const observer = new MutationObserver(() => {
      const saveButton = document.querySelector<HTMLButtonElement>(".options-save-footer .options-button");
      const invalidInput = document.querySelector('[aria-invalid="true"]');
      if (saveButton?.disabled && invalidInput) {
        (window as typeof window & { __optionsInvalidBeforeLoaded?: boolean }).__optionsInvalidBeforeLoaded = true;
      }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  });
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator(".options-save-footer .options-button")).toBeEnabled({
    timeout: 10_000,
  });
  return { context, page, userDataDir };
}

async function closeOptions(fixture: OptionsFixture): Promise<void> {
  await fixture.context.close();
  await fs.rm(fixture.userDataDir, { recursive: true, force: true });
}

test("settings controls expose stable labels, errors, and combobox semantics", async () => {
  const fixture = await openOptions();
  const { page } = fixture;

  try {
    expect(await page.evaluate(
      () => (window as typeof window & { __optionsInvalidBeforeLoaded?: boolean }).__optionsInvalidBeforeLoaded,
    )).toBe(false);
    await expect(page.locator("label label")).toHaveCount(0);

    await page.getByTestId("options-nav-appearance").click();
    const themeCombobox = page.locator('[aria-labelledby="theme-label"][role="combobox"]');
    await expect(themeCombobox).toHaveAttribute("aria-expanded", "false");
    await themeCombobox.click();

    const listbox = page.getByRole("listbox");
    const searchbox = page.getByRole("searchbox");
    await expect(listbox).toBeVisible();
    await expect(searchbox).toBeFocused();
    await expect(listbox.getByRole("option", { selected: true })).toHaveCount(1);

    await searchbox.press("ArrowDown");
    const activeDescendant = await searchbox.getAttribute("aria-activedescendant");
    expect(activeDescendant).toBeTruthy();
    await expect(page.locator(`#${activeDescendant}`)).toHaveAttribute("role", "option");
    await searchbox.press("Escape");
    await expect(themeCombobox).toBeFocused();
    await expect(themeCombobox).toHaveAttribute("aria-expanded", "false");
    await themeCombobox.click();
    const reopenedSearchbox = page.getByRole("searchbox");
    await reopenedSearchbox.press("ArrowDown");
    await reopenedSearchbox.press("Enter");
    await expect(themeCombobox).toBeFocused();
    await expect(themeCombobox).toHaveAttribute("aria-expanded", "false");

    await page.getByTestId("options-nav-conn").click();
    const serverUrl = page.locator("#mattermost-server-url");
    await serverUrl.fill("not-a-mattermost-url");
    await page.locator(".options-save-footer .options-button").click();
    await expect(page.locator("#options-save-status")).toHaveAttribute("role", "alert");
    await expect(serverUrl).toHaveAttribute("aria-invalid", "true");
    const errorId = await serverUrl.getAttribute("aria-describedby");
    expect(errorId).toBe("mattermost-server-url-error");
    await expect(page.locator(`#${errorId}`)).toContainText("HTTPS");

    const permissionRequestPatched = await page.evaluate(() => {
      const replacement = async () => {
        throw new Error("simulated permission API failure");
      };
      try {
        chrome.permissions.request = replacement;
        return chrome.permissions.request === replacement;
      } catch {
        return false;
      }
    });
    expect(permissionRequestPatched).toBe(true);
    await serverUrl.fill("https://mattermost.example.test");
    await page.locator(".options-save-footer .options-button").click();
    await expect(page.locator("#options-save-status")).toContainText("Unable to save settings");
    await expect(page.locator("#options-save-status")).toHaveAttribute("role", "alert");
  } finally {
    await closeOptions(fixture);
  }
});

test("performance tables retain their meaning and important links at narrow widths", async () => {
  const fixture = await openOptions();
  const { page } = fixture;

  try {
    await page.getByTestId("options-nav-performance").click();
    const endpointTable = page.locator(".options-table").first();
    await expect(endpointTable).toBeVisible();
    await expect(endpointTable.locator("tbody tr").first().locator("td").nth(0)).toHaveText("Joined teams");
    await expect(endpointTable.locator("tbody tr").first().locator("td").nth(1)).toContainText("/users/me/teams");
    await expect(endpointTable.locator('th[aria-sort="descending"]')).toContainText("Requests");

    const purposeHeader = endpointTable.getByRole("button", { name: "Purpose" });
    await purposeHeader.click();
    await expect(purposeHeader.locator("xpath=..")).toHaveAttribute("aria-sort", "descending");
    await purposeHeader.click();
    await expect(purposeHeader.locator("xpath=..")).toHaveAttribute("aria-sort", "ascending");
    expect(await endpointTable.evaluate((element) => Number.parseFloat(getComputedStyle(element).minWidth))).toBeGreaterThanOrEqual(720);

    await page.setViewportSize({ width: 600, height: 800 });
    const mobileLinks = page.locator(".options-mobile-links");
    await expect(mobileLinks).toBeVisible();
    await expect(mobileLinks.getByRole("link", { name: "Official website" })).toBeVisible();

    await page.emulateMedia({ reducedMotion: "reduce" });
    const transitionDuration = await page.getByTestId("options-nav-performance").evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    );
    expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.00001);
  } finally {
    await closeOptions(fixture);
  }
});

test("performance purposes and the settings title follow the selected language", async () => {
  const fixture = await openOptions();
  const { page } = fixture;

  try {
    await page.evaluate(() => new Promise<void>((resolve) => {
      chrome.storage.local.set({ "mattermostDeck.language.v1": "ja" }, () => resolve());
    }));
    await page.reload();
    await expect(page).toHaveTitle("Mattermost Deck 設定");
    await page.getByTestId("options-nav-performance").click();
    const endpointTable = page.locator(".options-table").first();
    await expect(endpointTable.locator("tbody tr").first().locator("td").nth(0)).toHaveText("参加中のチーム");
    await expect(page.locator(".options-metric-grid").first()).toContainText("API リクエスト");
  } finally {
    await closeOptions(fixture);
  }
});
