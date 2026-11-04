import { chromium, expect, test, type Page, type Worker } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";
import { appendTraceEntries } from "./trace-storage";
import type { TraceLogEntry } from "../src/traceProtocol";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";

async function fixture(language = "en") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-settings-design-"));
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(directory, {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1024 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = await waitForInstalledOptions(context, worker);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await worker.evaluate(async ({ language, baseUrl }) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      "mattermostDeck.language.v1": language,
      "mattermostDeck.theme.v1": "light",
      "mattermostDeck.serverUrl.v1": baseUrl,
    });
  }, { language, baseUrl });
  await page.reload();
  await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
  return { page, worker, errors, async close() { await context.close(); await fs.rm(directory, { recursive: true, force: true }); } };
}

async function noPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    viewport: window.innerWidth, panel: document.querySelector(".options-panel-scroll")!.scrollWidth,
    panelViewport: document.querySelector(".options-panel-scroll")!.clientWidth }));
  if (widths.panel > widths.panelViewport + 1) {
    const diagnostic = await page.evaluate(() => {
      const panel = document.querySelector(".options-panel-scroll")!, right = panel.getBoundingClientRect().right;
      return [...panel.querySelectorAll("*")].map(element => {
        const box = element.getBoundingClientRect();
        return { tag: element.tagName, className: element.getAttribute("class"), right: box.right, width: box.width,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, text: element.textContent?.slice(0, 70) };
      }).filter(element => element.right > right + 1).slice(0, 50);
    });
    await fs.writeFile(test.info().outputPath(`overflow-${widths.viewport}.json`), JSON.stringify({ widths, diagnostic }, null, 2));
    await page.screenshot({ path: test.info().outputPath(`overflow-${widths.viewport}.png`), fullPage: false, animations: "disabled" });
  }
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  expect(widths.panel).toBeLessThanOrEqual(widths.panelViewport + 1);
}

async function seedTraces(context: import("@playwright/test").BrowserContext, worker: Worker) {
  const end = Date.now();
  const entries: Array<TraceLogEntry & { payload: Record<string, unknown> }> = Array.from({ length: 500 }, (_, i) => {
    const failed = i % 4 === 0;
    const transport = i % 20 === 0;
    return { id: `design-trace-${i}`, timestamp: end - i * 2000, source: "api", level: failed ? "error" : "info",
      event: transport ? "request.error" : "request.complete", payload: {
        method: i % 2 ? "POST" : "GET", path: `/posts/fixture-${i}`, fullPath: `/api/v4/posts/fixture-${i}?fixture=design`,
        purpose: "Fixture post lookup", reason: "settings-drilldown-fixture", durationMs: 500 + i, queueWaitMs: 100 + i,
        queueDepth: i % 40, failed, ...(transport ? { error: `network-unavailable-${i}` } : { status: failed ? [403, 429, 500][Math.floor(i / 4) % 3] : 200 }),
      } };
  });
  await appendTraceEntries(context, worker, entries);
  return { end, entries, failed: entries.filter(entry => entry.payload.failed).length };
}

