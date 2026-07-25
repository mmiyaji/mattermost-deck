import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const ADMIN_USERNAME = "mm95admin";
const ADMIN_PASSWORD = "Admin1234!";
const LAYOUT_STORAGE_KEY = "mattermostDeck.layout.v1";

interface E2EState {
  team: { id: string; name: string };
  memberUser: { id: string; username: string; password: string; token: string };
}

interface ChannelMember {
  channel_id: string;
  last_viewed_at: number;
  mention_count: number;
  mention_count_root?: number;
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
    const detail = await response.text().catch(() => "");
    throw new Error(`GET ${pathname} failed with ${response.status}: ${detail}`);
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
    const detail = await response.text().catch(() => "");
    throw new Error(`POST ${pathname} failed with ${response.status}: ${detail}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function apiPut<T>(token: string, pathname: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`PUT ${pathname} failed with ${response.status}: ${detail}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function apiDelete(token: string, pathname: string): Promise<void> {
  await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

async function login(page: Page, username: string, password: string): Promise<void> {
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
  page: Page,
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

test("unread-only mentions keeps an older unread thread reply from another channel", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const state = await readState();
  const adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-multichannel-mentions-"));
  const createdChannelIds: string[] = [];
  const createdPostIds: string[] = [];
  const threadsToMarkRead: Array<{ rootId: string; readAt: number }> = [];
  let context: BrowserContext | null = null;

  try {
    const timestamp = Date.now();
    const channelA = await apiPost<{ id: string }>(adminToken, "/channels", {
      team_id: state.team.id,
      name: `mention-read-${timestamp}`,
      display_name: `Mention Read ${timestamp}`,
      type: "O",
    });
    const channelB = await apiPost<{ id: string }>(adminToken, "/channels", {
      team_id: state.team.id,
      name: `mention-unread-${timestamp}`,
      display_name: `Mention Unread ${timestamp}`,
      type: "O",
    });
    createdChannelIds.push(channelA.id, channelB.id);

    for (const channelId of createdChannelIds) {
      await apiPost(adminToken, `/channels/${channelId}/members`, {
        user_id: state.memberUser.id,
      });
    }

    const threadRoot = await apiPost<{ id: string }>(adminToken, "/posts", {
      channel_id: channelB.id,
      message: `thread-root-${timestamp}`,
    });
    createdPostIds.push(threadRoot.id);
    await apiPost(state.memberUser.token, "/channels/members/me/view", {
      channel_id: channelB.id,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const unreadMarker = `older-unread-thread-mention-${timestamp}`;
    const unreadReply = await apiPost<{ id: string; create_at: number }>(adminToken, "/posts", {
      channel_id: channelB.id,
      root_id: threadRoot.id,
      message: `@${state.memberUser.username} ${unreadMarker}`,
    });
    createdPostIds.push(unreadReply.id);
    threadsToMarkRead.push({
      rootId: threadRoot.id,
      readAt: unreadReply.create_at + 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const readMarker = `newer-read-mention-${timestamp}`;
    const readMention = await apiPost<{ id: string }>(adminToken, "/posts", {
      channel_id: channelA.id,
      message: `@${state.memberUser.username} ${readMarker}`,
    });
    createdPostIds.push(readMention.id);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await apiPost(state.memberUser.token, "/channels/members/me/view", {
      channel_id: channelA.id,
    });

    await expect
      .poll(async () => {
        const members = await apiGet<ChannelMember[]>(
          state.memberUser.token,
          `/users/me/teams/${state.team.id}/channels/members`,
        );
        const readMember = members.find((member) => member.channel_id === channelA.id);
        const unreadMember = members.find((member) => member.channel_id === channelB.id);
        return (readMember?.mention_count ?? -1) === 0 && (unreadMember?.mention_count ?? 0) > 0;
      }, { timeout: 15_000 })
      .toBe(true);

    // Allow PostgreSQL full-text indexing and unread aggregation to settle
    // before the extension performs its initial request.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

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
    await sw.evaluate(({ serverUrl, teamId, layoutStorageKey }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          [layoutStorageKey]: [{
            id: "mentions-multichannel",
            type: "mentions",
            teamId,
            unreadOnly: true,
          }],
        }, () => resolve());
      });
    }, { serverUrl: baseUrl, teamId: state.team.id, layoutStorageKey: LAYOUT_STORAGE_KEY });

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
    });
    await login(page, state.memberUser.username, state.memberUser.password);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });

    await expect
      .poll(async () => {
        const column = await debugRequest<{
          postMessages?: string[];
          visiblePostMessages?: string[];
        } | null>(page, "getColumnState", { id: "mentions-multichannel" });
        return {
          fetchedUnreadReply: column?.postMessages?.some((message) => message.includes(unreadMarker)) ?? false,
          fetchedReadMention: column?.postMessages?.some((message) => message.includes(readMarker)) ?? false,
          visibleUnreadReply: column?.visiblePostMessages?.some((message) => message.includes(unreadMarker)) ?? false,
          visibleReadMention: column?.visiblePostMessages?.some((message) => message.includes(readMarker)) ?? false,
        };
      }, { timeout: 60_000 })
      .toEqual({
        fetchedUnreadReply: true,
        fetchedReadMention: true,
        visibleUnreadReply: true,
        visibleReadMention: false,
      });

    await page.screenshot({
      path: testInfo.outputPath("mentions-multichannel-unread.png"),
      fullPage: true,
    });
  } finally {
    await context?.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    for (const thread of threadsToMarkRead) {
      await apiPut(
        state.memberUser.token,
        `/users/${state.memberUser.id}/teams/${state.team.id}/threads/${thread.rootId}/read/${thread.readAt}`,
      ).catch(() => undefined);
    }
    for (const postId of [...createdPostIds].reverse()) {
      await apiDelete(adminToken, `/posts/${postId}`);
    }
    for (const channelId of createdChannelIds) {
      await apiDelete(adminToken, `/channels/${channelId}`);
    }
  }
});

