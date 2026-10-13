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
      const app = document.querySelector(".options-app");
      const invalidInput = document.querySelector('[aria-invalid="true"]');
      if (app?.getAttribute("data-loaded") !== "true" && invalidInput) {
        (window as typeof window & { __optionsInvalidBeforeLoaded?: boolean }).__optionsInvalidBeforeLoaded = true;
      }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  });
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true", {
    timeout: 10_000,
  });
  return { context, page, userDataDir };
}

async function closeOptions(fixture: OptionsFixture): Promise<void> {
  await fixture.context.close();
  await fs.rm(fixture.userDataDir, { recursive: true, force: true });
}

async function seedProfiles(page: Page) {
  await page.evaluate(async () => {
    const origin = "https://mattermost.example.test";
    const profiles = ["alpha", "beta"].map((id) => ({ id, name: id, origin, createdAt: 1, updatedAt: 1 }));
    await chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin,
      "mattermostDeck.profiles.v1": { version: 1, profiles, activeProfileIdByOrigin: { [origin]: "alpha" }, lastActiveProfileId: "alpha" },
      ...Object.fromEntries(profiles.flatMap(({ id }) => [
        [`mattermostDeck.serverUrl.v1.profile.${id}`, origin],
        [`mattermostDeck.language.v1.profile.${id}`, "en"],
        [`mattermostDeck.theme.v1.profile.${id}`, "light"],
        [`mattermostDeck.fontScalePercent.v1.profile.${id}`, "100"],
      ])),
    });
  });
  await page.reload();
  await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
  await expect(page.locator(".options-editing-target")).toContainText("alpha");
}

async function editFont(page: Page, value: string) {
  await page.getByTestId("options-nav-appearance").click();
  await page.getByRole("spinbutton", { name: /^Font Size/ }).fill(value);
}

async function chooseProfile(page: Page, name: string) {
  await page.getByTestId("options-nav-profiles").click();
  await page.locator('[aria-labelledby="current-profile-label"][role="combobox"]').click();
  await page.getByRole("option", { name, exact: true }).click();
}

test("draft changes across panels can be undone and previews use the draft sizes and colors", async () => {
  const fixture = await openOptions();
  const { page } = fixture;
  try {
    await seedProfiles(page);
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await editFont(page, "120");
    await expect(page.locator("#options-save-status")).toHaveText("You have unsaved changes");
    await expect(page.getByTestId("appearance-preview-deck")).toHaveCSS("font-size", "16.8px");
    await page.getByRole("spinbutton", { name: /^Whole Deck width/ }).fill("900");
    await page.getByRole("spinbutton", { name: /^Individual pane width/ }).fill("400");
    await expect(page.getByTestId("appearance-preview-deck")).toHaveCSS("width", "900px");
    await expect(page.getByTestId("appearance-preview-pane").first()).toHaveCSS("width", "400px");
    for (const width of ["200", "800"]) {
      await page.getByRole("spinbutton", { name: /^Individual pane width/ }).fill(width);
      await expect(page.getByTestId("appearance-preview-pane").first()).toHaveCSS("width", `${width}px`);
    }
    const originalTheme = await page.locator('[aria-labelledby="theme-label"]').innerText();
    await page.locator('[aria-labelledby="theme-label"]').click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    await expect(page.getByTestId("appearance-preview-deck")).toHaveAttribute("data-theme", "dark");
    await page.locator('.options-color-grid input[type="color"]').first().fill("#123456");
    await page.locator(".options-subsection").filter({ has: page.locator(".options-color-grid") }).getByRole("checkbox").check();
    await expect(page.getByTestId("appearance-preview-type-icon").first()).toHaveCSS("color", "rgb(18, 52, 86)");
    await page.locator('.options-color-grid input[type="color"]').nth(2).fill("#654321");
    await expect(page.getByTestId("appearance-preview-pane").first()).toContainText("DM");
    await expect(page.getByTestId("appearance-preview-type-icon").first()).toHaveCSS("color", "rgb(101, 67, 33)");
    await page.getByTestId("options-nav-conn").click();
    await page.getByRole("textbox", { name: "Team (optional)", exact: true }).fill("design");
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Team (optional)", exact: true })).toHaveValue("");
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await page.getByTestId("options-nav-appearance").click();
    await expect(page.getByRole("spinbutton", { name: /^Font Size/ })).toHaveValue("100");
    await expect(page.locator('[aria-labelledby="theme-label"]')).toHaveText(originalTheme);
    await expect(page.getByTestId("appearance-preview-deck")).toHaveCSS("width", "720px");
    await expect(page.getByTestId("appearance-preview-pane").first()).toHaveCSS("width", "320px");
    await expect(page.locator('.options-color-grid input[type="color"]').first()).toHaveValue("#2f6fed");
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator(".options-preview-scroll").boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    const saveBounds = await page.getByTestId("options-save").boundingBox();
    expect(saveBounds!.x + saveBounds!.width).toBeLessThanOrEqual(390);
  } finally { await closeOptions(fixture); }
});

