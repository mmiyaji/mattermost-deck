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
  teamName: string;
  memberUser: { id: string; username: string; password: string; token: string };
}

interface TraceEntry {
  timestamp: number;
  source: string;
  event: string;
  payload?: {
    purpose?: string;
    path?: string;
    fullPath?: string;
  };
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
    throw new Error(`GET ${pathname} failed with ${response.status}`);
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

test("all-teams mentions staggers team search fan-out", async () => {
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-mentions-fanout-"));
  const adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const createdTeamIds: string[] = [];

  const timestamp = Date.now();
  for (const index of [1, 2]) {
    const team = await apiPost<{ id: string; name: string }>(adminToken, "/teams", {
      name: `fanout${timestamp}${index}`,
      display_name: `Fanout ${timestamp} ${index}`,
      type: "O",
    });
    createdTeamIds.push(team.id);
    await apiPost(adminToken, `/teams/${team.id}/members`, {
      team_id: team.id,
      user_id: state.memberUser.id,
    });
  }

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

    await expect
      .poll(async () => {
        const entries = await sw.evaluate((traceLogStorageKey: string) => {
          return new Promise<TraceEntry[]>((resolve) => {
            chrome.storage.local.get(traceLogStorageKey, (payload) => {
              resolve((payload[traceLogStorageKey] as TraceEntry[] | undefined) ?? []);
            });
          });
        }, TRACE_LOG_STORAGE_KEY);
        return entries.filter((entry) => entry.source === "api" && entry.event === "request.complete" && entry.payload?.purpose === "Team post search").length;
      }, {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(3);

    const traceEntries = await sw.evaluate((traceLogStorageKey: string) => {
      return new Promise<TraceEntry[]>((resolve) => {
        chrome.storage.local.get(traceLogStorageKey, (payload) => {
          resolve((payload[traceLogStorageKey] as TraceEntry[] | undefined) ?? []);
        });
      });
    }, TRACE_LOG_STORAGE_KEY);

    const teamSearchEntries = (traceEntries as TraceEntry[])
      .filter((entry) => entry.source === "api" && entry.event === "request.complete" && entry.payload?.purpose === "Team post search")
      .sort((left, right) => left.timestamp - right.timestamp);

    expect(teamSearchEntries.length).toBeGreaterThanOrEqual(3);

    const gaps = teamSearchEntries
      .slice(1)
      .map((entry, index) => entry.timestamp - teamSearchEntries[index].timestamp);

    expect(gaps.some((gap) => gap >= 150)).toBe(true);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    for (const teamId of createdTeamIds) {
      await apiDelete(adminToken, `/teams/${teamId}`);
    }
  }
});