test("realtime mention queue keeps rapid posts from two channels", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const state = await readState();
  const adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const memberWsToken = await loginViaApi(state.memberUser.username, state.memberUser.password);
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-realtime-mentions-"));
  const createdChannelIds: string[] = [];
  const createdPostIds: string[] = [];
  let context: BrowserContext | null = null;

  try {
    const timestamp = Date.now();
    for (const suffix of ["a", "b"]) {
      const channel = await apiPost<{ id: string }>(adminToken, "/channels", {
        team_id: state.team.id,
        name: `mention-burst-${suffix}-${timestamp}`,
        display_name: `Mention Burst ${suffix.toUpperCase()} ${timestamp}`,
        type: "O",
      });
      createdChannelIds.push(channel.id);
      await apiPost(adminToken, `/channels/${channel.id}/members`, {
        user_id: state.memberUser.id,
      });
    }

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
    await sw.evaluate(({ serverUrl, teamId, layoutStorageKey, token }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          "mattermostDeck.wsPat.v1": token,
          "mattermostDeck.persistPat.v1": "true",
          "mattermostDeck.pollingIntervalSeconds.v1": "120",
          [layoutStorageKey]: [{
            id: "mentions-realtime-burst",
            type: "mentions",
            teamId,
            unreadOnly: false,
          }],
        }, () => resolve());
      });
    }, {
      serverUrl: baseUrl,
      teamId: state.team.id,
      layoutStorageKey: LAYOUT_STORAGE_KEY,
      token: memberWsToken,
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
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect.poll(
      () => page.evaluate(() => {
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        return {
          connected: debugWindow.__deckWsStatuses?.includes("connected") ?? false,
          statuses: debugWindow.__deckWsStatuses ?? [],
        };
      }),
      { timeout: 30_000 },
    ).toMatchObject({ connected: true });
    await expect.poll(async () => {
      const column = await debugRequest<{
        postStatus?: string;
      } | null>(page, "getColumnState", { id: "mentions-realtime-burst" });
      return column?.postStatus;
    }, { timeout: 60_000 }).toBe("ready");

    const markers = [
      `realtime-channel-a-${timestamp}`,
      `realtime-channel-b-${timestamp}`,
    ];
    const posts = await Promise.all(createdChannelIds.map((channelId, index) =>
      apiPost<{ id: string }>(adminToken, "/posts", {
        channel_id: channelId,
        message: `@${state.memberUser.username} ${markers[index]}`,
      }),
    ));
    createdPostIds.push(...posts.map((post) => post.id));

    await expect.poll(async () => {
      const column = await debugRequest<{
        postMessages?: string[];
      } | null>(page, "getColumnState", { id: "mentions-realtime-burst" });
      return markers.map(
        (marker) => column?.postMessages?.some((message) => message.includes(marker)) ?? false,
      );
    }, { timeout: 12_000 }).toEqual([true, true]);

    await page.screenshot({
      path: testInfo.outputPath("mentions-realtime-burst.png"),
      fullPage: true,
    });
  } finally {
    await context?.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    for (const postId of [...createdPostIds].reverse()) {
      await apiDelete(adminToken, `/posts/${postId}`);
    }
    for (const channelId of createdChannelIds) {
      await apiDelete(adminToken, `/channels/${channelId}`);
    }
  }
});

