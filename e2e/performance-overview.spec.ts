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
    const entries = Array.from({ length: 80 }, (_, i) => ({ id: `overview-${i}`, timestamp: now - i * 14000, source: "api", level: "info", event: "request.complete", payload: { path: "/posts/search", purpose: "Team post search", method: "POST", status: 200, durationMs: 1450 + i * 9, queueWaitMs: 1200 + i * 8, queueDepth: 42 - i % 40 } }));
    await worker.evaluate(async entries => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ "mattermostDeck.language.v1": "ja", "mattermostDeck.theme.v1": "dark", "mattermostDeck.traceCapture.v1": true, "mattermostDeck.traceEntries.v1": entries });
    }, entries);
    await page.reload();
    await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await page.getByTestId("options-nav-performance").click();
    const overview = page.getByTestId("performance-overview");
    await expect(overview.getByRole("heading", { name: "拡張内の待ち時間が大きくなっています" })).toBeVisible();
    await expect(page.locator(".options-panel--wide")).toBeVisible();
    const widths = await page.evaluate(() => ({ panel: document.querySelector(".options-panel--wide")!.getBoundingClientRect().width, content: document.querySelector(".options-content")!.clientWidth }));
    expect(widths.content - widths.panel).toBeLessThan(90);
    await expect(overview.getByTestId("performance-chart-latency").getByRole("application")).toBeVisible();
    await expect(overview.getByTestId("performance-chart-count").getByRole("application")).toBeVisible();
    await expect(overview.getByText(/保存済み最大500ログ/)).toBeVisible();
    await expect(overview.getByText("記録中", { exact: false })).toBeVisible();
    await expect(page.getByTestId("virtual-post-list-toggle")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("performance-overview-ja-dark.png"), fullPage: false });
    await worker.evaluate(async entry => {
      const data = await chrome.storage.local.get("mattermostDeck.traceEntries.v1");
      await chrome.storage.local.set({ "mattermostDeck.traceEntries.v1": [entry, ...data["mattermostDeck.traceEntries.v1"]] });
    }, { id: "overview-error", timestamp: now + 1, source: "api", level: "error", event: "request.error", payload: { method: "GET", path: "/files/info", durationMs: 3000, error: "timeout" } });
    await expect(overview.getByRole("heading", { name: "失敗したリクエストがあります" })).toBeVisible();
    await expect(overview.getByText("1 / 81", { exact: true })).toBeVisible();
    await worker.evaluate(() => chrome.storage.local.set({ "mattermostDeck.theme.v1": "light" }));
    await page.reload();
    await page.getByTestId("options-nav-performance").click();
    await page.screenshot({ path: testInfo.outputPath("performance-overview-ja-light.png"), fullPage: false });
    await page.setViewportSize({ width: 600, height: 1000 });
    await expect(overview).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("performance-overview-narrow.png"), fullPage: false });
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
