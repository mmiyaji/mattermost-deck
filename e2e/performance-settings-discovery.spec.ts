import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("performance controls precede diagnostics, expose their state and work with the keyboard", async ({}, info) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-performance-settings-"));
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1024 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await waitForInstalledOptions(context, worker);
    await worker.evaluate(() => chrome.storage.local.set({
      "mattermostDeck.language.v1": "ja", "mattermostDeck.optionsTheme.v1": "light",
      "mattermostDeck.serverUrl.v1": "http://127.0.0.1:8066",
    }));
    await page.reload();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await page.getByTestId("options-nav-performance").click();
    const cache = page.getByTestId("performance-cache-purpose");
    const advanced = page.getByTestId("performance-settings");
    const capture = page.getByTestId("performance-trace-capture");
    const overview = page.getByTestId("performance-overview");
    await expect(cache.locator("#performance-cache-title")).toHaveText("キャッシュ保持設定");
    await expect(advanced).not.toHaveAttribute("open", "");
    await expect(advanced.getByRole("spinbutton").first()).not.toBeVisible();
    // Changing settings should not require scrolling through an activity log first.
    for (const control of [cache, advanced]) {
      for (const diagnostic of [capture, overview]) {
        const follows = await control.evaluate((element, target) =>
          Boolean(element.compareDocumentPosition(target as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
        await diagnostic.elementHandle());
        expect(follows).toBe(true);
      }
    }
    await expect(cache.locator("#performance-cache-title")).toBeInViewport();
    await advanced.locator("summary").scrollIntoViewIfNeeded();
    await expect(advanced.locator("summary")).toBeVisible();
    await cache.scrollIntoViewIfNeeded();
    const group = page.getByRole("group", { name: "メンションのキャッシュ", exact: true });
    const on = group.getByRole("radio", { name: "保持する（オン）", exact: true });
    const off = group.getByRole("radio", { name: "保持しない（オフ）", exact: true });
    await expect(on).toBeVisible();
    await expect(off).toBeVisible();
    await expect(on).toBeChecked();
    await expect(cache.locator(".options-toggle-state")).toHaveText("オン · 保存済み");
    await on.focus();
    await page.keyboard.press("ArrowRight");
    await expect(off).toBeChecked();
    await expect(off).toBeFocused();
    await expect(cache.locator(".options-toggle-state")).toHaveText("オフ · 未保存");
    await page.keyboard.press("ArrowLeft");
    await expect(on).toBeChecked();
    await expect(cache.locator(".options-toggle-state")).toHaveText("オン · 保存済み");
    await expect(page.getByTestId("virtual-post-list-toggle")).toHaveCount(0);
    await expect(page.getByText("投稿リストの描画方式を比較（試験）", { exact: true })).toHaveCount(0);

    await expect(cache.getByTestId("options-clear-body-cache")).toHaveText("本文キャッシュを削除");
    await expect(cache).toContainText("要確認投稿の本文・未確認／確認済みの判断、お気に入り登録、設定は残ります");
    await expect(page.getByTestId("options-clear-body-cache")).toHaveCount(1);
    const traceOn = capture.getByTestId("trace-capture-on");
    const traceOff = capture.getByTestId("trace-capture-off");
    await traceOn.check();
    await expect(capture.getByTestId("trace-capture-state")).toHaveText("オン · 記録中");
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get("mattermostDeck.traceCapture.v1"))["mattermostDeck.traceCapture.v1"])).toBe(true);
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await traceOff.check();
    await expect(capture.getByTestId("trace-capture-state")).toHaveText("オフ · 停止中");
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get("mattermostDeck.traceCapture.v1"))["mattermostDeck.traceCapture.v1"])).toBe(false);
    await page.reload();
    await page.getByTestId("options-nav-performance").click();
    await expect(traceOff).toBeChecked();
    await expect(advanced).not.toHaveAttribute("open", "");
    await advanced.locator("summary").click();
    await expect(advanced.getByRole("spinbutton").first()).toBeVisible();
    await advanced.locator("summary").click();

    for (const theme of ["light", "dark"] as const) {
      await page.getByTestId(`settings-theme-${theme}`).click();
      await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1024 : 844 });
        await cache.scrollIntoViewIfNeeded();
        await expect(on).toBeVisible();
        await expect(off).toBeVisible();
        const dimensions = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth, viewport: innerWidth,
          panel: document.querySelector(".options-panel-scroll")!.scrollWidth,
          panelViewport: document.querySelector(".options-panel-scroll")!.clientWidth,
        }));
        expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
        expect(dimensions.panel).toBeLessThanOrEqual(dimensions.panelViewport + 1);
        for (const choice of [on, off]) {
          const bounds = await choice.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        }
        await page.mouse.move(5, 5);
        await page.screenshot({ path: info.outputPath(`performance-settings-${theme}-${width}.png`), animations: "disabled" });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1024 });
    for (const enabled of [true, false]) {
      await (enabled ? traceOn : traceOff).check();
      await capture.scrollIntoViewIfNeeded();
      for (const button of await capture.getByRole("button").all()) {
        const bounds = await button.boundingBox();
        expect(bounds!.height).toBeLessThan(60);
      }
      await page.screenshot({ path: info.outputPath(`trace-capture-${enabled ? "on" : "off"}.png`), animations: "disabled" });
    }
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
