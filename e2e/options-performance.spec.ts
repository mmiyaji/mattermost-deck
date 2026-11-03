import { chromium, expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PERFORMANCE_DEFAULTS, PERFORMANCE_LIMITS, RESPONSIVE_PERFORMANCE_PRESET, type PerformanceSettings } from "../src/performanceSettings";
import { waitForInstalledOptions } from "./extension-install";

const ja = JSON.parse(readFileSync(path.resolve("src/ui/locales/ja.json"), "utf8")) as typeof import("../src/ui/locales/ja.json");
const profileId = "performance-options";
const serverUrl = "http://127.0.0.1:8065";
const performanceFields = Object.keys(PERFORMANCE_DEFAULTS) as (keyof PerformanceSettings)[];
const customPerformance: PerformanceSettings = {
  apiMaxConcurrentRequests: 4,
  apiMinStartGapMs: 250,
  apiGlobalRequestsPerMinute: 240,
  apiGetRequestsPerMinute: 200,
  apiPostRequestsPerMinute: 60,
  apiRequestTimeoutSeconds: 25,
  apiQueueTimeoutSeconds: 40,
  mentionThreadCacheSeconds: 90,
  mentionReconcileMinIntervalSeconds: 15,
  mentionFullScanIntervalSeconds: 180,
  mentionTeamConcurrency: 3,
};

function performanceInput(page: Page, field: keyof PerformanceSettings) {
  return page.getByRole("spinbutton", { name: ja.options.performanceSettings.fields[field] });
}

