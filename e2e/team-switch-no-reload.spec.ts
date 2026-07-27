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
const CUSTOM_WAIT_TIMEOUT_MS = 10_000;

interface E2EState {
  teamName: string;
  memberUser: { id: string; username: string; password: string };
}

interface TraceLogEntry {
  source: "app" | "content" | "api" | "ws";
  event: string;
  payload?: Record<string, unknown>;
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = CUSTOM_WAIT_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
}

async function loginApi(username: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: username, password }),
    signal: AbortSignal.timeout(20_000),
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
    signal: AbortSignal.timeout(20_000),
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
    signal: AbortSignal.timeout(20_000),
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
    signal: AbortSignal.timeout(20_000),
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
  return await withTimeout(
    page.evaluate(({ action, payload }) => {
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
    }, { action, payload }),
    `Deck debug request "${action}"`,
  );
}

async function dismissOfflineStatusModal(
  page: import("@playwright/test").Page,
): Promise<void> {
  const confirmModal = page.locator("#confirmModal:visible");
  if (!await confirmModal.isVisible().catch(() => false)) {
    return;
  }

  const result = await withTimeout(page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>("#confirmModal");
    if (!modal || modal.getClientRects().length === 0) {
      return { visible: false, title: "", clicked: false };
    }
    const title =
      modal.querySelector<HTMLElement>("#confirmModalLabel")
        ?.innerText.trim() ?? "";
    if (!/Status is Set to "Offline"/i.test(title)) {
      return { visible: true, title, clicked: false };
    }
    const cancelButton =
      modal.querySelector<HTMLButtonElement>("#cancelModalButton");
    cancelButton?.click();
    return { visible: true, title, clicked: Boolean(cancelButton) };
  }), "inspect Mattermost offline modal");
  if (!result.visible) {
    return;
  }
  if (!/Status is Set to "Offline"/i.test(result.title)) {
    throw new Error(`Unexpected Mattermost confirmation modal: ${result.title}`);
  }
  if (!result.clicked) {
    throw new Error("Mattermost offline confirmation modal has no cancel button");
  }
  await expect(page.locator("#confirmModal:visible")).toHaveCount(0, {
    timeout: 5_000,
  });
}

test("switching teams keeps Deck panes mounted and avoids a full refetch", async () => {
  test.setTimeout(180_000);

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
    timeout: 30_000,
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
    await test.step("seed extension storage", async () => {
      await withTimeout(sw.evaluate(async ({
        serverUrl,
        token,
        teamId,
        traceCaptureStorageKey,
        traceLogStorageKey,
        layoutStorageKey,
      }) => {
        await chrome.storage.local.set({
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
        });
      }, {
        serverUrl: baseUrl,
        token: memberToken,
        teamId: originalTeam.id,
        traceCaptureStorageKey: TRACE_CAPTURE_STORAGE_KEY,
        traceLogStorageKey: TRACE_LOG_STORAGE_KEY,
        layoutStorageKey: LAYOUT_STORAGE_KEY,
      }), "seed extension storage");
    });

    const page = await withTimeout(context.newPage(), "create Mattermost test page");
    await withTimeout(page.addInitScript(() => {
        window.localStorage.setItem("mattermostDeck.debugLogs", "1");
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        debugWindow.__deckWsStatuses = [];
        window.addEventListener("mattermost-deck-ws-status", (event) => {
          debugWindow.__deckWsStatuses?.push(String((event as CustomEvent).detail));
        });
      }), "install Mattermost page diagnostics");

    await login(page, state.memberUser.username, state.memberUser.password);
    await page.goto(`${baseUrl}/${state.teamName}/channels/town-square`, {
      timeout: 30_000,
    });
    await page.waitForURL(
      new RegExp(`/${state.teamName}/channels/town-square$`),
      { timeout: 30_000 },
    );
    const dismissOnboarding = page.getByText(/No thanks, I.*figure it out myself/);
    if (await dismissOnboarding.isVisible().catch(() => false)) {
      await dismissOnboarding.click({ timeout: 5_000, force: true });
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
    await withTimeout(page.evaluate((marker) => {
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
    }, rootMarker), "mark the initial Deck root");
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
      await withTimeout(sw.evaluate(async (traceLogStorageKey) => {
        await chrome.storage.local.set({ [traceLogStorageKey]: [] });
      }, TRACE_LOG_STORAGE_KEY), "clear Deck trace log");
      await withTimeout(page.evaluate(() => {
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        debugWindow.__deckWsStatuses = [];
      }), "clear WebSocket status log");
      await page.waitForTimeout(500);

      await dismissOfflineStatusModal(page);

      const teamLink = page.locator(`a[href="/${destination.team.name}"]`);
      await expect(teamLink).toBeVisible({ timeout: 10_000 });
      capture = true;
      await test.step(`navigate to team ${destination.team.name}`, async () => {
        await withTimeout(teamLink.evaluate((link) => {
          (link as HTMLAnchorElement).click();
        }), `click team link for ${destination.team.name}`);
        await page.waitForURL(
          new RegExp(`/${destination.team.name}/channels/town-square$`),
          { timeout: 30_000 },
        );
      });
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

      const traceEntries = await withTimeout(
        sw.evaluate(async (traceLogStorageKey) => {
          const value = await chrome.storage.local.get(traceLogStorageKey);
          return (value[traceLogStorageKey] as TraceLogEntry[] | undefined) ?? [];
        }, TRACE_LOG_STORAGE_KEY),
        "read Deck trace log",
      );
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
      const expectedRouteLookup = {
        event: "request.complete",
        path: `/teams/${destination.team.id}/channels/name/town-square`,
      };
      expect(
        deckApiRequests.filter(
          (entry) => entry.path === expectedRouteLookup.path,
        ),
      ).toEqual([expectedRouteLookup]);
      // Author/channel labels for already loaded mention cards resolve in the
      // background and may finish during navigation. These narrow metadata
      // lookups are not a Deck refetch and must not make the route-stability
      // assertion timing-dependent.
      expect(
        deckApiRequests.filter(
          (entry) =>
            entry.path !== expectedRouteLookup.path &&
            !/^\/channels\/[^/]+$/.test(entry.path),
        ),
      ).toEqual([]);
      expect(
        deckApiRequests
          .filter((entry) => /^\/channels\/[^/]+$/.test(entry.path))
          .every((entry) => entry.event === "request.complete"),
      ).toBe(true);
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
      expect(await withTimeout(page.evaluate(() => {
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        return debugWindow.__deckWsStatuses ?? [];
      }), "read WebSocket status log")).toEqual([]);
      await expect.poll(async () => {
        return await withTimeout(page.evaluate((marker) => {
          const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
          return {
            marker: root?.dataset.e2eMarker ?? null,
            rootCount: document.querySelectorAll("#mattermost-deck-root").length,
            sameRoot: (
              window as typeof window & { __deckRootRef?: Element }
            ).__deckRootRef === root,
          };
        }, rootMarker), "inspect Deck root identity");
      }).toEqual({ marker: rootMarker, rootCount: 1, sameRoot: true });
      expect((await debugRequest<{ postStatus?: string } | null>(
        page,
        "getColumnState",
        { id: "mentions-team-stability" },
      ))?.postStatus).toBe("ready");
    }
  } finally {
    await withTimeout(context.close(), "close Chromium extension context", 15_000);
    await withTimeout(
      fs.rm(userDataDir, { recursive: true, force: true }),
      "remove temporary Chromium profile",
    );
  }
});
