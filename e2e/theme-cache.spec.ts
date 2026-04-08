import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");

interface Mm95State {
  memberUser: { username: string; password: string };
}

interface ThemeState {
  initialSource: "cache" | "extract" | "none";
  activeTheme: string;
  style: Record<string, string>;
  cacheKey: string | null;
  cachedStyle: Record<string, string> | null;
}

async function readState(): Promise<Mm95State> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as Mm95State;
}

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto(`${baseUrl}/landing#/login`);
  const browserChoice = page.getByText("View in Browser");
  const loginId = page.locator('input[name="loginId"]');

  await Promise.race([
    browserChoice.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    loginId.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
  ]);

  if (await browserChoice.isVisible().catch(() => false)) {
    await browserChoice.click();
  }

  await loginId.waitFor({ state: "visible", timeout: 30_000 });
  await loginId.fill(username);
  await page.locator('input[name="password-input"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/channels|messages/, { timeout: 30_000 });
}

async function debugRequest<T>(
  page: import("@playwright/test").Page,
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return await page.evaluate(({ action, payload }) => {
    return new Promise<T>((resolve) => {
      const id = `deck-debug-${Math.random().toString(36).slice(2)}`;
      const handleResponse = (event: Event) => {
        const customEvent = event as CustomEvent<{ id?: string; result?: T }>;
        if (customEvent.detail?.id !== id) {
          return;
        }
        window.removeEventListener("mattermost-deck-debug-response", handleResponse as EventListener);
        resolve(customEvent.detail?.result as T);
      };
      window.addEventListener("mattermost-deck-debug-response", handleResponse as EventListener);
      window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", {
        detail: { id, action, payload },
      }));
    });
  }, { action, payload });
}

test("caches Mattermost theme styles and reuses them on reload", async () => {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-theme-cache-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const state = await readState();
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });

    await sw.evaluate((serverUrl: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            "mattermostDeck.serverUrl.v1": serverUrl,
            "mattermostDeck.theme.v1": "mattermost",
          },
          () => resolve(),
        );
      });
    }, baseUrl);

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
    });

    await login(page, state.memberUser.username, state.memberUser.password);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect
      .poll(async () => {
        const result = await debugRequest<{ stateStatus?: string }>(page, "getState");
        return result?.stateStatus ?? "missing";
      }, { timeout: 20_000 })
      .toBe("ready");

    await expect
      .poll(async () => {
        const themeState = await debugRequest<ThemeState>(page, "getThemeState");
        return Object.keys(themeState.style).length;
      }, { timeout: 20_000 })
      .toBeGreaterThan(0);

    const firstThemeState = await debugRequest<ThemeState>(page, "getThemeState");
    expect(firstThemeState.activeTheme).toBe("mattermost");
    expect(firstThemeState.initialSource).toBe("extract");
    expect(firstThemeState.cacheKey).toBeTruthy();
    expect(Object.keys(firstThemeState.style)).toContain("--deck-button-bg");

    const cachedRawAfterFirstLoad = await page.evaluate((cacheKey) => {
      return cacheKey ? window.localStorage.getItem(cacheKey) : null;
    }, firstThemeState.cacheKey);
    expect(cachedRawAfterFirstLoad).toBeTruthy();

    await page.evaluate(() => {
      document.documentElement.style.setProperty("--button-bg", "rgb(12, 34, 210)");
    });

    await expect
      .poll(async () => {
        const themeState = await debugRequest<ThemeState>(page, "getThemeState");
        return themeState.style["--deck-button-bg"] ?? null;
      }, { timeout: 20_000 })
      .toBe("rgb(12, 34, 210)");

    const cachedRawAfterUpdate = await page.evaluate((cacheKey) => {
      return cacheKey ? window.localStorage.getItem(cacheKey) : null;
    }, firstThemeState.cacheKey);
    expect(cachedRawAfterUpdate).toContain("\"--deck-button-bg\":\"rgb(12, 34, 210)\"");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect
      .poll(async () => {
        const result = await debugRequest<{ stateStatus?: string }>(page, "getState");
        return result?.stateStatus ?? "missing";
      }, { timeout: 20_000 })
      .toBe("ready");

    const reloadedThemeState = await debugRequest<ThemeState>(page, "getThemeState");
    expect(reloadedThemeState.initialSource).toBe("cache");
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
