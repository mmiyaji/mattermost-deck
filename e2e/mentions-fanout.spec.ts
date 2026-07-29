import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type CDPSession,
  type Request,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const LAYOUT_STORAGE_KEY = "mattermostDeck.layout.v1";
const MENTION_CACHE_STORAGE_KEY =
  "mattermostDeck.mentionFeedCache.v1";

interface E2EState {
  teamName: string;
  adminUser: { username: string; password: string };
  memberUser: { id: string; username: string; password: string; token: string };
}

interface SearchRequestTiming {
  request: Request;
  startedAt: number;
  finishedAt?: number;
}

interface ChannelMember {
  channel_id: string;
  mention_count?: number;
  mention_count_root?: number;
}

interface BrowserMemorySnapshot {
  label: string;
  capturedAt: string;
  heap: {
    usedSize: number;
    totalSize: number;
    embedderHeapUsedSize?: number;
    backingStorageSize?: number;
  };
  dom: {
    documents: number;
    nodes: number;
    jsEventListeners: number;
  };
}

interface MentionPresentationState {
  progressPresent?: boolean;
  updateButtonPresent?: boolean;
  updateCount?: number;
  updateButtonText?: string | null;
  newPostsButtonPresent?: boolean;
  newPostCount?: number;
  listFocused?: boolean;
  skeletonCount?: number;
  viewportTop?: number | null;
  viewportScrollTop?: number | null;
  firstPostTop?: number | null;
  firstPostHeight?: number | null;
}

interface PostCardDebugState {
  present?: boolean;
  clickable?: boolean;
  role?: string | null;
  top?: number | null;
  height?: number | null;
  relativeTop?: number | null;
  viewportTop?: number | null;
  viewportScrollTop?: number | null;
}

function expectStablePixels(
  actual: Record<string, number | null | undefined>,
  baseline: Record<string, number | null | undefined>,
  keys: string[],
): void {
  for (const key of keys) {
    const actualValue = actual[key];
    const baselineValue = baseline[key];
    expect(actualValue, `${key} should be measured`).not.toBeNull();
    expect(baselineValue, `${key} baseline should be measured`).not.toBeNull();
    expect(
      Math.abs(Number(actualValue) - Number(baselineValue)),
      `${key} should stay within one pixel`,
    ).toBeLessThanOrEqual(1);
  }
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
  const setOnlineButton = page.getByRole("button", {
    name: /set my status to "Online"/i,
  });
  await setOnlineButton
    .waitFor({ state: "visible", timeout: 2_000 })
    .catch(() => undefined);
  if (await setOnlineButton.isVisible().catch(() => false)) {
    await setOnlineButton.click();
  }
}