test("settings use the selected navy and white shell and keep the appearance preview bounded at desktop and narrow sizes", async ({}, testInfo) => {
  const f = await fixture("ja");
  const { page } = f;
  try {
    await page.getByTestId("options-nav-behavior").click();
    await page.mouse.move(1300, 20);
    await expect(page.getByTestId("options-nav-behavior")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("options-nav-conn")).not.toHaveAttribute("aria-current", "page");
    const navigation = await page.evaluate(() => ({ active: getComputedStyle(document.querySelector('[data-testid="options-nav-behavior"]')!).backgroundColor,
      inactive: getComputedStyle(document.querySelector('[data-testid="options-nav-conn"]')!).backgroundColor }));
    expect(navigation.active).not.toBe(navigation.inactive);
    const fonts = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(document.querySelector(".options-panel-header h2")!).fontFamily }));
    await fs.writeFile(testInfo.outputPath("settings-computed-fonts.json"), JSON.stringify(fonts, null, 2));
    const styleEvidence = await page.evaluate(async () => {
      const roots = [document.documentElement, document.body];
      const navs = ["behavior", "conn"].map(id => document.querySelector(`[data-testid="options-nav-${id}"]`)!);
      const targets = [...roots, ...navs];
      const matched: Array<{ sheet: string | null; selector: string; css: string; targets: number[] }> = [];
      const walk = (rules: CSSRuleList, sheet: string | null) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) {
            if (!rule.style.fontFamily && !rule.style.background && !rule.style.backgroundColor && !rule.style.color) continue;
            const indexes = targets.flatMap((element, index) => {
              try { return element.matches(rule.selectorText) ? [index] : []; } catch { return []; }
            });
            if (indexes.length) matched.push({ sheet, selector: rule.selectorText, css: rule.style.cssText, targets: indexes });
          } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules, sheet);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try { walk(sheet.cssRules, sheet.href ?? (sheet.ownerNode as HTMLElement | null)?.id ?? "inline"); } catch { /* No cross-origin sheet content access. */ }
      }
      const scripts = await Promise.all(Array.from(document.scripts).filter(script => script.src).map(async script => {
        const response = await fetch(script.src);
        const text = await response.text();
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return { src: script.src, status: response.status, bytes: new TextEncoder().encode(text).byteLength,
          sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
          hasYuGothic: text.includes('"Yu Gothic UI"'), hasArialMeiryo: text.includes('Arial, Meiryo'),
          fontSnippets: [...text.matchAll(/font-family[^;]{0,150};/g)].map(match => match[0]).slice(-15) };
      }));
      return { root: { style: document.documentElement.getAttribute("style"), dataTheme: document.documentElement.getAttribute("data-theme"), font: getComputedStyle(document.documentElement).fontFamily },
        body: { style: document.body.getAttribute("style"), dataTheme: document.body.getAttribute("data-theme"), font: getComputedStyle(document.body).fontFamily },
        activeElement: document.activeElement?.outerHTML.slice(0, 500),
        navigation: navs.map(element => ({ id: element.getAttribute("data-testid"), className: element.className, style: element.getAttribute("style"), ariaCurrent: element.getAttribute("aria-current"),
          hover: element.matches(":hover"), focus: element.matches(":focus"), focusVisible: element.matches(":focus-visible"),
          background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, font: getComputedStyle(element).fontFamily })),
        styleElements: Array.from(document.querySelectorAll("style")).map(element => ({ id: element.id, length: element.textContent?.length,
          fontSnippets: [...(element.textContent ?? "").matchAll(/font-family[^;]{0,150};/g)].map(match => match[0]) })), matched, scripts };
    });
    await fs.writeFile(testInfo.outputPath("settings-style-evidence.json"), JSON.stringify(styleEvidence, null, 2));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    const documentNode = await cdp.send("DOM.getDocument");
    const bodyNode = await cdp.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "body" });
    const bodyStyles = await cdp.send("CSS.getMatchedStylesForNode", { nodeId: bodyNode.nodeId });
    const headingNode = await cdp.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: ".options-panel-header h2" });
    const platformFonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: headingNode.nodeId });
    const fontRules = bodyStyles.matchedCSSRules?.flatMap(match => {
      const declarations = match.rule.style.cssProperties.filter(property => ["font", "font-family"].includes(property.name));
      return declarations.length ? [{ origin: match.rule.origin, selector: match.rule.selectorList.text, declarations }] : [];
    });
    await fs.writeFile(testInfo.outputPath("settings-ua-font-evidence.json"), JSON.stringify({ fontRules, headingFonts: platformFonts.fonts }, null, 2));
    await cdp.detach();
    const bundle = await fs.readFile("dist/options.js");
    const { createHash } = await import("node:crypto");
    await fs.writeFile(testInfo.outputPath("dist-options-evidence.json"), JSON.stringify({ bytes: bundle.length,
      sha256: createHash("sha256").update(bundle).digest("hex"), hasYuGothic: bundle.toString().includes('"Yu Gothic UI"'), hasArialMeiryo: bundle.toString().includes("Arial, Meiryo") }, null, 2));
    const colors = await page.evaluate(() => ({ header: getComputedStyle(document.querySelector(".options-topbar")!).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor }));
    expect(colors.header).not.toBe(colors.body);
    expect(colors.body).toBe("rgb(255, 255, 255)");
    await page.screenshot({ path: testInfo.outputPath("settings-option-one-behavior-light.png"), fullPage: false, animations: "disabled" });
    const behaviorLeft = (await page.locator(".options-panel-header").boundingBox())!.x;
    await page.getByTestId("options-nav-appearance").click();
    const appearanceLeft = (await page.locator(".options-panel-header").boundingBox())!.x;
    expect(Math.abs(behaviorLeft - appearanceLeft)).toBeLessThanOrEqual(1);
    const fields = page.locator('input[type="number"]');
    // The three labeled fields keep actual configured dimensions in the sample.
    await page.getByRole("spinbutton", { name: /フォントサイズ|Font Size/ }).fill("140");
    await page.getByRole("spinbutton", { name: /デッキ全体の幅|Whole Deck width/ }).fill("1400");
    await page.getByRole("spinbutton", { name: /個別ペインの幅|Individual pane width/ }).fill("800");
    await expect(page.getByTestId("appearance-preview-deck")).toHaveCSS("width", "1400px");
    await expect(page.getByTestId("appearance-preview-deck")).toHaveCSS("font-size", "19.6px");
    await expect(page.getByTestId("appearance-preview-pane").first()).toHaveCSS("width", "800px");
    expect(await fields.count()).toBeGreaterThanOrEqual(3);
    const imageToggle = page.locator('input[aria-labelledby="image-previews-label"]');
    await expect(page.locator(".options-preview-post img")).toHaveCount(2);
    await imageToggle.uncheck();
    await expect(page.locator(".options-preview-post img")).toHaveCount(0);
    await expect(page.locator(".options-preview-file")).toHaveCount(2);
    const compactToggle = page.locator('input[aria-labelledby="compact-mode-label"]');
    await compactToggle.check();
    await expect(page.locator(".options-preview-post--compact")).toHaveCount(4);
    await compactToggle.uncheck(); await imageToggle.check();
    await expect(page.locator(".options-preview-post img")).toHaveCount(2);
    await page.locator('.options-color-grid input[type="color"]').nth(2).fill("#654321");
    await page.locator(".options-subsection").filter({ has: page.locator(".options-color-grid") }).getByRole("checkbox").check();
    await expect(page.getByTestId("appearance-preview-pane").first()).toContainText("DM");
    await expect(page.getByTestId("appearance-preview-type-icon").first()).toHaveCSS("color", "rgb(101, 67, 33)");
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1024 });
      await noPageOverflow(page);
      const preview = await page.getByTestId("appearance-preview-viewport").boundingBox();
      expect(preview).not.toBeNull();
      expect(preview!.x).toBeGreaterThanOrEqual(0);
      expect(preview!.x + preview!.width).toBeLessThanOrEqual(width + 1);
      const footer = await page.getByTestId("options-save").boundingBox();
      expect(footer!.x + footer!.width).toBeLessThanOrEqual(width + 1);
      const geometry = await page.evaluate(() => {
        const controls = document.querySelector(".options-appearance-controls")!.getBoundingClientRect();
        const preview = document.querySelector(".options-appearance-preview")!.getBoundingClientRect();
        return { controls: { left: controls.left, right: controls.right, top: controls.top, bottom: controls.bottom },
          preview: { left: preview.left, right: preview.right, top: preview.top, bottom: preview.bottom } };
      });
      const horizontal = geometry.preview.left >= geometry.controls.right - 1;
      const vertical = geometry.preview.top >= geometry.controls.bottom - 1;
      expect(horizontal || vertical).toBe(true);
      if (width >= 1280) await page.locator(".options-panel-scroll").evaluate(element => { element.scrollTop = 0; });
      else await page.getByTestId("appearance-preview-viewport").scrollIntoViewIfNeeded();
      await page.mouse.move(Math.min(width - 12, 1300), 20);
      await page.screenshot({ path: testInfo.outputPath(`settings-appearance-${width}.png`), fullPage: false, animations: "disabled" });
    }
    await page.setViewportSize({ width: 1440, height: 1024 });
    await f.worker.evaluate(() => chrome.storage.local.set({ "mattermostDeck.theme.v1": "dark" }));
    await page.reload();
    await page.getByTestId("options-nav-appearance").click();
    await expect(page.getByTestId("appearance-preview-deck")).toHaveAttribute("data-theme", "dark");
    await noPageOverflow(page);
    await page.mouse.move(1300, 20);
    await page.screenshot({ path: testInfo.outputPath("settings-appearance-dark.png"), fullPage: false, animations: "disabled" });
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test("failed requests drill down from the metric and chart into filtered, paged and expandable request details", async ({}, testInfo) => {
  const f = await fixture();
  const { page } = f;
  try {
    const data = await seedTraces(f.page.context(), f.worker);
    await page.reload();
    await page.getByTestId("options-nav-performance").click();
    const metric = page.getByTestId("performance-failed-metric");
    await expect(metric).toContainText(`${data.failed} / 500`);
    await page.mouse.move(1300, 20);
    await page.screenshot({ path: testInfo.outputPath("performance-overview-top.png"), fullPage: false, animations: "disabled" });
    await metric.focus();
    await metric.press("Enter");
    const rows = page.getByTestId("performance-request-row");
    await expect(rows).toHaveCount(50);
    await expect(page.getByTestId("performance-filter-failed")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("performance-request-expand").first().click();
    await expect(page.getByTestId("performance-request-expanded")).toContainText("network-unavailable-0");
    await expect(page.getByTestId("performance-request-expanded")).toContainText("settings-drilldown-fixture");
    await page.getByTestId("performance-page-next").click();
    await expect(rows).toHaveCount(50);
    await page.getByTestId("performance-page-previous").click();
    await expect(rows.first()).toContainText("fixture-0");
    await page.getByTestId("performance-reset-filters").click();
    await expect(page.getByTestId("performance-filter-all")).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(50);
    const lastMinute = Math.floor(data.end / 60_000) * 60_000;
    const binMinutes = Math.ceil((24 * 60) / 299);
    const binMs = binMinutes * 60_000;
    const selectedBinStart = Math.floor(lastMinute / binMs) * binMs;
    const selectedBinEnd = selectedBinStart + binMs;
    const expectedLastBin = data.entries.filter(entry => entry.payload.failed && entry.timestamp >= selectedBinStart && entry.timestamp < selectedBinEnd);
    const redBar = page.getByTestId("performance-chart-count").locator(".recharts-bar").last().locator(".recharts-bar-rectangle path").last();
    await expect(redBar).toBeVisible();
    await redBar.click();
    await expect(page.getByTestId("performance-time-filter")).toHaveValue(String(selectedBinStart));
    await expect(page.getByTestId("performance-time-filter").locator("option:checked")).toContainText(/グラフ期間|chart range/);
    await expect(page.getByTestId("performance-filter-failed")).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(expectedLastBin.length);
    const earlierMinute = lastMinute - 60_000;
    const timeFilter = page.getByTestId("performance-time-filter");
    await timeFilter.focus();
    await timeFilter.press("Home");
    await timeFilter.press("ArrowDown");
    const firstChartMinute = lastMinute - 19 * 60_000;
    await expect(timeFilter).toHaveValue(String(firstChartMinute));
    await expect(rows).toHaveCount(data.entries.filter(entry => entry.payload.failed && entry.timestamp >= firstChartMinute && entry.timestamp < firstChartMinute + 60_000).length);
    await timeFilter.press("End");
    await timeFilter.press("ArrowUp");
    await expect(timeFilter).toHaveValue(String(earlierMinute));
    await expect(rows).toHaveCount(data.entries.filter(entry => entry.payload.failed && entry.timestamp >= earlierMinute && entry.timestamp < earlierMinute + 60_000).length);
    await page.getByTestId("performance-reset-filters").click();
    await page.getByTestId("performance-status-filter").selectOption("no-http");
    await expect(rows).toHaveCount(25);
    await expect(rows.first()).toContainText("No / unknown HTTP response");
    await page.getByTestId("performance-status-filter").selectOption("429");
    await expect(rows.first()).toContainText("HTTP 429");
    await page.getByTestId("performance-filter-failed").click();
    await page.getByTestId("performance-status-filter").selectOption("200");
    await expect(page.getByTestId("performance-request-empty")).toBeVisible();
    await page.getByTestId("performance-reset-filters").click();
    await metric.click();
    await page.getByTestId("performance-request-expand").first().click();
    await page.screenshot({ path: testInfo.outputPath("performance-failure-drilldown.png"), fullPage: false, animations: "disabled" });
    for (const width of [900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await noPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`performance-drilldown-${width}.png`), fullPage: false, animations: "disabled" });
    }
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
