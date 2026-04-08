import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");

interface E2EState {
  memberUser: { username: string; password: string };
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
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

test("can add, move, and remove panes through the deck state bridge", async () => {
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-pane-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await sw.evaluate((serverUrl: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ "mattermostDeck.serverUrl.v1": serverUrl }, () => resolve());
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

    const initial = (await debugRequest<{ columns: Array<{ id: string; type: string }> }>(page, "getState")).columns;
    const mentionsId = await debugRequest<string>(page, "addColumn", { type: "mentions" });
    const channelId = await debugRequest<string>(page, "addColumn", { type: "channelWatch" });
    const savedId = await debugRequest<string>(page, "addColumn", { type: "saved" });

    expect(mentionsId).toBeTruthy();
    expect(channelId).toBeTruthy();
    expect(savedId).toBeTruthy();

    await expect
      .poll(async () => {
        return (await debugRequest<{ columns: Array<{ type: string }> }>(page, "getState")).columns.map((column) => column.type);
      }, { timeout: 20_000 })
      .toEqual([...initial.map((column: { type: string }) => column.type), "mentions", "channelWatch", "saved"]);

    const beforeMove = (await debugRequest<{ columns: Array<{ id: string }> }>(page, "getState")).columns.map((column) => column.id);
    await debugRequest(page, "moveColumn", { id: savedId, direction: "left" });

    await expect
      .poll(async () => {
        return (await debugRequest<{ columns: Array<{ id: string }> }>(page, "getState")).columns.map((column) => column.id);
      }, { timeout: 10_000 })
      .not.toEqual(beforeMove);

    await debugRequest(page, "moveColumn", { id: savedId, direction: "right" });
    await expect
      .poll(async () => {
        return (await debugRequest<{ columns: Array<{ id: string }> }>(page, "getState")).columns.map((column) => column.id);
      }, { timeout: 10_000 })
      .toEqual(beforeMove);

    await debugRequest(page, "removeColumn", { id: savedId });
    await expect
      .poll(async () => {
        return (await debugRequest<{ columns: Array<{ id: string }> }>(page, "getState")).columns.some((column) => column.id === savedId);
      }, { timeout: 10_000 })
      .toBe(false);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
