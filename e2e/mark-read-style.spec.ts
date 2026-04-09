import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.CAB_MATTERMOST_E2E_STATE_FILE ?? path.resolve("e2e/mm95-compat-state.json");
const ADMIN_USERNAME = "mm95admin";
const ADMIN_PASSWORD = "Admin1234!";

interface E2EState {
  team: { id: string; name: string };
  memberUser: { id: string; username: string; password: string; token: string };
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

async function apiPost<T>(token: string, pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${pathname} failed with ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function apiDelete(token: string, pathname: string): Promise<void> {
  await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

async function apiPostNoContent(token: string, pathname: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${pathname} failed with ${res.status}: ${text}`);
  }
}

async function loginViaApi(username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`login failed for ${username}: ${res.status} ${text}`);
  }
  const token = res.headers.get("Token");
  if (!token) {
    throw new Error(`login succeeded for ${username} but no token header was returned`);
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

test("mark read hover style stays legible with Mattermost theme", async () => {
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-mark-read-style-"));
  const adminToken = await loginViaApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const createdPostIds: string[] = [];
  let channelId = "";

  const createdChannel = await apiPost<{ id: string; name: string }>(adminToken, "/channels", {
    team_id: state.team.id,
    name: `mark-read-${Date.now()}`,
    display_name: `Mark Read ${Date.now()}`,
    type: "O",
  });
  channelId = createdChannel.id;
  await apiPost(adminToken, `/channels/${channelId}/members`, {
    user_id: state.memberUser.id,
  });

  const baselinePost = await apiPost<{ id: string }>(adminToken, "/posts", {
    channel_id: channelId,
    message: `mark-read-style-baseline-${Date.now()}`,
  });
  createdPostIds.push(baselinePost.id);
  await apiPostNoContent(state.memberUser.token, "/channels/members/me/view", {
    channel_id: channelId,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

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

    await sw.evaluate(({ serverUrl, teamId, channelId }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          "mattermostDeck.theme.v1": "mattermost",
          "mattermostDeck.layout.v1": [{
            id: "channel-watch-style",
            type: "channelWatch",
            teamId,
            channelId,
          }],
        }, () => resolve());
      });
    }, { serverUrl: baseUrl, teamId: state.team.id, channelId });

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
    });
    await login(page, state.memberUser.username, state.memberUser.password);

    const created = await apiPost<{ id: string }>(adminToken, "/posts", {
      channel_id: channelId,
      message: `mark-read-style-${Date.now()}`,
    });
    createdPostIds.push(created.id);

    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect
      .poll(async () => {
        const result = await debugRequest<{ stateStatus?: string }>(page, "getState");
        return result?.stateStatus ?? "missing";
      }, { timeout: 20_000 })
      .toBe("ready");

    await expect
      .poll(async () => {
        return await debugRequest<{
          shellTheme: string | null;
          postCardCount: number;
          unreadSeparatorCount: number;
          separatorLabels: string[];
        }>(page, "getUnreadDebugInfo");
      }, { timeout: 30_000 })
      .toMatchObject({
        shellTheme: "mattermost",
        unreadSeparatorCount: 1,
      });

    const styleValue = await debugRequest<{
      color: string;
      backgroundColor: string;
      borderColor: string;
      shellTheme: string | null;
      actionLabelVisible: string;
    }>(page, "getUnreadMarkReadStyle");

    expect(styleValue.shellTheme).toBe("mattermost");
    expect(styleValue.actionLabelVisible).toBe("inline-block");
    expect(styleValue.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(styleValue.color).not.toBe("rgb(255, 215, 210)");
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    for (const createdPostId of createdPostIds) {
      await apiDelete(state.memberUser.token, `/posts/${createdPostId}`);
    }
    if (channelId) {
      await apiDelete(adminToken, `/channels/${channelId}`);
    }
  }
});
