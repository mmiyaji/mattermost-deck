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
const ADMIN_USERNAME = "mm95admin";
const ADMIN_PASSWORD = "Admin1234!";
const LAYOUT_STORAGE_KEY = "mattermostDeck.layout.v1";
const MENTION_CACHE_STORAGE_KEY =
  "mattermostDeck.mentionFeedCache.v1";

interface E2EState {
  teamName: string;
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

test("all-teams mentions streams partial results without changing fan-out", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-mentions-fanout-"));
  const adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const createdTeamIds: string[] = [];
  const createdStandaloneChannelIds: string[] = [];
  const createdMentions: Array<{
    teamId: string;
    channelId: string;
    marker: string;
  }> = [];
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
      await apiPost(adminToken, "/posts", {
        channel_id: channel.id,
        message: `@${state.memberUser.username} ${marker}`,
      });
      return {
        teamId,
        channelId: channel.id,
        marker,
      };
    };
    createdMentions.push(
      await createMention(earlyTeamId, "early"),
      await createMention(lateTeamId, "late"),
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

    await sw.evaluate(({ serverUrl, layoutStorageKey }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          [layoutStorageKey]: [{ id: "mentions", type: "mentions" }],
        }, () => resolve());
      });
    }, {
      serverUrl: baseUrl,
      layoutStorageKey: LAYOUT_STORAGE_KEY,
    });

    const page = await context.newPage();
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

    let observedTotalTeams = 0;
    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          mentionLoadActive?: boolean;
          mentionLoadCompletedTeams?: number;
          mentionLoadTotalTeams?: number;
          visiblePostMessages?: string[];
        } | null>(page, "getColumnState", { id: mentionsColumn!.id });
        const messages = columnState?.visiblePostMessages ?? [];
        observedTotalTeams = columnState?.mentionLoadTotalTeams ?? 0;
        return Boolean(
          columnState?.mentionLoadActive &&
          (columnState.mentionLoadCompletedTeams ?? 0) <
            (columnState.mentionLoadTotalTeams ?? 0) &&
          messages.some((message) =>
            message.includes(createdMentions[0].marker)
          ) &&
          !messages.some((message) =>
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
    }>(page, "getMentionLoadingProgress");
    expect(partialLoadingState.present).toBe(true);
    expect(partialLoadingState.spinnerPresent).toBe(true);
    expect(partialLoadingState.text).toBeTruthy();
    const provisionalCardState = await debugRequest<{
      present?: boolean;
      clickable?: boolean;
      role?: string | null;
    }>(page, "getPostCardState", { text: createdMentions[0].marker });
    expect(provisionalCardState).toMatchObject({
      present: true,
      clickable: false,
      role: null,
    });
    await page.screenshot({
      path: testInfo.outputPath("mentions-progressive-partial.png"),
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
    }>(page, "getMentionLoadingProgress");
    expect(finishedLoadingState.present).toBe(false);
    const finalizedCardState = await debugRequest<{
      present?: boolean;
      clickable?: boolean;
    }>(page, "getPostCardState", { text: createdMentions[0].marker });
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
    await apiPost(adminToken, "/posts", {
      channel_id: createdMentions[0].channelId,
      message:
        `@${state.memberUser.username} ${additionalEarlyMarker}`,
    });
    await apiPost(adminToken, "/posts", {
      channel_id: createdMentions[1].channelId,
      message:
        `@${state.memberUser.username} ${additionalLateMarker}`,
    });

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
        } | null>(page, "getColumnState", { id: mentionsColumn!.id });
        const messages = columnState?.visiblePostMessages ?? [];
        return Boolean(
          columnState?.mentionCachePhase === "revalidating" &&
          columnState.mentionLoadActive &&
          columnState.mentionNotificationsSuppressed === true &&
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
    }>(page, "getMentionLoadingProgress");
    expect(cachedLoadingState).toMatchObject({
      present: true,
      spinnerPresent: true,
    });
    expect(cachedLoadingState.text).toBeTruthy();
    await expect(page.locator(".deck-new-posts-button")).toHaveCount(0);
    const cachedCardState = await debugRequest<{
      present?: boolean;
      clickable?: boolean;
      role?: string | null;
    }>(page, "getPostCardState", {
      text: cacheOnlyMarker,
    });
    expect(cachedCardState).toMatchObject({
      present: true,
      clickable: false,
      role: null,
    });
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
          visiblePostMessages?: string[];
          mentionLoadActive?: boolean;
        } | null>(page, "getColumnState", {
          id: mentionsColumn!.id,
        });
        const messages = columnState?.visiblePostMessages ?? [];
        return Boolean(
          columnState?.mentionCachePhase === "revalidating" &&
          columnState.mentionLoadActive &&
          messages.some((message) =>
            message.includes(cacheOnlyMarker)
          ) &&
          messages.some((message) =>
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
    holdLateRequests = false;
    releaseLateRequests();
    releaseHeldSearchRequests = null;

    await expect
      .poll(async () => {
        const columnState = await debugRequest<{
          postStatus?: string;
          mentionCachePhase?: string;
          mentionLoadActive?: boolean;
          mentionNotificationsSuppressed?: boolean;
          visiblePostMessages?: string[];
        } | null>(page, "getColumnState", { id: mentionsColumn!.id });
        const messages = columnState?.visiblePostMessages ?? [];
        return Boolean(
          columnState?.postStatus === "ready" &&
          columnState.mentionCachePhase === "ready" &&
          columnState.mentionLoadActive === false &&
          columnState.mentionNotificationsSuppressed === false &&
          !messages.some((message) =>
            message.includes(cacheOnlyMarker)
          ) &&
          messages.some((message) =>
            message.includes(additionalEarlyMarker)
          ) &&
          messages.some((message) =>
            message.includes(additionalLateMarker)
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
      text: createdMentions[0].marker,
    });
    expect(refreshedCardState).toMatchObject({
      present: true,
      clickable: true,
    });
    await expect
      .poll(() => teamSearchTimings.length, { timeout: 30_000 })
      .toBe(observedTotalTeams * 2);
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
