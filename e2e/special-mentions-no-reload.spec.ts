import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const ADMIN_USERNAME = "mm95admin";
const ADMIN_PASSWORD = "Admin1234!";
const TRACE_CAPTURE_STORAGE_KEY = "mattermostDeck.traceCapture.v1";
const TRACE_LOG_STORAGE_KEY = "mattermostDeck.traceEntries.v1";
const LAYOUT_STORAGE_KEY = "mattermostDeck.layout.v1";

interface E2EState {
  team: { id: string; name: string };
  memberUser: { id: string; username: string; password: string; token: string };
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
}

async function loginViaApi(username: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: username, password }),
  });
  if (!response.ok) {
    throw new Error(`login failed with ${response.status}`);
  }
  const token = response.headers.get("Token");
  if (!token) {
    throw new Error("missing token header");
  }
  return token;
}

async function apiGet<T>(token: string, pathname: string): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GET ${pathname} failed with ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
}

async function apiPost<T>(token: string, pathname: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`POST ${pathname} failed with ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
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

const specialMentions = ["@here", "@channel"] as const;

for (const specialMention of specialMentions) {
  test(`special mention ${specialMention} does not remount the extension`, async () => {
    const state = await readState();
    const extensionPath = path.resolve("./dist");
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-special-mentions-reload-"));
    const adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
    const createdChannelIds: string[] = [];
    let postId = "";

    const timestamp = Date.now();
    for (const index of [1, 2]) {
      const channel = await apiPost<{ id: string; name: string }>(adminToken, "/channels", {
        team_id: state.team.id,
        name: `special-${timestamp}-${index}`,
        display_name: `Special ${timestamp} ${index}`,
        type: "O",
      });
      createdChannelIds.push(channel.id);
      await apiPost(adminToken, `/channels/${channel.id}/members`, {
        user_id: state.memberUser.id,
      });
    }

    const channels = await apiGet<Array<{ id: string; name: string }>>(adminToken, `/teams/${state.team.id}/channels`);
    const townSquare = channels.find((channel) => channel.name === "town-square");
    expect(townSquare).toBeTruthy();

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

      await sw.evaluate(({ serverUrl, traceCaptureStorageKey, traceLogStorageKey, layoutStorageKey }) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.set({
            "mattermostDeck.serverUrl.v1": serverUrl,
            [traceCaptureStorageKey]: true,
            [traceLogStorageKey]: [],
            [layoutStorageKey]: [{ id: "mentions", type: "mentions" }],
          }, () => resolve());
        });
      }, {
        serverUrl: baseUrl,
        traceCaptureStorageKey: TRACE_CAPTURE_STORAGE_KEY,
        traceLogStorageKey: TRACE_LOG_STORAGE_KEY,
        layoutStorageKey: LAYOUT_STORAGE_KEY,
      });

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
        }, { timeout: 30_000 })
        .toBe("ready");

      const stateSnapshot = await debugRequest<{ columns: Array<{ id: string; type: string }> }>(page, "getState");
      const mentionsColumn = stateSnapshot.columns.find((column) => column.type === "mentions");
      expect(mentionsColumn).toBeTruthy();

      await expect
        .poll(async () => {
          const columnState = await debugRequest<{ postStatus?: string } | null>(page, "getColumnState", { id: mentionsColumn!.id });
          return columnState?.postStatus ?? "missing";
        }, { timeout: 30_000 })
        .toBe("ready");

      const rootMarker = `deck-root-${Date.now()}`;
      await page.evaluate((marker: string) => {
        const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
        if (!root) {
          throw new Error("deck root not found");
        }
        root.dataset.e2eMarker = marker;
      }, rootMarker);

      const marker = `special-mention-no-reload-${specialMention.replace("@", "")}-${Date.now()}`;
      const created = await apiPost<{ id: string }>(adminToken, "/posts", {
        channel_id: townSquare!.id,
        message: `Deck websocket special mention ${specialMention} ${marker}`,
      });
      postId = created.id;

      await expect
        .poll(async () => {
          const columnState = await debugRequest<{ postMessages?: string[] } | null>(page, "getColumnState", { id: mentionsColumn!.id });
          return columnState?.postMessages ?? [];
        }, { timeout: 60_000 })
        .toContainEqual(expect.stringContaining(marker));

      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
            return {
              marker: root?.dataset.e2eMarker ?? null,
              rootCount: document.querySelectorAll("#mattermost-deck-root").length,
            };
          });
        }, { timeout: 30_000 })
        .toEqual({ marker: rootMarker, rootCount: 1 });
    } finally {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
      if (postId) {
        await apiDelete(adminToken, `/posts/${postId}`);
      }
      for (const channelId of createdChannelIds) {
        await apiDelete(adminToken, `/channels/${channelId}`);
      }
    }
  });
}
