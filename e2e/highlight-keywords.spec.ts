import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.CAB_MATTERMOST_E2E_STATE_FILE ?? path.resolve("e2e/mm95-compat-state.json");

interface E2EState {
  team: { id: string; name: string };
  memberUser: { username: string; password: string; token: string };
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
}

async function apiGet<T>(token: string, pathname: string): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${pathname} failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

async function apiPost<T>(token: string, pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${pathname} failed with ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function apiDelete(token: string, pathname: string): Promise<void> {
  await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
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

test("highlight keywords are rendered inside deck posts", async () => {
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-highlight-"));
  const ignoredKeyword = `deploy-${Date.now()}`;
  const keyword = `urgent-${Date.now()}`;
  let postId = "";

  const channels = await apiGet<Array<{ id: string; name: string }>>(state.memberUser.token, `/users/me/teams/${state.team.id}/channels`);
  const townSquare = channels.find((channel) => channel.name === "town-square");
  expect(townSquare).toBeTruthy();

  const created = await apiPost<{ id: string }>(state.memberUser.token, "/posts", {
    channel_id: townSquare!.id,
    message: `Deck keyword highlight check ${keyword}`,
  });
  postId = created.id;

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
    await sw.evaluate(({ serverUrl, ignoredKeyword, keyword }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          "mattermostDeck.highlightKeywords.v1": `${ignoredKeyword}、${keyword}`,
        }, () => resolve());
      });
    }, { serverUrl: baseUrl, ignoredKeyword, keyword });

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
      }, { timeout: 60_000 })
      .toBe("ready");

    const columnId = await debugRequest<string>(page, "addColumn", { type: "channelWatch" });
    await debugRequest(page, "updateColumn", {
      id: columnId,
      patch: { teamId: state.team.id, channelId: townSquare!.id },
    });

    await expect
      .poll(async () => {
        return await debugRequest<string[]>(page, "getHighlightTexts");
      }, { timeout: 30_000 })
      .toContain(keyword);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    if (postId) {
      await apiDelete(state.memberUser.token, `/posts/${postId}`);
    }
  }
});
