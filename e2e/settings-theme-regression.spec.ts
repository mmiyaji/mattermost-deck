import { chromium, expect, test, type Page, type Worker } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";
import { appendTraceEntries, clearTraceEntries } from "./trace-storage";
import type { TraceLogEntry } from "../src/traceProtocol";

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-settings-themes-"));
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(directory, {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1024 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = await waitForInstalledOptions(context, worker);
  await worker.evaluate(() => chrome.storage.local.clear());
  return { context, worker, page, async close() { await context.close(); await fs.rm(directory, { recursive: true, force: true }); } };
}

async function seed(context: import("@playwright/test").BrowserContext, worker: Worker, theme: string) {
  const now = Date.now();
  const entries: TraceLogEntry[] = Array.from({ length: 500 }, (_, i) => ({ id: `theme-request-${i}`, timestamp: now - i * 1000,
    source: "api", level: i % 4 ? "info" : "error", event: "request.complete", payload: {
      method: "GET", path: `/posts/theme-${i}`, fullPath: `/api/v4/posts/theme-${i}`, status: i % 4 ? 200 : 501,
      durationMs: 400 + i, queueWaitMs: 100, failed: i % 4 === 0, error: i % 4 ? undefined : "permission-not-available",
    } }));
  await worker.evaluate(({ theme }) => chrome.storage.local.set({
    "mattermostDeck.theme.v1": theme, "mattermostDeck.language.v1": "ja",
    "mattermostDeck.optionsTheme.v1": theme === "mattermost" ? "system" : theme,
  }), { theme });
  await clearTraceEntries(context, worker);
  for (let offset = 0; offset < entries.length; offset += 100) await appendTraceEntries(context, worker, entries.slice(offset, offset + 100));
}

/** Measure visible text against the composited ancestor background, not only its transparent own box. */
async function contrast(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(element => {
    const parse = (value: string): number[] => value.match(/[\d.]+/g)!.map(Number);
    const blend = (front: number[], back: number[]) => {
      const alpha = front[3] ?? 1;
      return [0, 1, 2].map(i => front[i] * alpha + back[i] * (1 - alpha));
    };
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.push(node);
    let background = [255, 255, 255];
    for (const node of ancestors.reverse()) background = blend(parse(getComputedStyle(node).backgroundColor), background);
    const foreground = blend(parse(getComputedStyle(element).color), background);
    const luminance = (rgb: number[]) => rgb.map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
      .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const first = luminance(foreground), second = luminance(background);
    return { ratio: (Math.max(first, second) + .05) / (Math.min(first, second) + .05),
      color: getComputedStyle(element).color, background, foreground };
  });
}

test("performance request text stays readable in light, dark, system and Mattermost fallback themes", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const f = await fixture();
  const evidence: unknown[] = [];
  try {
    for (const [theme, media] of [["light", "light"], ["dark", "dark"], ["system", "light"], ["system", "dark"], ["mattermost", "dark"]] as const) {
      await f.page.emulateMedia({ colorScheme: media });
      await seed(f.context, f.worker, theme);
      await f.page.reload();
      await expect(f.page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
      await f.page.getByTestId("options-nav-performance").click();
      await expect(f.page.getByTestId("performance-failed-metric")).toContainText("125 / 500");
      await f.page.getByTestId("performance-failed-metric").click();
      await expect(f.page.getByTestId("performance-request-row")).toHaveCount(50);
      await f.page.getByTestId("performance-request-expand").first().click();
      const readings = [];
      for (const selector of [".perf-request-path code", '[data-testid="performance-request-row"] td:nth-child(4)',
        ".perf-request-table th", ".perf-request-filters label", ".perf-active-filter", ".perf-error-message",
        ".perf-request-expanded dd"]) {
        const measured = await contrast(f.page, selector);
        readings.push({ selector, ...measured });
        expect(measured.ratio, `${theme}/${media}: ${selector} ${JSON.stringify(measured)}`).toBeGreaterThanOrEqual(4.5);
      }
      evidence.push({ theme, media, readings });
      await f.page.mouse.move(1300, 20);
      const geometry = await footerGeometry(f.page);
      evidence.push({ theme, media, capturedGeometry: geometry });
      await f.page.screenshot({ path: testInfo.outputPath(`performance-${theme}-${media}.png`), fullPage: false, animations: "disabled" });
      expect(Math.abs(geometry.footer!.bottom - geometry.innerHeight)).toBeLessThanOrEqual(2);
    }
  } finally {
    await fs.writeFile(testInfo.outputPath("theme-contrast.json"), JSON.stringify(evidence, null, 2));
    await f.close();
  }
});

async function footerGeometry(page: Page) {
  return page.evaluate(() => {
    const rectangle = (selector: string) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { top: box.top, bottom: box.bottom, height: box.height, width: box.width } : null;
    };
    return { innerHeight: window.innerHeight, visualHeight: window.visualViewport?.height, scrollY: window.scrollY,
      bodyZoom: getComputedStyle(document.body).zoom, app: rectangle(".options-app"), root: rectangle("#options-root"),
      htmlZoom: getComputedStyle(document.documentElement).zoom,
      rootStyle: { position: getComputedStyle(document.querySelector("#options-root")!).position,
        overflow: getComputedStyle(document.querySelector("#options-root")!).overflow },
      scrollContainers: ["html", "body", "#options-root", ".options-app", ".options-body", ".options-content", ".options-panel-scroll"].map(selector => {
        const element = document.querySelector(selector)!;
        return { selector, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
      }), footer: rectangle(".options-save-footer"), documentWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
  });
}

test("settings footer follows the actual viewport through resize, browser zoom and injected page zoom", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const f = await fixture();
  const evidence: unknown[] = [];
  try {
    await seed(f.context, f.worker, "mattermost");
    await f.page.reload();
    await expect(f.page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await f.page.getByTestId("options-nav-performance").click();
    for (const [width, height] of [[1440, 1024], [1920, 1080]]) {
      await f.page.setViewportSize({ width, height });
      for (const zoom of [1, .9, .75, 1.25]) {
        await f.worker.evaluate(async zoom => {
          const tabs = await chrome.tabs.query({});
          const tab = tabs.find(tab => tab.url?.endsWith("/options.html"));
          if (tab?.id === undefined) throw new Error("Options tab missing");
          await chrome.tabs.setZoom(tab.id, zoom);
        }, zoom);
        const geometry = await footerGeometry(f.page);
        evidence.push({ mode: "browser", width, height, zoom, ...geometry });
        expect(Math.abs(geometry.app!.bottom - geometry.innerHeight)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.footer!.bottom - geometry.innerHeight)).toBeLessThanOrEqual(2);
      }
    }
    await f.worker.evaluate(async () => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.endsWith("/options.html"));
      await chrome.tabs.setZoom(tab!.id!, 1);
    });
    await f.page.setViewportSize({ width: 1440, height: 1024 });
    for (const zoom of [.9, .75, 1.25]) {
      await f.page.evaluate(zoom => { document.body.style.zoom = String(zoom); }, zoom);
      const geometry = await footerGeometry(f.page);
      evidence.push({ mode: "injected-body", zoom, ...geometry });
      await f.page.screenshot({ path: testInfo.outputPath(`footer-body-zoom-${zoom}.png`), fullPage: false, animations: "disabled" });
      expect(Math.abs(geometry.app!.bottom - geometry.innerHeight)).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.footer!.bottom - geometry.innerHeight)).toBeLessThanOrEqual(2);
    }
    await f.page.evaluate(() => { document.body.style.removeProperty("zoom"); });
    for (const selector of ["html", "#options-root"]) {
      for (const zoom of [.9, .75]) {
        await f.page.locator(selector).evaluate((element, zoom) => { (element as HTMLElement).style.zoom = String(zoom); }, zoom);
        const geometry = await footerGeometry(f.page);
        evidence.push({ mode: `injected-${selector}`, zoom, ...geometry });
        expect(Math.abs(geometry.app!.bottom - geometry.innerHeight)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.footer!.bottom - geometry.innerHeight)).toBeLessThanOrEqual(2);
      }
      await f.page.locator(selector).evaluate(element => { (element as HTMLElement).style.removeProperty("zoom"); });
    }
    await f.page.getByTestId("options-nav-guide").click();
    await expect(f.page.locator(".options-save-footer")).toHaveCount(0);
    const readOnly = await footerGeometry(f.page);
    expect(Math.abs(readOnly.app!.bottom - readOnly.innerHeight)).toBeLessThanOrEqual(2);
  } finally {
    await fs.writeFile(testInfo.outputPath("footer-geometry.json"), JSON.stringify(evidence, null, 2));
    await f.close();
  }
});

