import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const TRACE_CAPTURE_STORAGE_KEY = "mattermostDeck.traceCapture.v1";
const TRACE_LOG_STORAGE_KEY = "mattermostDeck.traceEntries.v1";
const LAYOUT_STORAGE_KEY = "mattermostDeck.layout.v1";

interface E2EState {
  baseUrl: string;
  teamName: string;
  memberUser: { id: string; username: string; password: string; token: string };
}

interface TraceLogEntry {
  source: "app" | "content" | "api" | "ws";
  event: string;
  payload?: Record<string, unknown>;
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

async function loginApi(username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: username, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed with ${res.status}`);
  }
  const token = res.headers.get("Token");
  if (!token) {
    throw new Error("Missing API token");
  }
  return token;
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
    await page.locator("a.btn.btn-tertiary.btn-lg").click();
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
    return new Promise<T>((resolve, reject) => {
      const id = `deck-debug-${Math.random().toString(36).slice(2)}`;
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener("mattermost-deck-debug-response", handleResponse as EventListener);
        reject(new Error(`Deck debug request timed out: ${action}`));
      }, 5_000);
      const handleResponse = (event: Event) => {
        const customEvent = event as CustomEvent<{ id?: string; result?: T }>;
        if (customEvent.detail?.id !== id) {
          return;
        }
        window.clearTimeout(timeoutId);
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

test("switching channels keeps Deck panes mounted and avoids a full refetch", async () => {
  const state = await readState();
  const token = await loginApi(state.memberUser.username, state.memberUser.password);
  const extensionPath = path.resolve("./dist");

  const teams = await apiGet<Array<{ id: string; name: string }>>(token, "/users/me/teams");
  const team = teams.find((entry) => entry.name === state.teamName);
  expect(team).toBeTruthy();

  const channels = await apiGet<Array<{ id: string; name: string }>>(token, `/users/me/teams/${team!.id}/channels`);
  const townSquare = channels.find((entry) => entry.name === "town-square");
  const offTopic = channels.find((entry) => entry.name === "off-topic");
  expect(townSquare).toBeTruthy();
  expect(offTopic).toBeTruthy();

  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-route-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const appStateRequests: string[] = [];
  let capture = false;
  context.on("request", (request) => {
    if (!capture) {
      return;
    }
    const url = request.url();
    if (
      url === `${baseUrl}/api/v4/users/me` ||
      url === `${baseUrl}/api/v4/users/me/teams` ||
      url.includes("/teams/unread") ||
      url.includes(`/api/v4/teams/name/${state.teamName}`)
    ) {
      appStateRequests.push(`${request.method()} ${url}`);
    }
  });

  try {
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await sw.evaluate(({
      serverUrl,
      token,
      teamId,
      traceCaptureStorageKey,
      traceLogStorageKey,
      layoutStorageKey,
    }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          "mattermostDeck.wsPat.v1": token,
          "mattermostDeck.persistPat.v1": "true",
          "mattermostDeck.pollingIntervalSeconds.v1": "120",
          [traceCaptureStorageKey]: true,
          [traceLogStorageKey]: [],
          [layoutStorageKey]: [{
            id: "mentions-route-stability",
            type: "mentions",
            teamId,
            unreadOnly: false,
          }],
        }, () => resolve());
      });
    }, {
      serverUrl: baseUrl,
      token,
      teamId: team!.id,
      traceCaptureStorageKey: TRACE_CAPTURE_STORAGE_KEY,
      traceLogStorageKey: TRACE_LOG_STORAGE_KEY,
      layoutStorageKey: LAYOUT_STORAGE_KEY,
    });

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
      const debugWindow = window as typeof window & {
        __deckWsStatuses?: string[];
      };
      debugWindow.__deckWsStatuses = [];
      window.addEventListener("mattermost-deck-ws-status", (event) => {
        debugWindow.__deckWsStatuses?.push(String((event as CustomEvent).detail));
      });
    });
    await login(page, state.memberUser.username, state.memberUser.password);
    await page.goto(`${baseUrl}/${state.teamName}/channels/town-square`);
    await page.waitForURL(new RegExp(`/${state.teamName}/channels/town-square`), { timeout: 30_000 });

    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect.poll(async () => {
      return (await debugRequest<{ stateStatus?: string }>(page, "getState")).stateStatus;
    }, { timeout: 30_000 }).toBe("ready");
    await expect.poll(async () => {
      return (await debugRequest<{ postStatus?: string } | null>(
        page,
        "getColumnState",
        { id: "mentions-route-stability" },
      ))?.postStatus;
    }, { timeout: 30_000 }).toBe("ready");
    await expect.poll(
      () => page.evaluate(() => {
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        return debugWindow.__deckWsStatuses?.includes("connected") ?? false;
      }),
      { timeout: 30_000 },
    ).toBe(true);

    const rootMarker = `route-stability-${Date.now()}`;
    await page.evaluate((marker) => {
      const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
      if (!root) {
        throw new Error("Deck root not found");
      }
      root.dataset.e2eMarker = marker;
    }, rootMarker);

    await page.waitForTimeout(500);
    await sw.evaluate((traceLogStorageKey) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ [traceLogStorageKey]: [] }, () => resolve());
      });
    }, TRACE_LOG_STORAGE_KEY);
    await page.waitForTimeout(500);

    capture = true;
    const offTopicLink = page.locator(`a[href="/${state.teamName}/channels/off-topic"]`).first();
    await expect(offTopicLink).toBeVisible({ timeout: 20_000 });
    // The fresh Mattermost test profile can display its welcome tour over the
    // sidebar. Invoke the real sidebar link while keeping this Deck regression
    // independent from Mattermost's onboarding overlay.
    await offTopicLink.evaluate((link) => (link as HTMLAnchorElement).click());
    await page.waitForURL(new RegExp(`/${state.teamName}/channels/off-topic`), { timeout: 30_000 });
    await expect.poll(async () => {
      const snapshot = await debugRequest<{
        stateStatus?: string;
        currentChannelId?: string;
        wsStatus?: string;
      }>(page, "getState");
      return {
        stateStatus: snapshot.stateStatus,
        currentChannelId: snapshot.currentChannelId,
        wsStatus: snapshot.wsStatus,
      };
    }, { timeout: 30_000 }).toEqual({
      stateStatus: "ready",
      currentChannelId: offTopic!.id,
      wsStatus: "connected",
    });
    await page.waitForTimeout(750);

    const traceEntries = await sw.evaluate((traceLogStorageKey) => {
      return new Promise<TraceLogEntry[]>((resolve) => {
        chrome.storage.local.get(traceLogStorageKey, (value) => {
          resolve((value[traceLogStorageKey] as TraceLogEntry[] | undefined) ?? []);
        });
      });
    }, TRACE_LOG_STORAGE_KEY);
    const deckApiPaths = traceEntries
      .filter((entry) =>
        entry.source === "api" &&
        (entry.event === "request.complete" || entry.event === "request.error")
      )
      .map((entry) => ({
        event: entry.event,
        path: String(entry.payload?.fullPath ?? entry.payload?.path ?? ""),
      }));

    expect(appStateRequests).toEqual([]);
    expect(deckApiPaths).toEqual([
      {
        event: "request.complete",
        path: `/teams/${team!.id}/channels/name/off-topic`,
      },
    ]);
    expect(traceEntries.some((entry) =>
      entry.source === "app" &&
      (entry.event === "app.mount" || entry.event === "app.unmount")
    )).toBe(false);
    expect(traceEntries.some((entry) =>
      entry.source === "app" &&
      entry.event === "app.deck-state.route-refresh"
    )).toBe(false);
    await expect.poll(async () => {
      return await page.evaluate((marker) => {
        const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
        return {
          marker: root?.dataset.e2eMarker ?? null,
          rootCount: document.querySelectorAll("#mattermost-deck-root").length,
        };
      }, rootMarker);
    }).toEqual({ marker: rootMarker, rootCount: 1 });
    expect((await debugRequest<{ postStatus?: string } | null>(
      page,
      "getColumnState",
      { id: "mentions-route-stability" },
    ))?.postStatus).toBe("ready");
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