test("polling includes a plain direct message and clears it at the channel read marker", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const state = await readState();
  const adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const adminUser = await apiGet<{ id: string }>(adminToken, "/users/me");
  const directChannel = await apiPost<{ id: string }>(adminToken, "/channels/direct", [
    adminUser.id,
    state.memberUser.id,
  ]);
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-direct-mentions-"));
  const createdPostIds: string[] = [];
  let context: BrowserContext | null = null;

  try {
    await apiPost(state.memberUser.token, "/channels/members/me/view", {
      channel_id: directChannel.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const marker = `plain-direct-mention-${Date.now()}`;
    const directPost = await apiPost<{ id: string }>(adminToken, "/posts", {
      channel_id: directChannel.id,
      message: marker,
    });
    createdPostIds.push(directPost.id);

    await expect.poll(async () => {
      const members = await apiGet<ChannelMember[]>(
        state.memberUser.token,
        `/users/me/teams/${state.team.id}/channels/members`,
      );
      return members.find((member) => member.channel_id === directChannel.id)?.mention_count ?? 0;
    }, { timeout: 15_000 }).toBeGreaterThan(0);

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
    await sw.evaluate(({ serverUrl, teamId, layoutStorageKey }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          "mattermostDeck.pollingIntervalSeconds.v1": "5",
          [layoutStorageKey]: [{
            id: "mentions-direct-polling",
            type: "mentions",
            teamId,
            unreadOnly: true,
          }],
        }, () => resolve());
      });
    }, {
      serverUrl: baseUrl,
      teamId: state.team.id,
      layoutStorageKey: LAYOUT_STORAGE_KEY,
    });

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
    });
    await login(page, state.memberUser.username, state.memberUser.password);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });

    await expect.poll(async () => {
      const column = await debugRequest<{
        postStatus?: string;
        postMessages?: string[];
        visiblePostMessages?: string[];
        mentionCount?: number;
        channelLastViewedAt?: Record<string, number>;
      } | null>(page, "getColumnState", { id: "mentions-direct-polling" });
      return {
        fetched: column?.postMessages?.some((message) => message.includes(marker)) ?? false,
        visible: column?.visiblePostMessages?.some((message) => message.includes(marker)) ?? false,
        status: column?.postStatus,
        mentionCount: column?.mentionCount,
        badgePositive: (column?.mentionCount ?? 0) > 0,
        directLastViewedAt: column?.channelLastViewedAt?.[directChannel.id],
      };
    }, { timeout: 60_000 }).toMatchObject({
      fetched: true,
      visible: true,
      status: "ready",
      badgePositive: true,
    });
    const countWithMarker = (
      await debugRequest<{ mentionCount?: number } | null>(
        page,
        "getColumnState",
        { id: "mentions-direct-polling" },
      )
    )?.mentionCount ?? 0;
    expect(countWithMarker).toBeGreaterThan(0);

    await page.screenshot({
      path: testInfo.outputPath("mentions-direct-message-unread.png"),
      fullPage: true,
    });

    await apiPost(state.memberUser.token, "/channels/members/me/view", {
      channel_id: directChannel.id,
    });
    await expect.poll(async () => {
      const column = await debugRequest<{
        visiblePostMessages?: string[];
        mentionCount?: number;
      } | null>(page, "getColumnState", { id: "mentions-direct-polling" });
      return {
        visible: column?.visiblePostMessages?.some((message) => message.includes(marker)) ?? false,
        mentionCount: column?.mentionCount,
      };
    }, { timeout: 45_000 }).toEqual({
      visible: false,
      mentionCount: countWithMarker - 1,
    });
  } finally {
    await context?.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    for (const postId of [...createdPostIds].reverse()) {
      await apiDelete(adminToken, `/posts/${postId}`);
    }
    await apiPost(state.memberUser.token, "/channels/members/me/view", {
      channel_id: directChannel.id,
    }).catch(() => undefined);
  }
});
