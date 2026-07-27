import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
  type Worker,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl =
  process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile =
  process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const ADMIN_USERNAME = "mm95admin";
const ADMIN_PASSWORD = "Admin1234!";
const LAYOUT_STORAGE_KEY = "mattermostDeck.layout.v1";
const SERVER_URL_STORAGE_KEY = "mattermostDeck.serverUrl.v1";
const DEBUG_FLAG_KEY = "mattermostDeck.debugLogs";
const DEBUG_REQUEST_TIMEOUT_MS = 5_000;

type MentionPipeline = "search" | "channel" | "thread";

interface E2EState {
  teamName: string;
  memberUser: {
    id: string;
    username: string;
    password: string;
    token: string;
  };
}

interface MattermostTeam {
  id: string;
  name: string;
}

interface ColumnState {
  postStatus?: string;
  mentionLoadActive?: boolean;
  mentionLoadTotalTeams?: number;
  teamId?: string | null;
}

interface PipelineGate {
  held: boolean;
  release: () => void;
  targetTeamId: string | null;
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
}

async function loginViaApi(
  username: string,
  password: string,
): Promise<string> {
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

async function apiPost<T>(
  token: string,
  pathname: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `POST ${pathname} failed with ${response.status}: ${responseText}`,
    );
  }
  return (await response.json()) as T;
}

async function apiDelete(token: string, pathname: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`DELETE ${pathname} failed with ${response.status}`);
  }
}

async function login(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}/landing#/login`, {
    waitUntil: "domcontentloaded",
  });
  const browserChoice = page.getByText("View in Browser");
  const loginId = page.locator('input[name="loginId"]');

  await Promise.race([
    browserChoice
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => undefined),
    loginId
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => undefined),
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
  page: Page,
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return await page.evaluate(
    ({ requestAction, requestPayload, timeoutMs }) =>
      new Promise<T>((resolve, reject) => {
        const id = `deck-debug-${Math.random().toString(36).slice(2)}`;
        let timer: number | null = null;
        const cleanup = () => {
          if (timer !== null) {
            window.clearTimeout(timer);
          }
          window.removeEventListener(
            "mattermost-deck-debug-response",
            handleResponse as EventListener,
          );
        };
        const handleResponse = (event: Event) => {
          const customEvent = event as CustomEvent<{
            id?: string;
            result?: T;
          }>;
          if (customEvent.detail?.id !== id) {
            return;
          }
          cleanup();
          resolve(customEvent.detail?.result as T);
        };

        window.addEventListener(
          "mattermost-deck-debug-response",
          handleResponse as EventListener,
        );
        timer = window.setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `Mattermost Deck debug request timed out: ${requestAction}`,
            ),
          );
        }, timeoutMs);
        window.dispatchEvent(
          new CustomEvent("mattermost-deck-debug-request", {
            detail: {
              id,
              action: requestAction,
              payload: requestPayload,
            },
          }),
        );
      }),
    {
      requestAction: action,
      requestPayload: payload,
      timeoutMs: DEBUG_REQUEST_TIMEOUT_MS,
    },
  );
}

async function configureExtension(
  worker: Worker,
  baselineColumnId: string,
): Promise<void> {
  await worker.evaluate(
    ({ serverUrl, layoutStorageKey, serverUrlStorageKey, columnId }) =>
      new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            [serverUrlStorageKey]: serverUrl,
            [layoutStorageKey]: [
              {
                id: columnId,
                type: "channelWatch",
              },
            ],
          },
          () => resolve(),
        );
      }),
    {
      serverUrl: baseUrl,
      layoutStorageKey: LAYOUT_STORAGE_KEY,
      serverUrlStorageKey: SERVER_URL_STORAGE_KEY,
      columnId: baselineColumnId,
    },
  );
}

