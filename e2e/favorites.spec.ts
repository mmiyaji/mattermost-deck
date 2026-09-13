import { test, expect, chromium, type BrowserContext, type Worker } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";

test("favorites persist, sync across tabs, use cached posts offline, and reconcile edits and deletion", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const state = JSON.parse(await fs.readFile(process.env.MM95_STATE_FILE ?? "e2e/mm95-state.json", "utf8"));
  const api = async (method: string, endpoint: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}/api/v4${endpoint}`, {
      method, headers: { Authorization: `Bearer ${state.adminUser.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(response.ok).toBe(true);
    return response.json();
  };
  const channel = await api("GET", `/teams/${state.team.id}/channels/name/town-square`);
  const marker = `favorite-fixture-${Date.now()}`;
  const post = await api("POST", "/posts", { channel_id: channel.id, message: marker });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-favorites-"));
  let context: BrowserContext | undefined;
  let worker: Worker;
  const launch = async () => {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, viewport: { width: 1920, height: 1080 },
      args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
    });
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  };
  // Use Chrome's supported closed-shadow-root API in the content script world
  // so the shipped DOM and click handlers are exercised without opening it.
  const deck = async (tabUrl: string, action: "read" | "star" | "refresh" | "remove" | "controls" | "search" | "focusSearch", pane = "favorites") => {
    return worker.evaluate(async ({ tabUrl, action, pane, marker }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url === tabUrl);
      if (!tab?.id) return null;
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (action, pane, marker) => {
          const host = document.getElementById("mattermost-deck-root");
          const dom = chrome as typeof chrome & { dom: { openOrClosedShadowRoot: (el: Element) => ShadowRoot | null } };
          const root = host && dom.dom.openOrClosedShadowRoot(host);
          const section = root?.querySelector(pane === "favorites" ? ".deck-column--favorites" : '.deck-column--channel');
          if (action === "star") {
            const card = Array.from(section?.querySelectorAll(".deck-post-item") ?? []).find(el => el.textContent?.includes(marker));
            (card?.querySelector(".deck-favorite-button") as HTMLElement | null)?.click();
          } else if (action === "search") {
            (section?.querySelector('.deck-pane-search-toggle') as HTMLElement | null)?.click();
          } else if (action === "focusSearch") {
            (section?.querySelector('.deck-pane-search input') as HTMLElement | null)?.focus();
          } else if (action === "controls") {
            (section?.querySelector('.deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)') as HTMLElement | null)?.click();
          } else if (action === "refresh") {
            (section?.querySelector('[aria-label="Refresh"]') as HTMLElement | null)?.click();
          } else if (action === "remove") {
            (section?.querySelector(".deck-favorites-unavailable button") as HTMLElement | null)?.click();
          }
          return { text: section?.textContent ?? "", searchOpen: section?.querySelector('.deck-pane-search-toggle')?.getAttribute("aria-expanded"), controls: section?.querySelector('.deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)')?.getAttribute("aria-expanded"), count: section?.querySelectorAll(".deck-card--post").length ?? 0,
            error: root?.querySelector('[role="alert"]')?.textContent ?? "" };
        }, args: [action, pane, marker],
      });
      return results[0]?.result ?? null;
    }, { tabUrl, action, pane, marker });
  };
  try {
    await launch();
    await worker!.evaluate(({ baseUrl, channel, team }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": baseUrl,
      "mattermostDeck.language.v1": "en",
      "mattermostDeck.layout.v1": [
        { id: "favorite-watch", type: "channelWatch", channelId: channel.id, teamId: team.id },
        { id: "favorite-pane", type: "favorites" },
      ],
    }), { baseUrl, channel, team: state.team });
    const page = await context!.newPage();
    await page.goto(`${baseUrl}/landing#/login`);
    const browserChoice = page.getByText("View in Browser");
    const login = page.locator('input[name="loginId"], #input_loginId').first();
    await Promise.race([browserChoice.waitFor({ timeout: 15_000 }).catch(() => undefined), login.waitFor({ timeout: 15_000 }).catch(() => undefined)]);
    if (await browserChoice.isVisible()) await browserChoice.click();
    await login.fill(state.memberUser.username);
    await page.locator('input[name="password-input"]').fill(state.memberUser.password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/\/channels\//);
    const url = page.url();
    await expect.poll(async () => (await deck(url, "read", "channel"))?.text).toContain(marker);
    await deck(url, "star", "channel");
    await expect.poll(async () => (await deck(url, "read"))?.text).toContain(marker);
    expect(page.url()).toBe(url);

    const second = await context!.newPage();
    const secondUrl = `${url}?favorites-second-tab=1`;
    await second.goto(secondUrl);
    await expect.poll(async () => (await deck(second.url(), "read"))?.text).toContain(marker);
    await deck(second.url(), "star");
    await expect.poll(async () => (await deck(url, "read"))?.count).toBe(0);
    await deck(url, "star", "channel");
    await expect.poll(async () => (await deck(url, "read"))?.count).toBe(1);
    await context!.close();
    await launch();
    await worker!.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith("mattermostDeck.favorites.v1:")) {
          await chrome.storage.local.set({ [key]: (value as Array<Record<string, unknown>>).map(f => ({ ...f, checkedAt: Date.now() - 6 * 60_000 })) });
        }
      }
    });
    const restored = await context!.newPage();
    await restored.route("**/api/v4/posts/ids", route => route.abort());
    await restored.goto(url);
    await expect.poll(async () => (await deck(url, "read"))?.text).toContain(marker);
    await expect.poll(async () => (await deck(url, "read"))?.error).not.toBe("");
    await restored.unroute("**/api/v4/posts/ids");
    expect((await deck(url, "read"))?.controls).toBe("false");
    await deck(url, "controls");
    await expect.poll(async () => (await deck(url, "read"))?.controls).toBe("true");
    await api("PUT", `/posts/${post.id}/patch`, { message: `${marker} edited` });
    await deck(url, "refresh");
    await expect.poll(async () => (await deck(url, "read"))?.text).toContain(`${marker} edited`);
    const keepOffline = restored.getByRole("button", { name: /No, keep it as.*Offline/i });
    if (await keepOffline.isVisible()) await keepOffline.click();
    await expect(keepOffline).toBeHidden();
    const dismissOnboarding = restored.getByText(/No thanks, I.*figure it out myself/i);
    if (await dismissOnboarding.isVisible()) await dismissOnboarding.click();
    await expect(dismissOnboarding).toBeHidden();
    await expect(restored.locator(".modal-backdrop:visible")).toHaveCount(0);
    await restored.screenshot({ path: testInfo.outputPath("favorites.png"), fullPage: true });
    await deck(url, "search");
    await expect.poll(async () => (await deck(url, "read"))?.searchOpen).toBe("true");
    await deck(url, "focusSearch");
    await restored.keyboard.insertText("no-matching-loaded-post");
    await expect.poll(async () => (await deck(url, "read"))?.count).toBe(0);
    await expect.poll(async () => (await deck(url, "read", "channel"))?.text).toContain(marker);
    await restored.keyboard.press("Control+A");
    await restored.keyboard.insertText("edited");
    await expect.poll(async () => (await deck(url, "read"))?.count).toBe(1);
    await deck(url, "controls");
    await expect.poll(async () => (await deck(url, "read"))?.controls).toBe("false");
    await restored.screenshot({ path: testInfo.outputPath("pane-search.png"), fullPage: true });
    await restored.keyboard.press("Escape");
    await expect.poll(async () => (await deck(url, "read"))?.searchOpen).toBe("false");
    await deck(url, "controls");
    await expect.poll(async () => (await deck(url, "read"))?.controls).toBe("true");
    await api("DELETE", `/posts/${post.id}`);
    await deck(url, "refresh");
    await expect.poll(async () => (await deck(url, "read"))?.count).toBe(0);
    await expect.poll(async () => (await deck(url, "read"))?.text).toContain("unavailable");
    await deck(url, "remove");
    await expect.poll(async () => (await deck(url, "read"))?.text).toContain("Use ☆");
  } finally {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
    await api("DELETE", `/posts/${post.id}`).catch(() => undefined);
  }
});
