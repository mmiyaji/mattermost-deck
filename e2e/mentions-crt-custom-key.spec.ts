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

interface MattermostUser {
  id: string;
  notify_props: Record<string, string>;
}

interface MattermostPreference {
  user_id: string;
  category: string;
  name: string;
  value: string;
}

interface MattermostThread {
  id: string;
  last_viewed_at: number;
  unread_replies: number;
  unread_mentions: number;
}

interface MattermostThreads {
  total: number;
  threads: MattermostThread[];
}

interface ChannelMember {
  channel_id: string;
  last_viewed_at: number;
  mention_count?: number;
}

interface MattermostConfig {
  ServiceSettings?: {
    CollapsedThreads?: string;
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

async function apiRequest<T>(
  token: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  pathname: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${method} ${pathname} failed with ${response.status}: ${detail}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function bestEffortDelete(token: string, pathname: string): Promise<void> {
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

test("custom-key CRT mention follows the thread read marker", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const state = await readState();
  const adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const originalUser = await apiRequest<MattermostUser>(
    state.memberUser.token,
    "GET",
    `/users/${state.memberUser.id}`,
  );
  const originalPreferences = await apiRequest<MattermostPreference[]>(
    state.memberUser.token,
    "GET",
    `/users/${state.memberUser.id}/preferences`,
  );
  const originalCrtPreference = originalPreferences.find(
    (preference) =>
      preference.category === "display_settings" &&
      preference.name === "collapsed_reply_threads",
  );
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-crt-mentions-"));
  const timestamp = Date.now();
  const customKey = `deckcustom${timestamp}`;
  const marker = `crt-custom-key-${timestamp}`;
  let channelId: string | null = null;
  let rootId: string | null = null;
  let replyId: string | null = null;
  let context: BrowserContext | null = null;

  try {
    const mentionKeys = [originalUser.notify_props.mention_keys, customKey]
      .filter(Boolean)
      .join(",");
    await apiRequest(
      state.memberUser.token,
      "PUT",
      `/users/${state.memberUser.id}/patch`,
      {
        notify_props: {
          ...originalUser.notify_props,
          mention_keys: mentionKeys,
        },
      },
    );
    await apiRequest(
      state.memberUser.token,
      "PUT",
      `/users/${state.memberUser.id}/preferences`,
      [{
        user_id: state.memberUser.id,
        category: "display_settings",
        name: "collapsed_reply_threads",
        value: "on",
      }],
    );

    const channel = await apiRequest<{ id: string }>(adminToken, "POST", "/channels", {
      team_id: state.team.id,
      name: `crt-mention-${timestamp}`,
      display_name: `CRT Mention ${timestamp}`,
      type: "O",
    });
    channelId = channel.id;
    await apiRequest(adminToken, "POST", `/channels/${channelId}/members`, {
      user_id: state.memberUser.id,
    });

    const root = await apiRequest<{ id: string }>(adminToken, "POST", "/posts", {
      channel_id: channelId,
      message: `thread-root-${timestamp}`,
    });
    rootId = root.id;
    await apiRequest(state.memberUser.token, "POST", "/channels/members/me/view", {
      channel_id: channelId,
      collapsed_threads_supported: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const reply = await apiRequest<{ id: string; create_at: number }>(adminToken, "POST", "/posts", {
      channel_id: channelId,
      root_id: rootId,
      message: `${customKey} ${marker}`,
    });
    replyId = reply.id;
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Reading the channel must not consume a collapsed-thread mention.
    await apiRequest(state.memberUser.token, "POST", "/channels/members/me/view", {
      channel_id: channelId,
      collapsed_threads_supported: true,
    });

    await expect.poll(async () => {
      const [threads, members] = await Promise.all([
        apiRequest<MattermostThreads>(
          state.memberUser.token,
          "GET",
          `/users/${state.memberUser.id}/teams/${state.team.id}/threads?unread=true&extended=false&deleted=false&per_page=200`,
        ),
        apiRequest<ChannelMember[]>(
          state.memberUser.token,
          "GET",
          `/users/me/teams/${state.team.id}/channels/members`,
        ),
      ]);
      const thread = threads.threads.find((entry) => entry.id === rootId);
      const member = members.find((entry) => entry.channel_id === channelId);
      return {
        threadUnread: (thread?.unread_mentions ?? 0) > 0,
        channelViewedAfterReply: (member?.last_viewed_at ?? 0) >= reply.create_at,
      };
    }, { timeout: 15_000 }).toEqual({
      threadUnread: true,
      channelViewedAfterReply: true,
    });

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
          "mattermostDeck.pollingIntervalSeconds.v1": "15",
          [layoutStorageKey]: [{
            id: "mentions-crt-custom-key",
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

    const hasVisibleMarker = async () => {
      const column = await debugRequest<{
        visiblePostMessages?: string[];
      } | null>(page, "getColumnState", { id: "mentions-crt-custom-key" });
      return column?.visiblePostMessages?.some((message) => message.includes(marker)) ?? false;
    };
    await expect.poll(hasVisibleMarker, { timeout: 45_000 }).toBe(true);
    const countWithMarker = (
      await debugRequest<{ mentionCount?: number } | null>(
        page,
        "getColumnState",
        { id: "mentions-crt-custom-key" },
      )
    )?.mentionCount ?? 0;
    expect(countWithMarker).toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath("mentions-crt-custom-key.png"),
      fullPage: true,
    });

    const readAt = reply.create_at + 1;
    const readThread = await apiRequest<MattermostThread>(
      state.memberUser.token,
      "PUT",
      `/users/${state.memberUser.id}/teams/${state.team.id}/threads/${rootId}/read/${readAt}`,
    );
    expect(readThread.last_viewed_at).toBeGreaterThanOrEqual(reply.create_at);
    expect(readThread.unread_mentions).toBe(0);
    await expect.poll(async () => {
      const threads = await apiRequest<MattermostThreads>(
        state.memberUser.token,
        "GET",
        `/users/${state.memberUser.id}/teams/${state.team.id}/threads?unread=true&extended=false&deleted=false&per_page=200`,
      );
      const thread = threads.threads.find((entry) => entry.id === rootId);
      return {
        unreadMentions: thread?.unread_mentions ?? 0,
        viewedAfterReply: !thread || thread.last_viewed_at >= reply.create_at,
      };
    }, { timeout: 15_000 }).toEqual({
      unreadMentions: 0,
      viewedAfterReply: true,
    });
    await expect.poll(hasVisibleMarker, { timeout: 35_000 }).toBe(false);
    await expect.poll(async () => {
      const column = await debugRequest<{
        mentionCount?: number;
      } | null>(page, "getColumnState", { id: "mentions-crt-custom-key" });
      return column?.mentionCount;
    }, { timeout: 35_000 }).toBe(countWithMarker - 1);
  } finally {
    await context?.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    if (replyId) {
      await bestEffortDelete(adminToken, `/posts/${replyId}`);
    }
    if (rootId) {
      await bestEffortDelete(adminToken, `/posts/${rootId}`);
    }
    if (channelId) {
      await bestEffortDelete(adminToken, `/channels/${channelId}`);
    }
    await apiRequest(
      state.memberUser.token,
      "PUT",
      `/users/${state.memberUser.id}/patch`,
      { notify_props: originalUser.notify_props },
    ).catch(() => undefined);
    if (originalCrtPreference) {
      await apiRequest(
        state.memberUser.token,
        "PUT",
        `/users/${state.memberUser.id}/preferences`,
        [originalCrtPreference],
      ).catch(() => undefined);
    } else {
      await apiRequest(
        state.memberUser.token,
        "POST",
        `/users/${state.memberUser.id}/preferences/delete`,
        [{
          user_id: state.memberUser.id,
          category: "display_settings",
          name: "collapsed_reply_threads",
          value: "on",
        }],
      ).catch(() => undefined);
    }
  }
});

test("non-CRT plain reply to my root follows the channel read marker", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const state = await readState();
  const adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const memberWsToken = await loginViaApi(
    state.memberUser.username,
    state.memberUser.password,
  );
  const originalConfig = await apiRequest<MattermostConfig>(
    adminToken,
    "GET",
    "/config",
  );
  const originalUser = await apiRequest<MattermostUser>(
    state.memberUser.token,
    "GET",
    `/users/${state.memberUser.id}`,
  );
  const originalPreferences = await apiRequest<MattermostPreference[]>(
    state.memberUser.token,
    "GET",
    `/users/${state.memberUser.id}/preferences`,
  );
  const originalCrtPreference = originalPreferences.find(
    (preference) =>
      preference.category === "display_settings" &&
      preference.name === "collapsed_reply_threads",
  );
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-non-crt-reply-"));
  const timestamp = Date.now();
  const marker = `non-crt-root-reply-${timestamp}`;
  let channelId: string | null = null;
  let rootId: string | null = null;
  let replyId: string | null = null;
  let pollingReplyId: string | null = null;
  let pollingEditedMentionId: string | null = null;
  let editedMentionPostId: string | null = null;
  let realtimeReplyId: string | null = null;
  let context: BrowserContext | null = null;

  try {
    await apiRequest(adminToken, "PUT", "/config/patch", {
      ServiceSettings: {
        CollapsedThreads: "default_off",
      },
    });
    await apiRequest(
      state.memberUser.token,
      "PUT",
      `/users/${state.memberUser.id}/patch`,
      {
        notify_props: {
          ...originalUser.notify_props,
          comments: "root",
        },
      },
    );
    await apiRequest(
      state.memberUser.token,
      "PUT",
      `/users/${state.memberUser.id}/preferences`,
      [{
        user_id: state.memberUser.id,
        category: "display_settings",
        name: "collapsed_reply_threads",
        value: "off",
      }],
    );

    const channel = await apiRequest<{ id: string }>(adminToken, "POST", "/channels", {
      team_id: state.team.id,
      name: `non-crt-reply-${timestamp}`,
      display_name: `Non-CRT Reply ${timestamp}`,
      type: "O",
    });
    channelId = channel.id;
    await apiRequest(adminToken, "POST", `/channels/${channelId}/members`, {
      user_id: state.memberUser.id,
    });

    const root = await apiRequest<{ id: string }>(state.memberUser.token, "POST", "/posts", {
      channel_id: channelId,
      message: `root-owned-by-member-${timestamp}`,
    });
    rootId = root.id;
    await apiRequest(state.memberUser.token, "POST", "/channels/members/me/view", {
      channel_id: channelId,
      collapsed_threads_supported: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const reply = await apiRequest<{ id: string; create_at: number }>(adminToken, "POST", "/posts", {
      channel_id: channelId,
      root_id: rootId,
      message: `plain reply without an at-token ${marker}`,
    });
    replyId = reply.id;

    await expect.poll(async () => {
      const members = await apiRequest<ChannelMember[]>(
        state.memberUser.token,
        "GET",
        `/users/me/teams/${state.team.id}/channels/members`,
      );
      const member = members.find((entry) => entry.channel_id === channelId);
      return {
        mentionCount: member?.mention_count ?? 0,
        replyIsUnread: (member?.last_viewed_at ?? 0) < reply.create_at,
      };
    }, { timeout: 15_000 }).toEqual({
      mentionCount: 1,
      replyIsUnread: true,
    });

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
            id: "mentions-non-crt-root-reply",
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

    const getColumnState = async () => await debugRequest<{
      visiblePostIds?: string[];
      visiblePostMessages?: string[];
      mentionCount?: number;
    } | null>(page, "getColumnState", { id: "mentions-non-crt-root-reply" });
    await expect.poll(async () => {
      const column = await getColumnState();
      return column?.visiblePostMessages?.some(
        (message) => message.includes(marker),
      ) ?? false;
    }, { timeout: 45_000 }).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("mentions-non-crt-root-reply.png"),
      fullPage: true,
    });

    await apiRequest(state.memberUser.token, "POST", "/channels/members/me/view", {
      channel_id: channelId,
      collapsed_threads_supported: false,
    });
    await expect.poll(async () => {
      const column = await getColumnState();
      return column?.visiblePostMessages?.some(
        (message) => message.includes(marker),
      ) ?? false;
    }, { timeout: 35_000 }).toBe(false);
    const baselineMentionCount = (await getColumnState())?.mentionCount ?? 0;

    const pollingMarker = `non-crt-polling-delete-${timestamp}`;
    const pollingReply = await apiRequest<{ id: string }>(adminToken, "POST", "/posts", {
      channel_id: channelId,
      root_id: rootId,
      message: `polling reply to delete without an at-token ${pollingMarker}`,
    });
    pollingReplyId = pollingReply.id;
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        hasReply:
          column?.visiblePostMessages?.some(
            (message) => message.includes(pollingMarker),
          ) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 20_000 }).toEqual({
      hasReply: true,
      mentionCount: baselineMentionCount + 1,
    });

    await bestEffortDelete(adminToken, `/posts/${pollingReplyId}`);
    pollingReplyId = null;
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        hasDeletedReply:
          column?.visiblePostMessages?.some(
            (message) => message.includes(pollingMarker),
          ) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 20_000 }).toEqual({
      hasDeletedReply: false,
      mentionCount: baselineMentionCount,
    });

    const pollingEditableMarker = `polling-editable-mention-${timestamp}`;
    const pollingEditableMention = await apiRequest<{ id: string }>(
      adminToken,
      "POST",
      "/posts",
      {
        channel_id: channelId,
        message: `@${state.memberUser.username} ${pollingEditableMarker}`,
      },
    );
    pollingEditedMentionId = pollingEditableMention.id;
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        postVisible:
          column?.visiblePostIds?.includes(pollingEditableMention.id) ?? false,
        markerVisible:
          column?.visiblePostMessages?.some(
            (message) => message.includes(pollingEditableMarker),
          ) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 20_000 }).toEqual({
      postVisible: true,
      markerVisible: true,
      mentionCount: baselineMentionCount + 1,
    });
    await apiRequest(
      adminToken,
      "PUT",
      `/posts/${pollingEditedMentionId}/patch`,
      { message: `polling edit removed the mention ${timestamp}` },
    );
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        postVisible:
          column?.visiblePostIds?.includes(pollingEditableMention.id) ?? false,
        oldMarkerVisible:
          column?.visiblePostMessages?.some(
            (message) => message.includes(pollingEditableMarker),
          ) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 20_000 }).toEqual({
      postVisible: false,
      oldMarkerVisible: false,
      mentionCount: baselineMentionCount,
    });
    await bestEffortDelete(adminToken, `/posts/${pollingEditedMentionId}`);
    pollingEditedMentionId = null;

    await sw.evaluate((token) => new Promise<void>((resolve) => {
      chrome.storage.local.set({
        "mattermostDeck.wsPat.v1": token,
        "mattermostDeck.persistPat.v1": "true",
        "mattermostDeck.pollingIntervalSeconds.v1": "120",
      }, () => resolve());
    }), memberWsToken);
    await expect.poll(
      () => page.evaluate(() => {
        const debugWindow = window as typeof window & {
          __deckWsStatuses?: string[];
        };
        return debugWindow.__deckWsStatuses?.includes("connected") ?? false;
      }),
      { timeout: 30_000 },
    ).toBe(true);

    const editableMarker = `realtime-editable-mention-${timestamp}`;
    const restoredMarker = `realtime-restored-mention-${timestamp}`;
    const editableMention = await apiRequest<{ id: string }>(
      adminToken,
      "POST",
      "/posts",
      {
        channel_id: channelId,
        message: `@${state.memberUser.username} ${editableMarker}`,
      },
    );
    editedMentionPostId = editableMention.id;
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        postVisible: column?.visiblePostIds?.includes(editableMention.id) ?? false,
        markerVisible:
          column?.visiblePostMessages?.some(
            (message) => message.includes(editableMarker),
          ) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 12_000 }).toEqual({
      postVisible: true,
      markerVisible: true,
      mentionCount: baselineMentionCount + 1,
    });

    await apiRequest(
      adminToken,
      "PUT",
      `/posts/${editedMentionPostId}/patch`,
      { message: `edited without a mention ${timestamp}` },
    );
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        postVisible: column?.visiblePostIds?.includes(editableMention.id) ?? false,
        oldMarkerVisible:
          column?.visiblePostMessages?.some(
            (message) => message.includes(editableMarker),
          ) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 12_000 }).toEqual({
      postVisible: false,
      oldMarkerVisible: false,
      mentionCount: baselineMentionCount,
    });

    await apiRequest(
      adminToken,
      "PUT",
      `/posts/${editedMentionPostId}/patch`,
      { message: `@${state.memberUser.username} ${restoredMarker}` },
    );
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        postVisible: column?.visiblePostIds?.includes(editableMention.id) ?? false,
        markerVisible:
          column?.visiblePostMessages?.some(
            (message) => message.includes(restoredMarker),
          ) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 12_000 }).toEqual({
      postVisible: true,
      markerVisible: true,
      mentionCount: baselineMentionCount + 1,
    });
    await bestEffortDelete(adminToken, `/posts/${editedMentionPostId}`);
    editedMentionPostId = null;
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        postVisible: column?.visiblePostIds?.includes(editableMention.id) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 12_000 }).toEqual({
      postVisible: false,
      mentionCount: baselineMentionCount,
    });

    const realtimeMarker = `non-crt-realtime-reply-${timestamp}`;
    const realtimeReply = await apiRequest<{ id: string }>(adminToken, "POST", "/posts", {
      channel_id: channelId,
      root_id: rootId,
      message: `second plain reply without an at-token ${realtimeMarker}`,
    });
    realtimeReplyId = realtimeReply.id;
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        hasReply:
          column?.visiblePostMessages?.some(
            (message) => message.includes(realtimeMarker),
          ) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 12_000 }).toEqual({
      hasReply: true,
      mentionCount: baselineMentionCount + 1,
    });
    await page.screenshot({
      path: testInfo.outputPath("mentions-non-crt-realtime-reply.png"),
      fullPage: true,
    });

    await bestEffortDelete(adminToken, `/posts/${realtimeReplyId}`);
    realtimeReplyId = null;
    await expect.poll(async () => {
      const column = await getColumnState();
      return {
        hasDeletedReply:
          column?.visiblePostMessages?.some(
            (message) => message.includes(realtimeMarker),
          ) ?? false,
        mentionCount: column?.mentionCount ?? 0,
      };
    }, { timeout: 12_000 }).toEqual({
      hasDeletedReply: false,
      mentionCount: baselineMentionCount,
    });
  } finally {
    await context?.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    if (channelId) {
      await apiRequest(state.memberUser.token, "POST", "/channels/members/me/view", {
        channel_id: channelId,
        collapsed_threads_supported: false,
      }).catch(() => undefined);
    }
    if (replyId) {
      await bestEffortDelete(adminToken, `/posts/${replyId}`);
    }
    if (pollingReplyId) {
      await bestEffortDelete(adminToken, `/posts/${pollingReplyId}`);
    }
    if (pollingEditedMentionId) {
      await bestEffortDelete(adminToken, `/posts/${pollingEditedMentionId}`);
    }
    if (editedMentionPostId) {
      await bestEffortDelete(adminToken, `/posts/${editedMentionPostId}`);
    }
    if (realtimeReplyId) {
      await bestEffortDelete(adminToken, `/posts/${realtimeReplyId}`);
    }
    if (rootId) {
      await bestEffortDelete(adminToken, `/posts/${rootId}`);
    }
    if (channelId) {
      await bestEffortDelete(adminToken, `/channels/${channelId}`);
    }
    await apiRequest(
      state.memberUser.token,
      "PUT",
      `/users/${state.memberUser.id}/patch`,
      { notify_props: originalUser.notify_props },
    ).catch(() => undefined);
    if (originalCrtPreference) {
      await apiRequest(
        state.memberUser.token,
        "PUT",
        `/users/${state.memberUser.id}/preferences`,
        [originalCrtPreference],
      ).catch(() => undefined);
    } else {
      await apiRequest(
        state.memberUser.token,
        "POST",
        `/users/${state.memberUser.id}/preferences/delete`,
        [{
          user_id: state.memberUser.id,
          category: "display_settings",
          name: "collapsed_reply_threads",
          value: "off",
        }],
      ).catch(() => undefined);
    }
    const originalCollapsedThreads = originalConfig.ServiceSettings?.CollapsedThreads;
    if (originalCollapsedThreads) {
      await apiRequest(adminToken, "PUT", "/config/patch", {
        ServiceSettings: {
          CollapsedThreads: originalCollapsedThreads,
        },
      }).catch(() => undefined);
    }
  }
});