test("previous-display purpose and saved on/off state stay clear when applying performance presets", async ({}, testInfo) => {
  const f = await fixture();
  try {
    await seed(f.context, f.worker, "mattermost");
    await f.worker.evaluate(baseUrl => chrome.storage.local.set({ "mattermostDeck.serverUrl.v1": baseUrl }), process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066");
    await f.page.reload();
    await expect(f.page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await f.page.getByTestId("options-nav-performance").click();
    const purpose = f.page.getByTestId("performance-cache-purpose");
    const on = f.page.getByTestId("performance-cache-on");
    const off = f.page.getByTestId("performance-cache-off");
    await expect(purpose.locator("#performance-cache-description")).not.toContainText(/IndexedDB|API|MiB|レート/);
    await expect(purpose.locator("#performance-cache-description")).toContainText(/表示/);
    await expect(on).toBeChecked();
    await expect(purpose.locator(".options-toggle-state")).toHaveText("オン · 保存済み");
    await off.check();
    await expect(purpose.locator(".options-toggle-state")).toHaveText("オフ · 未保存");
    await f.page.getByTestId("performance-preset-radio-high").check();
    await expect(f.page.getByTestId("performance-preset-preview")).toBeVisible();
    await expect(off).toBeChecked();
    await expect(purpose.locator(".options-toggle-state")).toHaveText("オフ · 未保存");
    await expect(f.page.getByTestId("performance-preset-state")).toContainText("編集中: 標準");
    await f.page.getByTestId("performance-preset-apply").click();
    await expect(f.page.getByTestId("options-save")).toBeEnabled();
    await f.page.getByTestId("options-nav-behavior").click();
    await expect(f.page.locator('input[aria-labelledby="persist-mention-cache-label"]')).toHaveCount(0);
    await expect(f.page.getByTestId("options-clear-body-cache")).toHaveCount(0);
    await f.page.getByTestId("options-save").click();
    await expect(f.page.getByTestId("options-save")).toBeDisabled();
    await f.page.getByTestId("options-nav-performance").click();
    await expect(off).toBeChecked();
    await expect(purpose.locator(".options-toggle-state")).toHaveText("オフ · 保存済み");
    await expect(f.page.getByTestId("performance-preset-radio-high")).toBeChecked();
    await f.page.reload();
    await expect(f.page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
    await f.page.getByTestId("options-nav-performance").click();
    await expect(off).toBeChecked();
    await expect(purpose.locator(".options-toggle-state")).toHaveText("オフ · 保存済み");
    await expect(f.page.getByTestId("performance-preset-radio-high")).toBeChecked();
    await f.page.mouse.move(1300, 20);
    await purpose.scrollIntoViewIfNeeded();
    await f.page.screenshot({ path: testInfo.outputPath("cache-purpose-off-saved.png"), fullPage: false, animations: "disabled" });
  } finally { await f.close(); }
});