test("normal save establishes a new undo baseline and prevents edits during an in-flight save", async () => {
  const fixture = await openOptions();
  const { page } = fixture;
  try {
    await seedProfiles(page);
    await editFont(page, "115");
    await page.evaluate(() => {
      chrome.permissions.request = () => new Promise<boolean>((resolve) => {
        (window as typeof window & { finishSettingsSave?: () => void }).finishSettingsSave = () => resolve(true);
      });
    });
    await page.getByTestId("options-save").click();
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await expect(page.locator(".options-panel-scroll")).toHaveAttribute("inert", "");
    await page.evaluate(() => (window as typeof window & { finishSettingsSave?: () => void }).finishSettingsSave?.());
    await expect(page.locator("#options-save-status")).toHaveAttribute("data-status-code", "saved");
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await editFont(page, "130");
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: /^Font Size/ })).toHaveValue("115");
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await page.reload();
    await page.getByTestId("options-nav-appearance").click();
    await expect(page.getByRole("spinbutton", { name: /^Font Size/ })).toHaveValue("115");
  } finally { await closeOptions(fixture); }
});

test("profile switch cancel and discard keep the correct draft and saved profile", async () => {
  const fixture = await openOptions();
  const { page } = fixture;
  try {
    await seedProfiles(page);
    await editFont(page, "120");
    await chooseProfile(page, "beta");
    const dialog = page.getByRole("dialog", { name: "Save changes before switching?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('[aria-labelledby="current-profile-label"]')).toBeFocused();
    await expect(page.locator(".options-editing-target")).toContainText("alpha");
    await page.getByTestId("options-nav-appearance").click();
    await expect(page.getByRole("spinbutton", { name: /^Font Size/ })).toHaveValue("120");
    await chooseProfile(page, "beta");
    await dialog.getByRole("button", { name: "Discard and switch", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".options-editing-target")).toContainText("beta");
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await chooseProfile(page, "alpha");
    await expect(dialog).not.toBeVisible();
    await page.getByTestId("options-nav-appearance").click();
    await expect(page.getByRole("spinbutton", { name: /^Font Size/ })).toHaveValue("100");
  } finally { await closeOptions(fixture); }
});

test("save and switch does not switch on permission or storage failure, and persists only the source draft", async () => {
  const fixture = await openOptions();
  const { page } = fixture;
  try {
    await seedProfiles(page);
    await editFont(page, "125");
    await chooseProfile(page, "beta");
    const dialog = page.getByRole("dialog", { name: "Save changes before switching?" });
    await page.evaluate(() => { chrome.permissions.request = async () => false; });
    await dialog.getByRole("button", { name: "Save and switch", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(page.locator(".options-editing-target")).toContainText("alpha");
    await page.evaluate(() => {
      chrome.permissions.request = async () => true;
      const original = chrome.storage.session.remove.bind(chrome.storage.session);
      chrome.storage.session.remove = async () => {
        chrome.storage.session.remove = original;
        throw new Error("simulated write failure");
      };
    });
    await dialog.getByRole("button", { name: "Save and switch", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Unable to save settings");
    await expect(page.locator(".options-editing-target")).toContainText("alpha");
    await dialog.getByRole("button", { name: "Save and switch", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".options-editing-target")).toContainText("beta");
    await page.getByTestId("options-nav-appearance").click();
    await expect(page.getByRole("spinbutton", { name: /^Font Size/ })).toHaveValue("100");
    await chooseProfile(page, "alpha");
    await page.getByTestId("options-nav-appearance").click();
    await expect(page.getByRole("spinbutton", { name: /^Font Size/ })).toHaveValue("125");
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await page.reload();
    await page.getByTestId("options-nav-appearance").click();
    await expect(page.getByRole("spinbutton", { name: /^Font Size/ })).toHaveValue("125");
  } finally { await closeOptions(fixture); }
});

test("update method shows saved state, hides optional token settings, and target stays visible on narrow screens", async () => {
  const fixture = await openOptions();
  const { page } = fixture;
  try {
    await seedProfiles(page);
    await page.getByTestId("options-nav-realtime").click();
    await expect(page.getByRole("heading", { name: "Update method", exact: true })).toBeVisible();
    await expect(page.locator(".options-method-status")).toContainText("45s");
    await expect(page.locator('[aria-labelledby="pat-label"]')).not.toBeVisible();
    await page.locator(".options-realtime-details summary").press("Enter");
    await page.locator('[aria-labelledby="pat-label"]').fill("local-test-token");
    await expect(page.locator(".options-method-status")).toContainText("45s");
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(page.locator('[aria-labelledby="pat-label"]')).toHaveValue("");
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".options-editing-target")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await closeOptions(fixture); }
});

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
    await page.getByTestId("options-save").click();
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
    await page.getByTestId("options-save").click();
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