async function waitForDeckReady(page: Page): Promise<void> {
  await expect(page.locator("#mattermost-deck-root")).toBeAttached({
    timeout: 20_000,
  });
  await expect
    .poll(
      async () => {
        const state = await debugRequest<{
          stateStatus?: string;
          columns?: Array<{ type?: string }>;
        }>(page, "getState");
        return Boolean(
          state?.stateStatus === "ready" &&
            state.columns?.some((column) => column.type === "channelWatch"),
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

function getRequestTeamId(
  pipeline: MentionPipeline,
  requestUrl: string,
): string | null {
  const pathname = new URL(requestUrl).pathname;
  const pattern =
    pipeline === "search"
      ? /\/api\/v4\/teams\/([^/]+)\/posts\/search$/
      : pipeline === "channel"
        ? /\/api\/v4\/users\/me\/teams\/([^/]+)\/channels\/members$/
        : /\/api\/v4\/users\/[^/]+\/teams\/([^/]+)\/threads$/;
  const match = pathname.match(pattern);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function getRequestKey(
  pipeline: MentionPipeline,
  requestUrl: string,
  teamId: string,
): string {
  if (pipeline !== "thread") {
    return teamId;
  }
  const unread = new URL(requestUrl).searchParams.get("unread") ?? "missing";
  return `${teamId}:${unread}`;
}

function getEmptyResponse(pipeline: MentionPipeline): unknown {
  if (pipeline === "search") {
    return { order: [], posts: {} };
  }
  if (pipeline === "channel") {
    return [];
  }
  return {
    total: 0,
    total_unread_threads: 0,
    total_unread_mentions: 0,
    threads: [],
  };
}

function createPipelineGateController(pipeline: MentionPipeline): {
  gate: PipelineGate;
  handle: (route: Route, requestPipeline: MentionPipeline) => Promise<void>;
  startCancellation: () => void;
  unexpectedRequests: string[];
  matchingRequestCount: () => number;
} {
  const observedKeys = new Set<string>();
  const observedTeamOrder: string[] = [];
  const fulfilledKeys = new Set<string>();
  const unexpectedRequests: string[] = [];
  let matchingRequests = 0;
  let cancelling = false;
  let releaseGate = () => undefined;
  const gatePromise = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const gate: PipelineGate = {
    held: false,
    release: () => releaseGate(),
    targetTeamId: null,
  };

  const selectCompletedTarget = (): string | null => {
    for (const teamId of observedTeamOrder) {
      if (pipeline !== "thread" && fulfilledKeys.has(teamId)) {
        return teamId;
      }
      if (
        pipeline === "thread" &&
        fulfilledKeys.has(`${teamId}:false`) &&
        fulfilledKeys.has(`${teamId}:true`)
      ) {
        return teamId;
      }
    }
    return null;
  };

  const hasObservedFirstBatch = () => {
    const observedTeams = new Set(
      Array.from(observedKeys, (key) => key.split(":")[0]),
    );
    return (
      observedTeams.size >= 2 &&
      observedKeys.size >= (pipeline === "thread" ? 4 : 2)
    );
  };

  const handle = async (
    route: Route,
    requestPipeline: MentionPipeline,
  ): Promise<void> => {
    const requestUrl = route.request().url();
    const teamId = getRequestTeamId(requestPipeline, requestUrl);
    if (!teamId) {
      await route.continue();
      return;
    }

    if (cancelling && requestPipeline === pipeline) {
      if (gate.targetTeamId && teamId !== gate.targetTeamId) {
        unexpectedRequests.push(requestUrl);
      }
    }

    if (requestPipeline === pipeline) {
      matchingRequests += 1;
    }

    const requestKey = getRequestKey(requestPipeline, requestUrl, teamId);
    const enteredBeforeCancellation = !cancelling;
    if (enteredBeforeCancellation && requestPipeline === pipeline) {
      if (!observedKeys.has(requestKey)) {
        observedKeys.add(requestKey);
        if (!observedTeamOrder.includes(teamId)) {
          observedTeamOrder.push(teamId);
        }
      }

      if (!gate.held && hasObservedFirstBatch()) {
        const targetTeamId = selectCompletedTarget();
        if (!targetTeamId) {
          throw new Error(
            `No completed first-batch team was available for ${pipeline}`,
          );
        }
        gate.held = true;
        gate.targetTeamId = targetTeamId;
        await gatePromise;
      }
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getEmptyResponse(requestPipeline)),
    });

    if (enteredBeforeCancellation && requestPipeline === pipeline) {
      fulfilledKeys.add(requestKey);
    }
  };

  return {
    gate,
    handle,
    startCancellation: () => {
      cancelling = true;
    },
    unexpectedRequests,
    matchingRequestCount: () => matchingRequests,
  };
}

async function waitForStableRequestCount(
  getCount: () => number,
  stableForMs = 1_200,
): Promise<void> {
  let previousCount = getCount();
  let stableSince = Date.now();
  await expect
    .poll(
      () => {
        const currentCount = getCount();
        if (currentCount !== previousCount) {
          previousCount = currentCount;
          stableSince = Date.now();
        }
        return Date.now() - stableSince;
      },
      {
        timeout: 10_000,
        intervals: [50, 100, 200],
      },
    )
    .toBeGreaterThanOrEqual(stableForMs);
}

test("a superseded mentions run does not issue another batch", async () => {
  test.setTimeout(180_000);
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "mattermost-deck-mentions-cancellation-"),
  );
  const createdTeamIds: string[] = [];
  const activeGateReleases = new Set<() => void>();
  let context: BrowserContext | null = null;
  let adminToken = "";

  try {
    adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
    let teams = await apiGet<MattermostTeam[]>(
      state.memberUser.token,
      "/users/me/teams",
    );
    const timestamp = Date.now();
    const missingTeamCount = Math.max(0, 3 - teams.length);
    for (let index = 1; index <= missingTeamCount; index += 1) {
      const team = await apiPost<MattermostTeam>(adminToken, "/teams", {
        name: `cancel${timestamp}${index}`,
        display_name: `Cancellation ${timestamp} ${index}`,
        type: "O",
      });
      createdTeamIds.push(team.id);
      await apiPost(adminToken, `/teams/${team.id}/members`, {
        team_id: team.id,
        user_id: state.memberUser.id,
      });
    }
    await expect
      .poll(
        async () =>
          (
            await apiGet<MattermostTeam[]>(
              state.memberUser.token,
              "/users/me/teams",
            )
          ).length,
        { timeout: 20_000, intervals: [100, 250, 500] },
      )
      .toBeGreaterThanOrEqual(3);
    teams = await apiGet<MattermostTeam[]>(
      state.memberUser.token,
      "/users/me/teams",
    );
    expect(teams.length).toBeGreaterThanOrEqual(3);

    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const [existingWorker] = context.serviceWorkers();
    const worker =
      existingWorker ??
      (await context.waitForEvent("serviceworker", { timeout: 15_000 }));

    let loggedIn = false;
    for (const pipeline of [
      "search",
      "channel",
      "thread",
    ] satisfies MentionPipeline[]) {
      await configureExtension(worker, `baseline-${pipeline}-${timestamp}`);
      const page = await context.newPage();
      let releaseCurrentGate = () => undefined;
      try {
        await page.addInitScript((debugFlagKey) => {
          window.localStorage.setItem(debugFlagKey, "1");
        }, DEBUG_FLAG_KEY);
        if (!loggedIn) {
          await login(
            page,
            state.memberUser.username,
            state.memberUser.password,
          );
          loggedIn = true;
        } else {
          await page.goto(
            `${baseUrl}/${state.teamName}/channels/town-square`,
            { waitUntil: "domcontentloaded" },
          );
        }
        await waitForDeckReady(page);

        const controller = createPipelineGateController(pipeline);
        releaseCurrentGate = controller.gate.release;
        activeGateReleases.add(releaseCurrentGate);

        const searchPattern =
          /\/api\/v4\/teams\/[^/]+\/posts\/search(?:\?|$)/;
        const channelPattern =
          /\/api\/v4\/users\/me\/teams\/[^/]+\/channels\/members(?:\?|$)/;
        const threadPattern =
          /\/api\/v4\/users\/[^/]+\/teams\/[^/]+\/threads(?:\?|$)/;
        await page.route(searchPattern, (route) =>
          controller.handle(route, "search")
        );
        await page.route(channelPattern, (route) =>
          controller.handle(route, "channel")
        );
        await page.route(threadPattern, (route) =>
          controller.handle(route, "thread")
        );

        const mentionsColumnId = await debugRequest<string>(
          page,
          "addColumn",
          {
            type: "mentions",
            defaults: { teamId: null },
          },
        );
        await expect
          .poll(
            () =>
              controller.gate.held
                ? controller.gate.targetTeamId
                : null,
            { timeout: 30_000, intervals: [20, 50, 100] },
          )
          .not.toBeNull();

        const targetTeamId = controller.gate.targetTeamId;
        if (!targetTeamId) {
          throw new Error(`Missing target team for ${pipeline}`);
        }

        controller.startCancellation();
        await debugRequest(page, "updateColumn", {
          id: mentionsColumnId,
          patch: { teamId: targetTeamId },
        });
        await expect
          .poll(
            async () => {
              const debugState = await debugRequest<{
                columns?: Array<{
                  id?: string;
                  teamId?: string | null;
                }>;
              }>(page, "getState");
              const column = debugState.columns?.find(
                (candidate) => candidate.id === mentionsColumnId,
              );
              const columnState = await debugRequest<ColumnState | null>(
                page,
                "getColumnState",
                { id: mentionsColumnId },
              );
              return Boolean(
                column?.teamId === targetTeamId &&
                  columnState?.teamId === targetTeamId,
              );
            },
            { timeout: 20_000, intervals: [20, 50, 100] },
          )
          .toBe(true);

        releaseCurrentGate();
        activeGateReleases.delete(releaseCurrentGate);

        await expect
          .poll(
            async () => {
              const columnState = await debugRequest<ColumnState | null>(
                page,
                "getColumnState",
                { id: mentionsColumnId },
              );
              return Boolean(
                columnState?.postStatus === "ready" &&
                  columnState.mentionLoadActive === false &&
                  columnState.teamId === targetTeamId,
              );
            },
            { timeout: 30_000, intervals: [50, 100, 200] },
          )
          .toBe(true);
        await waitForStableRequestCount(
          controller.matchingRequestCount,
        );
        expect(
          controller.unexpectedRequests,
          `${pipeline} issued a non-target request after cancellation`,
        ).toEqual([]);

        await page.unroute(searchPattern);
        await page.unroute(channelPattern);
        await page.unroute(threadPattern);
      } finally {
        releaseCurrentGate();
        activeGateReleases.delete(releaseCurrentGate);
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    for (const release of activeGateReleases) {
      release();
    }
    await context?.close().catch(() => undefined);
    try {
      await fs.rm(userDataDir, { recursive: true, force: true });
    } finally {
      if (adminToken) {
        for (const teamId of createdTeamIds.reverse()) {
          await apiDelete(adminToken, `/teams/${teamId}`).catch(
            () => undefined,
          );
        }
      }
    }
  }
});