async function debugRequest<T>(
  page: import("@playwright/test").Page,
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return await page.evaluate(({ action, payload }) => {
    return new Promise<T>((resolve, reject) => {
      const id = `deck-debug-${Math.random().toString(36).slice(2)}`;
      let timeoutId: number | null = null;
      const cleanup = () => {
        window.removeEventListener(
          "mattermost-deck-debug-response",
          handleResponse as EventListener,
        );
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
      const handleResponse = (event: Event) => {
        const customEvent = event as CustomEvent<{ id?: string; result?: T }>;
        if (customEvent.detail?.id !== id) {
          return;
        }
        cleanup();
        resolve(customEvent.detail?.result as T);
      };
      window.addEventListener("mattermost-deck-debug-response", handleResponse as EventListener);
      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Mattermost Deck debug request timed out: ${action}`));
      }, 5_000);
      try {
        window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", {
          detail: { id, action, payload },
        }));
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }, { action, payload });
}

async function waitForStableMentionPresentation(
  page: import("@playwright/test").Page,
  columnId: string,
): Promise<MentionPresentationState> {
  let previousSignature = "";
  let stableReadCount = 0;
  let latest: MentionPresentationState = {};

  await expect.poll(async () => {
    latest = await debugRequest<MentionPresentationState>(
      page,
      "getMentionPresentationState",
      { id: columnId },
    );
    const signature = JSON.stringify([
      latest.viewportTop,
      latest.viewportScrollTop,
      latest.firstPostTop,
      latest.firstPostHeight,
    ].map((value) =>
      typeof value === "number" ? Math.round(value * 10) / 10 : value
    ));
    stableReadCount =
      signature === previousSignature ? stableReadCount + 1 : 0;
    previousSignature = signature;
    return stableReadCount;
  }, {
    timeout: 5_000,
    intervals: [50, 100, 150],
  }).toBeGreaterThanOrEqual(1);

  return latest;
}

async function collectBrowserMemorySnapshot(
  cdpSession: CDPSession,
  label: string,
): Promise<BrowserMemorySnapshot> {
  await cdpSession.send("HeapProfiler.collectGarbage");
  const [heap, dom] = await Promise.all([
    cdpSession.send("Runtime.getHeapUsage") as Promise<
      BrowserMemorySnapshot["heap"]
    >,
    cdpSession.send("Memory.getDOMCounters") as Promise<
      BrowserMemorySnapshot["dom"]
    >,
  ]);
  return {
    label,
    capturedAt: new Date().toISOString(),
    heap,
    dom,
  };
}

test("all-teams mention refresh keeps rows stable until updates are applied", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-mentions-fanout-"));
  const adminToken = await loginViaApi(
    state.adminUser.username,
    state.adminUser.password,
  );
  const memberWsToken = await loginViaApi(
    state.memberUser.username,
    state.memberUser.password,
  );
  const createdTeamIds: string[] = [];
  const createdStandaloneChannelIds: string[] = [];
  const createdMentions: Array<{
    teamId: string;
    channelId: string;
    postId: string;
    marker: string;
  }> = [];
  let readRegressionChannelId = "";
  let context: BrowserContext | null = null;
  let cdpSession: CDPSession | null = null;
  let releaseHeldSearchRequests: (() => void) | null = null;

  try {
    const timestamp = Date.now();
    for (const index of [1, 2]) {
      const team = await apiPost<{ id: string; name: string }>(
        adminToken,
        "/teams",
        {
          name: `fanout${timestamp}${index}`,
          display_name: `Fanout ${timestamp} ${index}`,
          type: "O",
        },
      );
      createdTeamIds.push(team.id);
      await apiPost(adminToken, `/teams/${team.id}/members`, {
        team_id: team.id,
        user_id: state.memberUser.id,
      });
    }

    await expect
      .poll(async () => {
        const teams = await apiGet<Array<{ id: string }>>(
          state.memberUser.token,
          "/users/me/teams",
        );
        return createdTeamIds.every((teamId) =>
          teams.some((team) => team.id === teamId)
        );
      }, { timeout: 20_000 })
      .toBe(true);

    const orderedTeams = await apiGet<Array<{ id: string }>>(
      state.memberUser.token,
      "/users/me/teams",
    );
    const earlyTeamId = orderedTeams[0]?.id;
    const lateTeamId = orderedTeams.at(-1)?.id;
    if (!earlyTeamId || !lateTeamId || earlyTeamId === lateTeamId) {
      throw new Error("fan-out test requires at least two ordered teams");
    }

    const createMention = async (
      teamId: string,
      suffix: "early" | "late",
    ) => {
      const channel = await apiPost<{ id: string }>(adminToken, "/channels", {
        team_id: teamId,
        name: `fanout-mention-${timestamp}-${suffix}`,
        display_name: `Fanout Mention ${timestamp} ${suffix}`,
        type: "O",
      });
      createdStandaloneChannelIds.push(channel.id);
      await apiPost(adminToken, `/channels/${channel.id}/members`, {
        user_id: state.memberUser.id,
      });
      const marker = `progressive-mention-${timestamp}-${suffix}`;
      const post = await apiPost<{ id: string }>(adminToken, "/posts", {
        channel_id: channel.id,
        message: `@${state.memberUser.username} ${marker}`,
      });
      return {
        teamId,
        channelId: channel.id,
        postId: post.id,
        marker,
      };
    };
    createdMentions.push(
      await createMention(earlyTeamId, "early"),
      await createMention(lateTeamId, "late"),
    );
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        apiPost(adminToken, "/posts", {
          channel_id: createdMentions[0].channelId,
          message:
            `@${state.memberUser.username} fanout-scroll-${timestamp}-${index}`,
        })
      ),
    );
    const readRegressionChannel = await apiPost<{ id: string }>(
      adminToken,
      "/channels",
      {
        team_id: earlyTeamId,
        name: `fanout-read-regression-${timestamp}`,
        display_name: `Fanout Read Regression ${timestamp}`,
        type: "O",
      },
    );
    readRegressionChannelId = readRegressionChannel.id;
    createdStandaloneChannelIds.push(readRegressionChannel.id);
    await apiPost(
      adminToken,
      `/channels/${readRegressionChannel.id}/members`,
      { user_id: state.memberUser.id },
    );

    for (const mention of createdMentions) {
      await expect
        .poll(async () => {
          const members = await apiGet<ChannelMember[]>(
            state.memberUser.token,
            `/users/me/teams/${mention.teamId}/channels/members`,
          );
          const member = members.find(
            (entry) => entry.channel_id === mention.channelId,
          );
          return (
            (member?.mention_count ?? 0) +
            (member?.mention_count_root ?? 0)
          );
        }, { timeout: 20_000 })
        .toBeGreaterThan(0);
    }

    const confirmedTeamOrder = (
      await apiGet<Array<{ id: string }>>(
        state.memberUser.token,
        "/users/me/teams",
      )
    ).map((team) => team.id);
    expect(confirmedTeamOrder[0]).toBe(earlyTeamId);
    expect(confirmedTeamOrder.at(-1)).toBe(lateTeamId);

    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });

    await sw.evaluate(({ serverUrl, layoutStorageKey, token }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          "mattermostDeck.wsPat.v1": token,
          "mattermostDeck.persistPat.v1": "true",
          "mattermostDeck.pollingIntervalSeconds.v1": "120",
          [layoutStorageKey]: [{
            id: "mentions",
            type: "mentions",
            unreadOnly: true,
          }],
        }, () => resolve());
      });
    }, {
      serverUrl: baseUrl,
      layoutStorageKey: LAYOUT_STORAGE_KEY,
      token: memberWsToken,
    });

    const page = await context.newPage();
    const observedWsPostIds = new Set<string>();
    page.on("console", (message) => {
      if (!message.text().includes("[deck-debug] app.ws.posted")) {
        return;
      }
      const payloadHandle = message.args()[1];
      if (!payloadHandle) {
        return;
      }
      void payloadHandle.jsonValue().then((payload) => {
        if (
          payload &&
          typeof payload === "object" &&
          "postId" in payload &&
          typeof payload.postId === "string"
        ) {
          observedWsPostIds.add(payload.postId);
        }
      }).catch(() => undefined);
    });
    cdpSession = await context.newCDPSession(page);
    await cdpSession.send("HeapProfiler.enable");
    const teamSearchTimings: SearchRequestTiming[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/v4\/teams\/[^/]+\/posts\/search(?:\?|$)/.test(request.url())) {
        teamSearchTimings.push({ request, startedAt: Date.now() });
      }
    });
    const markSearchFinished = (request: Request) => {
      const timing = teamSearchTimings.find((entry) => entry.request === request);
      if (timing) timing.finishedAt = Date.now();
    };
    page.on("requestfinished", markSearchFinished);
    page.on("requestfailed", markSearchFinished);
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
      const debugWindow = window as typeof window & {
        __deckWsStatuses?: string[];
      };
      debugWindow.__deckWsStatuses = [];
      window.addEventListener(
        "mattermost-deck-ws-status",
        (event) => {
          debugWindow.__deckWsStatuses?.push(
            String((event as CustomEvent).detail),
          );
        },
      );
    });
    await login(page, state.memberUser.username, state.memberUser.password);

    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect
      .poll(async () => {
        const result = await debugRequest<{ stateStatus?: string }>(page, "getState");
        return result?.stateStatus ?? "missing";
      }, { timeout: 30_000 })
      .toBe("ready");
    await expect.poll(
      () => page.evaluate(() => {
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        return debugWindow.__deckWsStatuses?.includes("connected") ??
          false;
      }),
      { timeout: 30_000 },
    ).toBe(true);

    const stateSnapshot = await debugRequest<{ columns: Array<{ id: string; type: string }> }>(page, "getState");
    const mentionsColumn = stateSnapshot.columns.find((column) => column.type === "mentions");
    expect(mentionsColumn).toBeTruthy();

    let observedTotalTeams = 0;
    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          mentionLoadActive?: boolean;
          mentionLoadCompletedTeams?: number;
          mentionLoadTotalTeams?: number;
          mentionBufferedPostMessages?: string[];
          visiblePostMessages?: string[];
        } | null>(page, "getColumnState", { id: mentionsColumn!.id });
        const bufferedMessages =
          columnState?.mentionBufferedPostMessages ?? [];
        const visibleMessages =
          columnState?.visiblePostMessages ?? [];
        observedTotalTeams = columnState?.mentionLoadTotalTeams ?? 0;
        return Boolean(
          columnState?.mentionLoadActive &&
          (columnState.mentionLoadCompletedTeams ?? 0) <
            (columnState.mentionLoadTotalTeams ?? 0) &&
          bufferedMessages.some((message) =>
            message.includes(createdMentions[0].marker)
          ) &&
          !bufferedMessages.some((message) =>
            message.includes(createdMentions[1].marker)
          ) &&
          !visibleMessages.some((message) =>
            message.includes(createdMentions[0].marker)
          ) &&
          !visibleMessages.some((message) =>
            message.includes(createdMentions[1].marker)
          ),
        );
      }, {
        timeout: 30_000,
        intervals: [20, 50, 100],
      })
      .toBe(true);

    const partialLoadingState = await debugRequest<{
      present?: boolean;
      spinnerPresent?: boolean;
      text?: string | null;
    }>(page, "getMentionLoadingProgress", {
      id: mentionsColumn!.id,
    });
    expect(partialLoadingState.present).toBe(true);
    expect(partialLoadingState.spinnerPresent).toBe(true);
    expect(partialLoadingState.text).toBeTruthy();
    const provisionalCardState = await debugRequest<{
      present?: boolean;
      clickable?: boolean;
      role?: string | null;
    }>(page, "getPostCardState", {
      columnId: mentionsColumn!.id,
      text: createdMentions[0].marker,
    });
    expect(provisionalCardState).toMatchObject({
      present: false,
      clickable: false,
      role: null,
    });
    const initialPresentationState = await debugRequest<{
      progressPresent?: boolean;
      skeletonCount?: number;
    }>(page, "getMentionPresentationState", {
      id: mentionsColumn!.id,
    });
    expect(initialPresentationState).toMatchObject({
      progressPresent: true,
      skeletonCount: 0,
    });
    await page.screenshot({
      path: testInfo.outputPath("mentions-stable-loading.png"),
      fullPage: true,
    });

    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          postStatus?: string;
          mentionLoadActive?: boolean;
          visiblePostMessages?: string[];
        } | null>(page, "getColumnState", { id: mentionsColumn!.id });
        const messages = columnState?.visiblePostMessages ?? [];
        return Boolean(
          columnState?.postStatus === "ready" &&
          columnState.mentionLoadActive === false &&
          createdMentions.every((mention) =>
            messages.some((message) => message.includes(mention.marker))
          ),
        );
      }, { timeout: 30_000 })
      .toBe(true);

    const finishedLoadingState = await debugRequest<{
      present?: boolean;
    }>(page, "getMentionLoadingProgress", {
      id: mentionsColumn!.id,
    });
    expect(finishedLoadingState.present).toBe(false);
    const finalizedCardState = await debugRequest<{
      present?: boolean;
      clickable?: boolean;
    }>(page, "getPostCardState", {
      columnId: mentionsColumn!.id,
      text: createdMentions[0].marker,
    });
    expect(finalizedCardState).toMatchObject({
      present: true,
      clickable: true,
    });
    await page.screenshot({
      path: testInfo.outputPath("mentions-progressive-complete.png"),
      fullPage: true,
    });
    const initialMemory = await collectBrowserMemorySnapshot(
      cdpSession,
      "initial-all-teams-complete",
    );

    await expect
      .poll(() => teamSearchTimings.length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);
    expect(teamSearchTimings).toHaveLength(observedTotalTeams);

    await expect
      .poll(
        () => teamSearchTimings.slice(0, 2).every((timing) => timing.finishedAt !== undefined),
        { timeout: 30_000 },
      )
      .toBe(true);

    const firstCycle = teamSearchTimings.slice(0, 3);
    const firstBatchFinishedAt = Math.max(
      firstCycle[0].finishedAt ?? Number.POSITIVE_INFINITY,
      firstCycle[1].finishedAt ?? Number.POSITIVE_INFINITY,
    );
    const configuredGapAfterBatch = firstCycle[2].startedAt - firstBatchFinishedAt;

    // Measure from completion of the first batch, rather than from request
    // start times. Server latency alone must not be able to satisfy this check.
    expect(configuredGapAfterBatch).toBeGreaterThanOrEqual(180);

    let initialCacheSavedAt = 0;
    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          mentionCacheLastSavedAt?: number | null;
        } | null>(page, "getColumnState", { id: mentionsColumn!.id });
        initialCacheSavedAt =
          columnState?.mentionCacheLastSavedAt ?? 0;
        return initialCacheSavedAt || null;
      }, { timeout: 10_000 })
      .not.toBeNull();

    const cacheOnlyMarker = `cache-only-${timestamp}`;
    const otherUserCacheMarker =
      `other-user-cache-${timestamp}`;
    await sw.evaluate(
      async ({
        storageKey,
        userId,
        channelId,
        marker,
        otherUserMarker,
      }) => {
        const payload = await chrome.storage.session.get(storageKey);
        const registry = payload[storageKey] as {
          entries?: Record<
            string,
            {
              serverScope?: string;
              userId?: string;
              scopeTeamId?: string | null;
              posts?: Array<{
                id: string;
                user_id: string;
                channel_id: string;
                create_at: number;
                message: string;
              }>;
              readState?: {
                channelLastViewedAt?: Record<string, number>;
                activeChannelIds?: Record<string, true> | null;
              };
            }
          >;
        };
        const snapshot = Object.values(registry?.entries ?? {}).find(
          (entry) => entry.userId === userId,
        );
        if (!snapshot?.posts || !snapshot.readState) {
          throw new Error("mention cache snapshot was not stored");
        }
        snapshot.posts.unshift({
          id: `cached-${Date.now()}`,
          user_id: userId,
          channel_id: channelId,
          create_at: Date.now(),
          message: marker,
        });
        snapshot.readState.channelLastViewedAt ??= {};
        snapshot.readState.channelLastViewedAt[channelId] = 0;
        if (snapshot.readState.activeChannelIds !== null) {
          snapshot.readState.activeChannelIds ??= {};
          snapshot.readState.activeChannelIds[channelId] = true;
        }
        const otherUserId = "other-user-cache-owner";
        const otherUserSnapshot = structuredClone(snapshot);
        otherUserSnapshot.userId = otherUserId;
        otherUserSnapshot.posts = [{
          id: `other-cached-${Date.now()}`,
          user_id: otherUserId,
          channel_id: channelId,
          create_at: Date.now(),
          message: otherUserMarker,
        }];
        const otherEntryId = JSON.stringify([
          snapshot.serverScope,
          otherUserId,
          snapshot.scopeTeamId ?? "all",
        ]);
        registry.entries ??= {};
        registry.entries[otherEntryId] = otherUserSnapshot;
        await chrome.storage.session.set({ [storageKey]: registry });
      },
      {
        storageKey: MENTION_CACHE_STORAGE_KEY,
        userId: state.memberUser.id,
        channelId: createdMentions[0].channelId,
        marker: cacheOnlyMarker,
        otherUserMarker: otherUserCacheMarker,
      },
    );

    const additionalEarlyMarker =
      `cache-progressive-${timestamp}-early`;
    const additionalLateMarker =
      `cache-progressive-${timestamp}-late`;
    const additionalEarlyPost = await apiPost<{ id: string }>(
      adminToken,
      "/posts",
      {
      channel_id: createdMentions[0].channelId,
      message:
        `@${state.memberUser.username} ${additionalEarlyMarker}`,
      },
    );
    const additionalLatePost = await apiPost<{ id: string }>(
      adminToken,
      "/posts",
      {
      channel_id: createdMentions[1].channelId,
      message:
        `@${state.memberUser.username} ${additionalLateMarker}`,
      },
    );

    let releaseEarlyRequests = () => undefined;
    let releaseLateRequests = () => undefined;
    let holdEarlyRequests = true;
    let holdLateRequests = true;
    const earlyGate = new Promise<void>((resolve) => {
      releaseEarlyRequests = resolve;
    });
    const lateGate = new Promise<void>((resolve) => {
      releaseLateRequests = resolve;
    });
    releaseHeldSearchRequests = () => {
      releaseEarlyRequests();
      releaseLateRequests();
    };
    const searchRoutePattern =
      /\/api\/v4\/teams\/[^/]+\/posts\/search(?:\?|$)/;
    const channelPostsRoutePattern =
      /\/api\/v4\/channels\/[^/]+\/posts(?:\?|$)/;
    await page.route(
      searchRoutePattern,
      async (route) => {
        if (
          route.request().url().includes(
            `/teams/${lateTeamId}/posts/search`,
          )
        ) {
          if (holdLateRequests) {
            await lateGate;
          }
        } else if (holdEarlyRequests) {
          await earlyGate;
        }
        await route.continue();
      },
    );
    await page.route(
      channelPostsRoutePattern,
      async (route) => {
        const requestUrl = route.request().url();
        if (
          requestUrl.includes(
            `/channels/${createdMentions[1].channelId}/posts`,
          )
        ) {
          if (holdLateRequests) {
            await lateGate;
          }
        } else if (
          requestUrl.includes(
            `/channels/${createdMentions[0].channelId}/posts`,
          ) &&
          holdEarlyRequests
        ) {
          await earlyGate;
        }
        await route.continue();
      },
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({
      timeout: 20_000,
    });
    await expect
      .poll(async () => {
        const result = await debugRequest<{ stateStatus?: string }>(
          page,
          "getState",
        );
        return result?.stateStatus ?? "missing";
      }, { timeout: 30_000 })
      .toBe("ready");

    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          mentionCachePhase?: string;
          cachedPostIds?: string[];
          visiblePostMessages?: string[];
          mentionLoadActive?: boolean;
          mentionNotificationsSuppressed?: boolean;
          mentionDisplaySnapshotRunId?: number | null;
          mentionUpdatePending?: boolean;
        } | null>(page, "getColumnState", { id: mentionsColumn!.id });
        const messages = columnState?.visiblePostMessages ?? [];
        return Boolean(
          columnState?.mentionCachePhase === "revalidating" &&
          columnState.mentionLoadActive &&
          columnState.mentionNotificationsSuppressed === true &&
          columnState.mentionDisplaySnapshotRunId !== null &&
          columnState.mentionUpdatePending === false &&
          (columnState.cachedPostIds?.length ?? 0) > 0 &&
          messages.some((message) =>
            message.includes(cacheOnlyMarker)
          ) &&
          !messages.some((message) =>
            message.includes(additionalEarlyMarker)
          ) &&
          !messages.some((message) =>
            message.includes(additionalLateMarker)
          ) &&
          !messages.some((message) =>
            message.includes(otherUserCacheMarker)
          ) &&
          createdMentions.every((mention) =>
            messages.some((message) => message.includes(mention.marker))
          ),
        );
      }, {
        timeout: 20_000,
        intervals: [20, 50, 100],
      })
      .toBe(true);

    const cachedLoadingState = await debugRequest<{
      present?: boolean;
      spinnerPresent?: boolean;
      text?: string | null;
    }>(page, "getMentionLoadingProgress", {
      id: mentionsColumn!.id,
    });
    expect(cachedLoadingState).toMatchObject({
      present: true,
      spinnerPresent: true,
    });
    expect(cachedLoadingState.text).toBeTruthy();
    const cachedColumnBaseline = await debugRequest<{
      visiblePostIds?: string[];
      visiblePostMessages?: string[];
    } | null>(page, "getColumnState", {
      id: mentionsColumn!.id,
    });
    const baselineVisiblePostIds =
      cachedColumnBaseline?.visiblePostIds ?? [];
    expect(baselineVisiblePostIds.length).toBeGreaterThan(0);
    const cachedCardState =
      await debugRequest<PostCardDebugState>(
        page,
        "getPostCardState",
        {
          columnId: mentionsColumn!.id,
          text: cacheOnlyMarker,
        },
      );
    expect(cachedCardState).toMatchObject({
      present: true,
      clickable: false,
      role: null,
    });
    const baselineScrollTop = await debugRequest<number>(
      page,
      "setMentionScrollTop",
      {
        id: mentionsColumn!.id,
        value: 120,
      },
    );
    expect(baselineScrollTop).toBeGreaterThan(0);
    const cachedPresentationState =
      await waitForStableMentionPresentation(
        page,
        mentionsColumn!.id,
      );
    expect(cachedPresentationState).toMatchObject({
      progressPresent: true,
      updateButtonPresent: false,
      newPostsButtonPresent: true,
      newPostCount: 0,
      skeletonCount: 0,
    });
    expect(cachedPresentationState.viewportScrollTop).toBe(
      baselineScrollTop,
    );
    const scrolledCachedCardState =
      await debugRequest<PostCardDebugState>(
        page,
        "getPostCardState",
        {
          columnId: mentionsColumn!.id,
          text: cacheOnlyMarker,
        },
      );
    await page.screenshot({
      path: testInfo.outputPath("mentions-cache-revalidating.png"),
      fullPage: true,
    });
    holdEarlyRequests = false;
    releaseEarlyRequests();

    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          mentionCachePhase?: string;
          mentionBufferedPostIds?: string[];
          visiblePostIds?: string[];
          visiblePostMessages?: string[];
          mentionLoadActive?: boolean;
          mentionUpdatePending?: boolean;
        } | null>(page, "getColumnState", {
          id: mentionsColumn!.id,
        });
        const messages = columnState?.visiblePostMessages ?? [];
        return Boolean(
          columnState?.mentionCachePhase === "revalidating" &&
          columnState.mentionLoadActive &&
          columnState.mentionUpdatePending === false &&
          columnState.mentionBufferedPostIds?.includes(
            additionalEarlyPost.id,
          ) &&
          !columnState.mentionBufferedPostIds?.includes(
            additionalLatePost.id,
          ) &&
          JSON.stringify(columnState.visiblePostIds ?? []) ===
            JSON.stringify(baselineVisiblePostIds) &&
          messages.some((message) =>
            message.includes(cacheOnlyMarker)
          ) &&
          !messages.some((message) =>
            message.includes(additionalEarlyMarker)
          ) &&
          !messages.some((message) =>
            message.includes(additionalLateMarker)
          ),
        );
      }, {
        timeout: 30_000,
        intervals: [20, 50, 100],
      })
      .toBe(true);

    const earlyCardState =
      await debugRequest<PostCardDebugState>(
        page,
        "getPostCardState",
        {
          columnId: mentionsColumn!.id,
          text: cacheOnlyMarker,
        },
      );
    const earlyPresentationState =
      await debugRequest<MentionPresentationState>(
        page,
        "getMentionPresentationState",
        { id: mentionsColumn!.id },
      );
    expect(earlyPresentationState).toMatchObject({
      progressPresent: true,
      updateButtonPresent: false,
      newPostsButtonPresent: true,
      newPostCount: 0,
      skeletonCount: 0,
    });
    expectStablePixels(
      earlyPresentationState,
      cachedPresentationState,
      [
        "viewportTop",
        "viewportScrollTop",
        "firstPostTop",
        "firstPostHeight",
      ],
    );
    expectStablePixels(
      earlyCardState,
      scrolledCachedCardState,
      [
        "top",
        "height",
        "relativeTop",
        "viewportTop",
        "viewportScrollTop",
      ],
    );

    holdLateRequests = false;
    releaseLateRequests();
    releaseHeldSearchRequests = null;

    let pendingUpdateCount = 0;
    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          postStatus?: string;
          mentionCachePhase?: string;
          mentionLoadActive?: boolean;
          mentionNotificationsSuppressed?: boolean;
          mentionUpdatePending?: boolean;
          mentionPendingUpdateCount?: number;
          mentionRefreshPhase?: string;
          visiblePostIds?: string[];
          visiblePostMessages?: string[];
        } | null>(page, "getColumnState", {
          id: mentionsColumn!.id,
        });
        const messages = columnState?.visiblePostMessages ?? [];
        pendingUpdateCount =
          columnState?.mentionPendingUpdateCount ?? 0;
        return Boolean(
          columnState?.postStatus === "ready" &&
          columnState.mentionCachePhase === "ready" &&
          columnState.mentionLoadActive === false &&
          columnState.mentionNotificationsSuppressed === false &&
          columnState.mentionUpdatePending === true &&
          pendingUpdateCount > 0 &&
          columnState.mentionRefreshPhase === "pending" &&
          JSON.stringify(columnState.visiblePostIds ?? []) ===
            JSON.stringify(baselineVisiblePostIds) &&
          messages.some((message) =>
            message.includes(cacheOnlyMarker)
          ) &&
          !messages.some((message) =>
            message.includes(additionalEarlyMarker)
          ) &&
          !messages.some((message) =>
            message.includes(additionalLateMarker)
          ),
        );
      }, { timeout: 30_000 })
      .toBe(true);

    const pendingCardState =
      await debugRequest<PostCardDebugState>(
        page,
        "getPostCardState",
        {
          columnId: mentionsColumn!.id,
          text: cacheOnlyMarker,
        },
      );
    const pendingPresentationState =
      await debugRequest<MentionPresentationState>(
        page,
        "getMentionPresentationState",
        { id: mentionsColumn!.id },
      );
    expect(pendingPresentationState.progressPresent).toBe(false);
    expect(pendingPresentationState.updateButtonPresent).toBe(true);
    expect(pendingPresentationState.updateCount).toBe(
      pendingUpdateCount,
    );
    expect(pendingPresentationState.updateButtonText).toContain(
      String(pendingUpdateCount),
    );
    expect(pendingPresentationState.newPostsButtonPresent).toBe(true);
    expect(pendingPresentationState.newPostCount).toBe(0);
    expect(pendingPresentationState.skeletonCount).toBe(0);
    expectStablePixels(
      pendingPresentationState,
      cachedPresentationState,
      [
        "viewportTop",
        "viewportScrollTop",
        "firstPostTop",
        "firstPostHeight",
      ],
    );
    expectStablePixels(
      pendingCardState,
      scrolledCachedCardState,
      [
        "top",
        "height",
        "relativeTop",
        "viewportTop",
        "viewportScrollTop",
      ],
    );

    const realtimePendingMarker =
      `pending-realtime-${timestamp}`;
    await expect.poll(
      () => page.evaluate(() => {
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        return debugWindow.__deckWsStatuses?.includes("connected") ??
          false;
      }),
      { timeout: 30_000 },
    ).toBe(true);
    expect(
      await debugRequest<boolean>(
        page,
        "markMentionInteraction",
        { id: mentionsColumn!.id },
      ),
    ).toBe(true);
    const realtimePendingPost = await apiPost<{ id: string }>(
      adminToken,
      "/posts",
      {
        channel_id: readRegressionChannelId,
        message:
          `@${state.memberUser.username} ${realtimePendingMarker}`,
      },
    );
    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          visiblePostMessages?: string[];
          mentionPendingUpdateCount?: number;
          mentionUpdatePending?: boolean;
        } | null>(page, "getColumnState", {
          id: mentionsColumn!.id,
        });
        const messages = columnState?.visiblePostMessages ?? [];
        return Boolean(
          columnState?.mentionUpdatePending === true &&
          columnState.mentionPendingUpdateCount ===
            pendingUpdateCount &&
          messages.some((message) =>
            message.includes(realtimePendingMarker)
          ) &&
          messages.some((message) =>
            message.includes(cacheOnlyMarker)
          ) &&
          !messages.some((message) =>
            message.includes(additionalEarlyMarker)
          ) &&
          !messages.some((message) =>
            message.includes(additionalLateMarker)
          ),
        );
      }, { timeout: 15_000 })
      .toBe(true);
    let realtimePendingPresentation: MentionPresentationState = {};
    await expect.poll(async () => {
      realtimePendingPresentation =
        await debugRequest<MentionPresentationState>(
          page,
          "getMentionPresentationState",
          { id: mentionsColumn!.id },
        );
      return Boolean(
        realtimePendingPresentation.updateButtonPresent &&
        realtimePendingPresentation.updateCount ===
          pendingUpdateCount &&
        realtimePendingPresentation.newPostsButtonPresent &&
        (realtimePendingPresentation.newPostCount ?? 0) > 0 &&
        realtimePendingPresentation.skeletonCount === 0
      );
    }, { timeout: 30_000 }).toBe(true);
    await expect
      .poll(() => observedWsPostIds.has(realtimePendingPost.id), {
        timeout: 15_000,
      })
      .toBe(true);

    await apiPost<unknown>(
      memberWsToken,
      "/channels/members/me/view",
      { channel_id: readRegressionChannelId },
    );
    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          mentionUpdatePending?: boolean;
          visiblePostMessages?: string[];
        } | null>(page, "getColumnState", {
          id: mentionsColumn!.id,
        });
        return Boolean(
          columnState?.mentionUpdatePending === true &&
          !(columnState.visiblePostMessages ?? []).some((message) =>
            message.includes(realtimePendingMarker)
          ),
        );
      }, { timeout: 15_000 })
      .toBe(true);

    const unrelatedMarker = `unrelated-${timestamp}`;
    const unrelatedPost = await apiPost<{ id: string }>(
      adminToken,
      "/posts",
      {
        channel_id: readRegressionChannelId,
        message: unrelatedMarker,
      },
    );
    await expect
      .poll(() => observedWsPostIds.has(unrelatedPost.id), {
        timeout: 15_000,
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          mentionUpdatePending?: boolean;
          visiblePostMessages?: string[];
        } | null>(page, "getColumnState", {
          id: mentionsColumn!.id,
        });
        const messages = columnState?.visiblePostMessages ?? [];
        return Boolean(
          columnState?.mentionUpdatePending === true &&
          !messages.some((message) =>
            message.includes(realtimePendingMarker)
          ) &&
          !messages.some((message) =>
            message.includes(unrelatedMarker)
          ),
        );
      }, {
        timeout: 5_000,
        intervals: [100, 250, 500],
      })
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("mentions-updates-pending.png"),
      fullPage: true,
    });

    expect(
      await debugRequest<boolean>(
        page,
        "applyMentionUpdates",
        { id: mentionsColumn!.id },
      ),
    ).toBe(true);

    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          postStatus?: string;
          mentionCachePhase?: string;
          mentionLoadActive?: boolean;
          mentionNotificationsSuppressed?: boolean;
          mentionUpdatePending?: boolean;
          mentionRefreshPhase?: string;
          visiblePostMessages?: string[];
        } | null>(page, "getColumnState", { id: mentionsColumn!.id });
        const messages = columnState?.visiblePostMessages ?? [];
        return Boolean(
          columnState?.postStatus === "ready" &&
          columnState.mentionCachePhase === "ready" &&
          columnState.mentionLoadActive === false &&
          columnState.mentionNotificationsSuppressed === false &&
          columnState.mentionUpdatePending === false &&
          columnState.mentionRefreshPhase === "ready" &&
          !messages.some((message) =>
            message.includes(cacheOnlyMarker)
          ) &&
          messages.some((message) =>
            message.includes(additionalEarlyMarker)
          ) &&
          messages.some((message) =>
            message.includes(additionalLateMarker)
          ) &&
          !messages.some((message) =>
            message.includes(realtimePendingMarker)
          ) &&
          createdMentions.every((mention) =>
            messages.some((message) => message.includes(mention.marker))
          ),
        );
      }, { timeout: 30_000 })
      .toBe(true);
    const refreshedCardState = await debugRequest<{
      present?: boolean;
      clickable?: boolean;
    }>(page, "getPostCardState", {
      columnId: mentionsColumn!.id,
      text: createdMentions[0].marker,
    });
    expect(refreshedCardState).toMatchObject({
      present: true,
      clickable: true,
    });
    const appliedPresentationState =
      await debugRequest<MentionPresentationState>(
        page,
        "getMentionPresentationState",
        { id: mentionsColumn!.id },
      );
    expect(appliedPresentationState).toMatchObject({
      progressPresent: false,
      updateButtonPresent: false,
      newPostCount: 0,
      listFocused: true,
      skeletonCount: 0,
    });
    await page.screenshot({
      path: testInfo.outputPath("mentions-updates-applied.png"),
      fullPage: true,
    });
    await expect
      .poll(() => teamSearchTimings.length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(observedTotalTeams * 2);
    await expect
      .poll(async () => {
        return await sw.evaluate(
          async ({
            storageKey,
            userId,
            staleMarker,
            expectedMarkers,
            previousSavedAt,
          }) => {
            const payload = await chrome.storage.session.get(
              storageKey,
            );
            const registry = payload[storageKey] as {
              entries?: Record<
                string,
                {
                  userId?: string;
                  savedAt?: number;
                  posts?: Array<{ message?: string }>;
                }
              >;
            };
            const entry = Object.values(
              registry?.entries ?? {},
            ).find((candidate) => candidate.userId === userId);
            const messages =
              entry?.posts?.map((post) => post.message ?? "") ?? [];
            return Boolean(
              entry &&
              (entry.savedAt ?? 0) > previousSavedAt &&
              !messages.some((message) =>
                message.includes(staleMarker)
              ) &&
              expectedMarkers.every((marker) =>
                messages.some((message) =>
                  message.includes(marker)
                )
              ),
            );
          },
          {
            storageKey: MENTION_CACHE_STORAGE_KEY,
            userId: state.memberUser.id,
            staleMarker: cacheOnlyMarker,
            expectedMarkers: [
              ...createdMentions.map((mention) => mention.marker),
              additionalEarlyMarker,
              additionalLateMarker,
            ],
            previousSavedAt: initialCacheSavedAt,
          },
        );
      }, { timeout: 10_000 })
      .toBe(true);

    const finalMemory = await collectBrowserMemorySnapshot(
      cdpSession,
      "reload-cache-revalidation-complete",
    );
    const heapGrowthAllowance = Math.max(
      64 * 1024 * 1024,
      initialMemory.heap.usedSize * 0.5,
    );
    const memoryRegressionResult = {
      initial: initialMemory,
      final: finalMemory,
      delta: {
        heapUsedSize:
          finalMemory.heap.usedSize - initialMemory.heap.usedSize,
        nodes: finalMemory.dom.nodes - initialMemory.dom.nodes,
        documents:
          finalMemory.dom.documents - initialMemory.dom.documents,
        jsEventListeners:
          finalMemory.dom.jsEventListeners -
          initialMemory.dom.jsEventListeners,
      },
      thresholds: {
        heapUsedSize:
          initialMemory.heap.usedSize + heapGrowthAllowance,
        heapGrowthAllowance,
        nodes: initialMemory.dom.nodes + 5_000,
        documents: initialMemory.dom.documents + 5,
        jsEventListeners:
          initialMemory.dom.jsEventListeners + 3_000,
      },
    };
    await testInfo.attach("mentions-fanout-memory.json", {
      body: Buffer.from(
        JSON.stringify(memoryRegressionResult, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });
    expect(
      finalMemory.heap.usedSize,
      "heap usage after cache revalidation",
    ).toBeLessThanOrEqual(
      memoryRegressionResult.thresholds.heapUsedSize,
    );
    expect(
      finalMemory.dom.nodes,
      "DOM nodes after cache revalidation",
    ).toBeLessThanOrEqual(memoryRegressionResult.thresholds.nodes);
    expect(
      finalMemory.dom.documents,
      "documents after cache revalidation",
    ).toBeLessThanOrEqual(memoryRegressionResult.thresholds.documents);
    expect(
      finalMemory.dom.jsEventListeners,
      "event listeners after cache revalidation",
    ).toBeLessThanOrEqual(
      memoryRegressionResult.thresholds.jsEventListeners,
    );
    await page.unroute(
      searchRoutePattern,
    );
    await page.unroute(channelPostsRoutePattern);
  } finally {
    releaseHeldSearchRequests?.();
    await cdpSession?.detach().catch(() => undefined);
    await context?.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    for (const teamId of createdTeamIds) {
      await apiDelete(adminToken, `/teams/${teamId}`);
    }
    for (const channelId of createdStandaloneChannelIds) {
      await apiDelete(adminToken, `/channels/${channelId}`);
    }
  }
});
