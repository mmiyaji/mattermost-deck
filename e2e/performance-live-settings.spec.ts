import { chromium, expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PERFORMANCE_DEFAULTS, type PerformanceSettings } from "../src/performanceSettings";
import { waitForInstalledOptions } from "./extension-install";

async function debugRequest<T>(page: Page, action: string): Promise<T | null> {
  return page.evaluate(({ action }) => new Promise<T | null>((resolve) => {
    const id = `performance-settings-${Math.random().toString(36).slice(2)}`;
    const finish = (result: T | null) => {
      clearTimeout(timer);
      window.removeEventListener("mattermost-deck-debug-response", listener);
      resolve(result);
    };
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; result?: T }>).detail;
      if (detail?.id === id) finish(detail.result ?? null);
    };
    const timer = setTimeout(() => finish(null), 2000);
    window.addEventListener("mattermost-deck-debug-response", listener);
    window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", { detail: { id, action } }));
  }), { action });
}

test("active profile performance changes apply to an open Deck and persist after reload", async () => {
  const user = { id: "u".repeat(26), username: "performance-user", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith("/api/")) {
      response.setHeader("Content-Type", "text/html");
      response.end('<html><body class="app__body"><div id="root"><div id="SidebarContainer">Test workspace</div><main class="app__content"><h1 class="channel-header">Performance fixture</h1></main></div></body></html>');
      return;
    }
    const payload = pathname.endsWith("/users/me") ? user
      : pathname.endsWith("/users/me/teams") ? [team]
      : pathname.endsWith("/config/client") ? { CollapsedThreads: "disabled" }
      : pathname.endsWith("/system/ping") ? { status: "OK" }
      : [];
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profileDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-live-performance-settings-"));
  const extensionPath = path.resolve("./dist");
  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium", headless: true,
    viewport: { width: 1600, height: 1000 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await waitForInstalledOptions(context, worker);
    await worker.evaluate((origin) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin,
      "mattermostDeck.language.v1": "en",
      "mattermostDeck.theme.v1": "light",
      "mattermostDeck.layout.v1": [{ id: "diagnostics", type: "diagnostics" }],
    }), origin);
    const page = await context.newPage();
    await page.addInitScript(() => window.localStorage.setItem("mattermostDeck.debugLogs", "1"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = `${origin}/testteam/channels/town-square`;
    await page.goto(url);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 15_000 });
    await expect.poll(() => debugRequest<PerformanceSettings>(page, "getPerformanceSettings"), { timeout: 15_000 })
      .toMatchObject(PERFORMANCE_DEFAULTS);
    await expect.poll(async () => (await debugRequest<{ columns?: { id: string; type: string }[] }>(page, "getState"))?.columns)
      .toEqual([expect.objectContaining({ id: "diagnostics", type: "diagnostics" })]);

    const initialDocumentTime = await page.evaluate(() => performance.timeOrigin);
    const activeProfileId = await worker.evaluate(async (origin) => {
      const stored = await chrome.storage.local.get("mattermostDeck.profiles.v1");
      const registry = stored["mattermostDeck.profiles.v1"] as {
        activeProfileIdByOrigin?: Record<string, string>;
        lastActiveProfileId?: string;
      } | undefined;
      const id = registry?.activeProfileIdByOrigin?.[origin] ?? registry?.lastActiveProfileId;
      if (!id) throw new Error("The open Deck did not initialize an active profile");
      await chrome.storage.local.set({
        [`mattermostDeck.apiMaxConcurrentRequests.v1.profile.${id}`]: "2",
        [`mattermostDeck.apiGetRequestsPerMinute.v1.profile.${id}`]: "300",
      });
      return id;
    }, origin);
    const modified = { ...PERFORMANCE_DEFAULTS, apiMaxConcurrentRequests: 2, apiGetRequestsPerMinute: 300 };
    await expect.poll(() => debugRequest<PerformanceSettings>(page, "getPerformanceSettings"), { timeout: 10_000 })
      .toMatchObject(modified);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(initialDocumentTime);
    expect(page.url()).toBe(url);

    await page.reload();
    await expect.poll(() => debugRequest<PerformanceSettings>(page, "getPerformanceSettings"), { timeout: 15_000 })
      .toMatchObject(modified);
    const reloadedDocumentTime = await page.evaluate(() => performance.timeOrigin);
    expect(reloadedDocumentTime).not.toBe(initialDocumentTime);

    await worker.evaluate(async ({ id, defaults }) => {
      await chrome.storage.local.set(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
        `mattermostDeck.${key}.v1.profile.${id}`, String(value),
      ])));
    }, { id: activeProfileId, defaults: PERFORMANCE_DEFAULTS });
    await expect.poll(() => debugRequest<PerformanceSettings>(page, "getPerformanceSettings"), { timeout: 10_000 })
      .toMatchObject(PERFORMANCE_DEFAULTS);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(reloadedDocumentTime);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(profileDirectory, { recursive: true, force: true });
  }
});
