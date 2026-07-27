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
const TARGET_TEAM_NAME = "test";

interface E2EState {
  teamName: string;
  memberUser: { id: string; username: string; password: string };
}

interface TraceLogEntry {
  source: "app" | "content" | "api" | "ws";
  event: string;
  payload?: Record<string, unknown>;
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
}

async function loginApi(username: string, password: string): Promise<string> {
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

async function apiGetOptional<T>(token: string, pathname: string): Promise<T | null> {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GET ${pathname} failed with ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
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

async function dismissOfflineStatusModal(
  page: import("@playwright/test").Page,
): Promise<void> {
  const confirmModal = page.locator("#confirmModal:visible");
  if (!await confirmModal.isVisible().catch(() => false)) {
    return;
  }

  const title = (await confirmModal.locator("#confirmModalLabel").innerText()).trim();
  if (!/Status is Set to "Offline"/i.test(title)) {
    throw new Error(`Unexpected Mattermost confirmation modal: ${title}`);
  }
  await confirmModal.locator("#cancelModalButton").click({ timeout: 10_000 });
  await expect(confirmModal).toBeHidden({ timeout: 5_000 });
}

test("switching teams keeps Deck panes mounted and avoids a full refetch", async () => {
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-team-switch-"));
  const adminToken = await loginApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const memberToken = await loginApi(state.memberUser.username, state.memberUser.password);
  const originalTeam = await apiGet<{ id: string; name: string }>(
    memberToken,
    `/teams/name/${state.teamName}`,
  );
  const originalChannel = await apiGet<{ id: string; name: string }>(
    memberToken,
    `/teams/${originalTeam.id}/channels/name/town-square`,
  );
  const targetTeam = (
    await apiGetOptional<{ id: string; name: string }>(
      adminToken,
      `/teams/name/${TARGET_TEAM_NAME}`,
    )
  ) ?? await apiPost<{ id: string; name: string }>(adminToken, "/teams", {
    name: TARGET_TEAM_NAME,
    display_name: TARGET_TEAM_NAME,
    type: "O",
  });
  const targetMembership = await apiGetOptional(
    adminToken,
    `/teams/${targetTeam.id}/members/${state.memberUser.id}`,
  );
  if (!targetMembership) {
    await apiPost(adminToken, `/teams/${targetTeam.id}/members`, {
      team_id: targetTeam.id,
      user_id: state.memberUser.id,
    });
  }
  const targetChannel = await apiGet<{ id: string; name: string }>(
    adminToken,
    `/teams/${targetTeam.id}/channels/name/town-square`,
  );

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
      url.includes("/api/v4/teams/name/")
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
          "mattermostDeck.teamSlug.v1": "",
          "mattermostDeck.wsPat.v1": token,
          "mattermostDeck.persistPat.v1": "true",
          "mattermostDeck.pollingIntervalSeconds.v1": "120",
          [traceCaptureStorageKey]: true,
          [traceLogStorageKey]: [],
          [layoutStorageKey]: [{
            id: "mentions-team-stability",
            type: "mentions",
            teamId,
            unreadOnly: false,
          }],
        }, () => resolve());
      });
    }, {
      serverUrl: baseUrl,
      token: memberToken,
      teamId: originalTeam.id,
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
    await page.waitForURL(
      new RegExp(`/${state.teamName}/channels/town-square$`),
      { timeout: 30_000 },
    );
    const dismissOnboarding = page.getByText(/No thanks, I.*figure it out myself/);
    if (await dismissOnboarding.isVisible().catch(() => false)) {
      await dismissOnboarding.click();
    }
    await dismissOfflineStatusModal(page);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect.poll(async () => {
      const snapshot = await debugRequest<{
        stateStatus?: string;
        currentTeamId?: string;
      }>(page, "getState");
      return {
        stateStatus: snapshot.stateStatus,
        currentTeamId: snapshot.currentTeamId,
      };
    }, { timeout: 30_000 }).toEqual({
      stateStatus: "ready",
      currentTeamId: originalTeam.id,
    });
    await expect.poll(async () => {
      return (await debugRequest<{ postStatus?: string } | null>(
        page,
        "getColumnState",
        { id: "mentions-team-stability" },
      ))?.postStatus;
    }, { timeout: 30_000 }).toBe("ready");
    await expect.poll(async () => {
      return (await debugRequest<{ wsStatus?: string }>(
        page,
        "getState",
      )).wsStatus;
    }, { timeout: 30_000 }).toBe("connected");

    const rootMarker = `team-stability-${Date.now()}`;
    await page.evaluate((marker) => {
      const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
      if (!root) {
        throw new Error("Deck root not found");
      }
      root.dataset.e2eMarker = marker;
      (window as typeof window & { __deckRootRef?: Element }).__deckRootRef = root;
      const debugWindow = window as typeof window & {
        __deckWsStatuses?: string[];
      };
      debugWindow.__deckWsStatuses = [];
    }, rootMarker);
    const destinations = [
      {
        team: targetTeam,
        channel: targetChannel,
      },
      {
        team: originalTeam,
        channel: originalChannel,
      },
    ];

    for (const destination of destinations) {
      appStateRequests.length = 0;
      await sw.evaluate((traceLogStorageKey) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.set({ [traceLogStorageKey]: [] }, () => resolve());
        });
      }, TRACE_LOG_STORAGE_KEY);
      await page.evaluate(() => {
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        debugWindow.__deckWsStatuses = [];
      });
      await page.waitForTimeout(500);

      const onboardingPopover = page.locator('[data-popper-placement="top-start"]');
      if (await onboardingPopover.isVisible().catch(() => false)) {
        await onboardingPopover
          .getByText(/No thanks, I.?ll figure it out myself/)
          .click();
        await expect(onboardingPopover).toBeHidden({ timeout: 5_000 });
      }
      await dismissOfflineStatusModal(page);

      const teamLink = page.locator(`a[href="/${destination.team.name}"]`);
      await expect(teamLink).toBeVisible();
      capture = true;
      await teamLink.click({ noWaitAfter: true, timeout: 10_000 });
      await page.waitForURL(
        new RegExp(`/${destination.team.name}/channels/town-square$`),
        { timeout: 30_000 },
      );
      await expect.poll(async () => {
        const snapshot = await debugRequest<{
          stateStatus?: string;
          currentTeamId?: string;
          currentChannelId?: string;
          wsStatus?: string;
        }>(page, "getState");
        return {
          stateStatus: snapshot.stateStatus,
          currentTeamId: snapshot.currentTeamId,
          currentChannelId: snapshot.currentChannelId,
          wsStatus: snapshot.wsStatus,
        };
      }, { timeout: 30_000 }).toEqual({
        stateStatus: "ready",
        currentTeamId: destination.team.id,
        currentChannelId: destination.channel.id,
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
      const deckApiRequests = traceEntries
        .filter((entry) =>
          entry.source === "api" &&
          (entry.event === "request.complete" || entry.event === "request.error")
        )
        .map((entry) => ({
          event: entry.event,
          path: String(entry.payload?.fullPath ?? entry.payload?.path ?? ""),
        }));

      expect(appStateRequests).toEqual([]);
      expect(deckApiRequests).toEqual([{
        event: "request.complete",
        path: `/teams/${destination.team.id}/channels/name/town-square`,
      }]);
      expect(traceEntries.some((entry) =>
        entry.source === "app" &&
        (entry.event === "app.mount" || entry.event === "app.unmount")
      )).toBe(false);
      expect(traceEntries.some((entry) =>
        entry.source === "content" &&
        (
          entry.event === "content.cleanup" ||
          entry.event === "content.render.create-root"
        )
      )).toBe(false);
      expect(traceEntries.some((entry) =>
        entry.source === "app" &&
        entry.event === "app.deck-state.route-refresh"
      )).toBe(false);
      expect(await page.evaluate(() => {
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        return debugWindow.__deckWsStatuses ?? [];
      })).toEqual([]);
      await expect.poll(async () => {
        return await page.evaluate((marker) => {
          const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
          return {
            marker: root?.dataset.e2eMarker ?? null,
            rootCount: document.querySelectorAll("#mattermost-deck-root").length,
            sameRoot: (
              window as typeof window & { __deckRootRef?: Element }
            ).__deckRootRef === root,
          };
        }, rootMarker);
      }).toEqual({ marker: rootMarker, rootCount: 1, sameRoot: true });
      expect((await debugRequest<{ postStatus?: string } | null>(
        page,
        "getColumnState",
        { id: "mentions-team-stability" },
      ))?.postStatus).toBe("ready");
    }
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
