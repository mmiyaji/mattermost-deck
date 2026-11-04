import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("performance overview explains queue delays, failures, chart periods, and defaults to full width", async ({}, testInfo) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-performance-overview-"));
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1600, height: 1300 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await waitForInstalledOptions(context, worker);
    const now = Date.now();
    const entries = Array.from({ length: 180 }, (_, i) => ({ id: `overview-${i}`, timestamp: now - i * 14000, source: "api", level: "info", event: "request.complete", payload: { path: "/posts/search", purpose: "Team post search", method: "POST", status: 200, durationMs: 1450 + i * 9, queueWaitMs: 1200 + i * 8, queueDepth: 42 - i % 40 } }));
    await worker.evaluate(async entries => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ "mattermostDeck.language.v1": "ja", "mattermostDeck.optionsTheme.v1": "dark" });
    }, entries);
    await page.reload();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await page.evaluate(async entries => {
      const state = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "setCapture", enabled: true });
      await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "append", generation: state.generation, entries });
      return state;
    }, entries);
    expect(await page.evaluate(async () => { const response = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "query", from: Date.now() - 24 * 60 * 60_000, to: Date.now(), limit: 100 }); return [response.entries.length, response.hasMore]; })).toEqual([100, true]);
    await page.reload();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("options-nav-performance").click();
    const presetGrid = page.locator(".performance-preset-grid");
    expect(await presetGrid.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(4);
    const overview = page.getByTestId("performance-overview");
    await expect(overview.getByRole("heading", { name: "拡張内の待ち時間が大きくなっています" })).toBeVisible();
    await expect(page.locator(".options-panel--wide")).toBeVisible();
    const widths = await page.evaluate(() => ({ panel: document.querySelector(".options-panel--wide")!.getBoundingClientRect().width, content: document.querySelector(".options-content")!.clientWidth }));
    expect(widths.content - widths.panel).toBeLessThan(90);
    await expect(overview.getByTestId("performance-chart-latency").getByRole("application")).toBeVisible();
    await expect(overview.getByTestId("performance-chart-count").getByRole("application")).toBeVisible();
    const expiredStart = Math.floor((Date.now() - 2 * 24 * 60 * 60_000) / 60_000) * 60_000;
    await page.evaluate(async start => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("mattermost-deck-traces", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction("aggregates", "readwrite"); tx.objectStore("aggregates").put({ start, count: 3, errors: 2, rateLimited: 1, waitSum: 1200, waitCount: 2, networkSum: 900, networkCount: 2, totalSum: 2100, totalCount: 2, clientLimiterWaits: 1, maxOutstanding: 7 }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    }, expiredStart);
    await overview.getByTestId("performance-trend-range").selectOption("7");
    await expect(overview.getByTestId("performance-trend-range")).toHaveValue("7");
    await expect.poll(() => page.evaluate(async () => { const response = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "aggregates", from: Date.now() - 7 * 24 * 60 * 60_000, to: Date.now() }); return response.aggregates.some(bucket => bucket.count === 3); })).toBe(true);
    await overview.getByTestId("performance-chart-count").locator(".recharts-bar-rectangle").first().click();
    await expect(overview.getByTestId("performance-detail-expired")).toBeVisible();
    const longRangeScreenshot = path.resolve("test-results/performance-overview-7d-expired-detail.png");
    await fs.mkdir(path.dirname(longRangeScreenshot), { recursive: true });
    await page.screenshot({ path: longRangeScreenshot, fullPage: true });
    await overview.getByTestId("performance-reset-filters").click();
    await expect(overview.getByTestId("performance-retention-note")).toBeVisible();
    await expect(overview.getByTestId("performance-trend-range")).toHaveValue("7");
    await overview.getByTestId("performance-trend-range").selectOption("1");
    await expect(overview.getByTestId("performance-request-row")).toHaveCount(50);
    await overview.getByTestId("performance-page-next").click();
    await expect(overview.getByTestId("performance-request-row")).toHaveCount(50);
    await overview.getByTestId("performance-page-previous").click();
    await overview.getByTestId("performance-page-next").click();
    await expect(overview.getByTestId("performance-request-row")).toHaveCount(50);
    await overview.getByTestId("performance-page-next").click();
    await expect(overview.getByTestId("performance-request-row")).toHaveCount(50);
    await overview.getByTestId("performance-page-next").click();
    await expect(overview.getByTestId("performance-request-row")).toHaveCount(30);
    await overview.getByTestId("performance-request-expand").first().click();
    await expect(overview.getByTestId("performance-request-expanded").first()).toContainText("Team post search");
    await overview.getByTestId("performance-request-expand").first().click();
    await overview.getByTestId("performance-page-previous").click();
    await overview.getByTestId("performance-page-previous").click();
    await overview.getByTestId("performance-page-previous").click();
    await overview.getByTestId("performance-filter-failed").click();
    await expect(overview.getByTestId("performance-request-empty")).toBeVisible();
    await overview.getByTestId("performance-filter-all").click();
    await overview.getByTestId("performance-status-filter").selectOption("200");
    await expect(overview.getByTestId("performance-request-row")).toHaveCount(50);
    await overview.getByTestId("performance-status-filter").selectOption("all");
    await expect(overview.getByText("記録中", { exact: false })).toBeVisible();
    const advice = overview.getByTestId("performance-advice");
    await expect(advice).toContainText("100 件の計測済みリクエスト");
    await expect(advice).toContainText("サーバー容量を測定した結果ではありません");
    await advice.getByTestId("performance-advice-apply").click();
    await expect(page.getByTestId("performance-preset-radio-high")).toBeChecked();
    await expect(page.getByTestId("performance-preset-preview")).toBeVisible();
    await expect(page.getByTestId("performance-preset-preview-status")).toContainText("未適用");
    await expect(page.getByTestId("options-save")).toBeDisabled();
    await expect(page.getByTestId("performance-preset-preview").getByRole("table")).toContainText("API 全体のレート（件/分）");
    await expect(page.getByTestId("performance-preset-preview").getByRole("columnheader")).toHaveCount(3);
    await page.getByTestId("performance-preset").screenshot({ path: testInfo.outputPath("performance-preset-high-preview-dark.png") });
    await page.getByTestId("performance-preset-apply").click();
    await expect(page.getByTestId("options-save")).toBeEnabled();
    await expect(page.getByTestId("performance-preset-radio-high")).toBeChecked();
    await expect(page.getByTestId("virtual-post-list-toggle")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("performance-overview-ja-dark.png"), fullPage: false });
    await page.evaluate(async entries => {
      const state = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "setCapture", enabled: true });
      await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "append", generation: state.generation, entries });
    }, [
      { id: "overview-error-429", timestamp: now + 1, source: "api", level: "error", event: "request.error", payload: { method: "GET", path: "/files/info", status: 429, durationMs: 3000, error: "rate limited" } },
      { id: "overview-error-501", timestamp: now + 2, source: "api", level: "error", event: "request.error", payload: { method: "GET", path: "/api/v4/posts/search", status: 501, durationMs: 3000, error: "not implemented" } },
    ]);
    const statusCounts = await page.evaluate(async () => {
      const query = async (status: number) => { const response = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "query", requestsOnly: true, from: Date.now() - 24 * 60 * 60_000, to: Date.now() + 1, status, limit: 100 }); return response.entries.length; };
      return [await query(429), await query(501)];
    });
    expect(statusCounts).toEqual([1, 1]);
    const exportDownload = page.waitForEvent("download");
    await page.getByTestId("trace-export").click();
    const downloaded = await exportDownload;
    const exportPath = path.resolve("test-results/performance-trace-export.jsonl");
    await downloaded.saveAs(exportPath);
    expect((await fs.readFile(exportPath, "utf8")).trim().split("\n")).toHaveLength(182);
    await worker.evaluate(() => chrome.storage.local.set({ "mattermostDeck.optionsTheme.v1": "light" }));
    await page.reload();
    await page.getByTestId("options-nav-performance").click();
    await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
    await page.screenshot({ path: testInfo.outputPath("performance-overview-ja-light.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 1900 });
    await page.getByTestId("performance-preset-radio-low").check();
    expect(await presetGrid.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(1);
    await expect(overview).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByTestId("performance-preset-preview")).toBeVisible();
    const tableWidths = await page.getByTestId("performance-preset-preview").locator(".performance-preset-table-wrap").evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    expect(tableWidths.scroll).toBeLessThanOrEqual(tableWidths.client + 1);
    await page.getByTestId("performance-preset").screenshot({ path: testInfo.outputPath("performance-preset-low-preview-narrow-light.png") });
    const clearOnlyAggregateStart = Math.floor((Date.now() - 2 * 24 * 60 * 60_000) / 60_000) * 60_000;
    await page.evaluate(async start => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("mattermost-deck-traces", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["details", "aggregates"], "readwrite");
        tx.objectStore("details").clear();
        const aggregates = tx.objectStore("aggregates"); aggregates.clear();
        aggregates.put({ start, count: 3, errors: 1, rateLimited: 1, waitSum: 100, waitCount: 1, networkSum: 200, networkCount: 1, totalSum: 300, totalCount: 1, clientLimiterWaits: 0, maxOutstanding: 2 });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
      db.close();
      await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "setCapture", enabled: true });
    }, clearOnlyAggregateStart);
    await expect(page.getByTestId("performance-request-empty")).toBeVisible();
    await expect.poll(() => page.evaluate(async () => { const response = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "aggregates", from: Date.now() - 7 * 24 * 60 * 60_000, to: Date.now() }); return response.aggregates.some(bucket => bucket.count === 3); })).toBe(true);
    await expect(page.getByTestId("trace-clear")).toBeEnabled();
    await page.getByTestId("trace-clear").click();
    await expect(page.getByTestId("performance-request-empty")).toBeVisible();
    await expect.poll(() => page.evaluate(async () => { const response = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "aggregates", from: Date.now() - 7 * 24 * 60 * 60_000, to: Date.now() }); return response.aggregates.length; })).toBe(0);
    await page.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "setCapture", enabled: true });
      await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "append", generation: state.generation, entries: [{ id: "off-reset", timestamp: Date.now(), source: "api", level: "info", event: "request.complete", payload: { path: "/posts/search", status: 200, durationMs: 10, queueWaitMs: 0 } }] });
    });
    await expect.poll(() => page.evaluate(async () => { const response = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "aggregates", from: Date.now() - 24 * 60 * 60_000, to: Date.now() }); return response.aggregates.length; })).toBe(1);
    await page.getByTestId("trace-capture-off").check();
    await expect(page.getByTestId("trace-capture-state")).toContainText("オフ");
    await expect.poll(() => page.evaluate(async () => { const response = await chrome.runtime.sendMessage({ type: "mattermost-deck:trace-storage", operation: "aggregates", from: Date.now() - 24 * 60 * 60_000, to: Date.now() }); return response.aggregates.length; })).toBe(0);
    await expect(page.getByTestId("performance-request-empty")).toBeVisible();
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
