import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("header theme is independent, persists, syncs and follows system changes", async ({}, info) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-header-theme-"));
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    viewport: { width: 1440, height: 1024 }, args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await waitForInstalledOptions(context, worker);
    await worker.evaluate(() => chrome.storage.local.set({ "mattermostDeck.language.v1": "ja", "mattermostDeck.theme.v1": "dark" }));
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    const controls = page.getByTestId("settings-theme-control");
    const light = page.getByTestId("settings-theme-light");
    const dark = page.getByTestId("settings-theme-dark");
    const system = page.getByTestId("settings-theme-system");
    await expect(light).toHaveAccessibleName("ライト");
    await expect(dark).toHaveAccessibleName("ダーク");
    await expect(system).toHaveAccessibleName("システムに合わせる");
    await expect(system).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
    await dark.focus();
    await page.keyboard.press("Enter");
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await expect(system).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
    await expect.poll(async () => worker.evaluate(async () => (await chrome.storage.local.get("mattermostDeck.optionsTheme.v1"))["mattermostDeck.optionsTheme.v1"])).toBe("dark");
    await page.reload();
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
    const second = await context.newPage();
    await second.goto(page.url());
    await expect(second.getByTestId("settings-theme-dark")).toHaveAttribute("aria-pressed", "true");
    await light.focus();
    await page.keyboard.press("Space");
    await expect(light).toHaveAttribute("aria-pressed", "true");
    await expect(second.locator("body")).toHaveAttribute("data-theme", "light");
    await system.click();
    await expect(system).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
    await expect.poll(async () => worker.evaluate(async () => (await chrome.storage.local.get("mattermostDeck.theme.v1"))["mattermostDeck.theme.v1"])).toBe("dark");
    await page.getByTestId("options-nav-behavior").click();
    await expect(page.getByTestId("options-save")).toBeDisabled();
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const box = await controls.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const theme of ["light", "dark", "system"] as const) {
        const choice = page.getByTestId(`settings-theme-${theme}`);
        await choice.click();
        await expect(choice).toHaveAttribute("aria-pressed", "true");
        await expect(controls.locator('[aria-pressed="true"]')).toHaveCount(1);
        await page.mouse.move(5, 5);
        await page.screenshot({ path: info.outputPath(`settings-header-theme-${theme}-${width}.png`), animations: "disabled" });
      }
    }
    await expect.poll(async () => worker.evaluate(async () => (await chrome.storage.local.get("mattermostDeck.optionsTheme.v1"))["mattermostDeck.optionsTheme.v1"])).toBe("system");
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.evaluate(() => { chrome.storage.local.set = async () => { throw new Error("test failure"); }; });
    await dark.click();
    await expect(page.getByRole("alert")).toContainText("テーマ");
    await expect(system).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
  } finally { await context.close(); await fs.rm(profile, { recursive: true, force: true }); }
});