async function openPerformanceSettings(page: Page) {
  await page.getByTestId("options-nav-performance").click();
  const advanced = page.locator("details").filter({ has: page.locator("summary", { hasText: ja.options.performanceSettings.title }) });
  if (!(await advanced.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await advanced.locator("summary").click();
  }
  await expect(advanced).toHaveAttribute("open", "");
  return advanced;
}

test("Japanese advanced performance settings save, survive reload, discard drafts, and restore independently", async ({}, testInfo) => {
  const extensionPath = path.resolve("./dist");
  const profileDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-performance-options-"));
  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1400 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const page = await waitForInstalledOptions(context, worker);
    await worker.evaluate(async ({ profileId, serverUrl }) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        "mattermostDeck.serverUrl.v1": serverUrl,
        "mattermostDeck.profiles.v1": {
          version: 1,
          profiles: [{ id: profileId, name: "Performance", origin: serverUrl, createdAt: 1, updatedAt: 1 }],
          activeProfileIdByOrigin: { [serverUrl]: profileId },
          lastActiveProfileId: profileId,
        },
        [`mattermostDeck.serverUrl.v1.profile.${profileId}`]: serverUrl,
        [`mattermostDeck.language.v1.profile.${profileId}`]: "ja",
        [`mattermostDeck.theme.v1.profile.${profileId}`]: "light",
        [`mattermostDeck.highlightKeywords.v1.profile.${profileId}`]: "keep-this-keyword",
        [`mattermostDeck.preferredColumnWidth.v1.profile.${profileId}`]: "400",
        [`mattermostDeck.compactMode.v1.profile.${profileId}`]: "true",
        [`mattermostDeck.profileSettingsInitialized.v1.profile.${profileId}`]: "true",
      });
    }, { profileId, serverUrl });
    await page.addInitScript(() => {
      Object.defineProperty(chrome.permissions, "request", { configurable: true, value: async () => true });
    });
    await page.reload();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await openPerformanceSettings(page);
    for (const field of performanceFields) {
      const input = performanceInput(page, field);
      await expect(input).toHaveValue(String(PERFORMANCE_DEFAULTS[field]));
      await expect(input).toHaveAttribute("min", String(PERFORMANCE_LIMITS[field].min));
      await expect(input).toHaveAttribute("max", String(PERFORMANCE_LIMITS[field].max));
      await input.fill(String(customPerformance[field]));
    }
    await page.getByTestId("options-save").click();
    await expect(page.locator("#options-save-status")).toHaveText(ja.options.saved);
    await expect(page.getByTestId("options-save")).toBeDisabled();

    await page.reload();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await openPerformanceSettings(page);
    for (const field of performanceFields) {
      await expect(performanceInput(page, field)).toHaveValue(String(customPerformance[field]));
    }
    const screenshotPath = testInfo.outputPath("advanced-performance-ja.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach("Japanese advanced performance settings", { path: screenshotPath, contentType: "image/png" });

    await performanceInput(page, "apiMaxConcurrentRequests").fill("7");
    await page.getByTestId("options-nav-appearance").click();
    await expect(page.locator("#options-save-status")).toHaveText(ja.options.unsavedChanges);
    await openPerformanceSettings(page);
    await expect(performanceInput(page, "apiMaxConcurrentRequests")).toHaveValue("7");
    await page.getByRole("button", { name: ja.options.discardChanges, exact: true }).click();
    await expect(performanceInput(page, "apiMaxConcurrentRequests")).toHaveValue("4");
    await expect(page.getByTestId("options-save")).toBeDisabled();

    await page.getByRole("button", { name: ja.options.performanceSettings.restoreDefaults, exact: true }).click();
    for (const field of performanceFields) {
      await expect(performanceInput(page, field)).toHaveValue(String(PERFORMANCE_DEFAULTS[field]));
    }
    await page.getByTestId("options-save").click();
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await page.reload();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await openPerformanceSettings(page);
    for (const field of performanceFields) {
      await expect(performanceInput(page, field)).toHaveValue(String(PERFORMANCE_DEFAULTS[field]));
    }
    const stored = await worker.evaluate(async (profileId) => {
      const values = await chrome.storage.local.get(null);
      return Object.fromEntries(Object.entries(values).filter(([key]) => key.endsWith(`.profile.${profileId}`)));
    }, profileId);
    expect(stored[`mattermostDeck.highlightKeywords.v1.profile.${profileId}`]).toBe("keep-this-keyword");
    expect(stored[`mattermostDeck.preferredColumnWidth.v1.profile.${profileId}`]).toBe("400");
    expect(stored[`mattermostDeck.compactMode.v1.profile.${profileId}`]).toBe("true");
    expect(stored[`mattermostDeck.language.v1.profile.${profileId}`]).toBe("ja");
    for (const field of performanceFields) {
      expect(stored[`mattermostDeck.${field}.v1.profile.${profileId}`]).toBe(String(PERFORMANCE_DEFAULTS[field]));
    }
    await page.getByTestId("performance-apply-fetch-preset").click();
    for (const field of performanceFields) {
      await expect(performanceInput(page, field)).toHaveValue(String(RESPONSIVE_PERFORMANCE_PRESET[field] ?? PERFORMANCE_DEFAULTS[field]));
    }
    await expect(page.getByTestId("options-save")).toBeEnabled();
    const beforeSave = await worker.evaluate(async (profileId) => chrome.storage.local.get([
      `mattermostDeck.apiGetRequestsPerMinute.v1.profile.${profileId}`,
      `mattermostDeck.persistMentionCache.v1.profile.${profileId}`,
    ]), profileId);
    expect(beforeSave[`mattermostDeck.apiGetRequestsPerMinute.v1.profile.${profileId}`]).toBe("150");
    expect(beforeSave[`mattermostDeck.persistMentionCache.v1.profile.${profileId}`]).toBe("true");
    await page.getByTestId("options-save").click();
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await page.reload();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await openPerformanceSettings(page);
    for (const field of performanceFields) {
      await expect(performanceInput(page, field)).toHaveValue(String(RESPONSIVE_PERFORMANCE_PRESET[field] ?? PERFORMANCE_DEFAULTS[field]));
    }
    const afterSave = await worker.evaluate(async (profileId) => chrome.storage.local.get([
      `mattermostDeck.persistMentionCache.v1.profile.${profileId}`,
    ]), profileId);
    expect(afterSave[`mattermostDeck.persistMentionCache.v1.profile.${profileId}`]).toBe("true");
    const presetScreenshot = testInfo.outputPath("responsive-preset-ja.png");
    await page.screenshot({ path: presetScreenshot, fullPage: true });
    await testInfo.attach("Responsive settings and cache persisted", { path: presetScreenshot, contentType: "image/png" });
  } finally {
    await context.close();
    await fs.rm(profileDirectory, { recursive: true, force: true });
  }
});
