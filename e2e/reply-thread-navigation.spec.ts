import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const ADMIN_EMAIL = "admin@mm95test.local";
const ADMIN_USERNAME = "mm95admin";
const ADMIN_PASSWORD = "Admin1234!";
const DEFAULT_TEAM_NAME = "testteam";
const MEMBER_USERNAME = "mm95user";
const MEMBER_PASSWORD = "User1234!";
const MEMBER_EMAIL = "user@mm95test.local";

interface E2EState {
  baseUrl: string;
  teamName: string;
  memberUser: { id?: string; username: string; password: string; token: string };
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

async function apiCall<T>(method: string, pathname: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${pathname} failed with ${res.status}: ${text}`);
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

async function ensureMm95State(state: E2EState): Promise<E2EState> {
  try {
    await loginApi(state.memberUser.username, state.memberUser.password);
    return state;
  } catch {
    // Recreate the lightweight test setup when the container has been reset.
  }

  let adminToken: string;
  try {
    adminToken = await loginApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  } catch {
    await apiCall("POST", "/users", {
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      allow_marketing: false,
    });
    adminToken = await loginApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  }

  await apiCall("PUT", "/config/patch", {
    ServiceSettings: { SiteURL: baseUrl },
  }, adminToken).catch(() => undefined);

  const teams = await apiGet<Array<{ id: string; name: string }>>(adminToken, "/teams");
  let team = teams.find((entry) => entry.name === (state.teamName || DEFAULT_TEAM_NAME));
  if (!team) {
    team = await apiCall<{ id: string; name: string }>("POST", "/teams", {
      name: state.teamName || DEFAULT_TEAM_NAME,
      display_name: "Test Team",
      type: "O",
    }, adminToken);
  }

  let memberId = state.memberUser.id;
  try {
    const member = await apiCall<{ id: string }>("GET", `/users/username/${state.memberUser.username || MEMBER_USERNAME}`, undefined, adminToken);
    memberId = member.id;
  } catch {
    const member = await apiCall<{ id: string }>("POST", "/users", {
      email: MEMBER_EMAIL,
      username: state.memberUser.username || MEMBER_USERNAME,
      password: state.memberUser.password || MEMBER_PASSWORD,
      allow_marketing: false,
    }, adminToken);
    memberId = member.id;
  }

  await apiCall("POST", `/teams/${team.id}/members`, {
    team_id: team.id,
    user_id: memberId,
  }, adminToken).catch(() => undefined);

  const memberToken = await loginApi(state.memberUser.username || MEMBER_USERNAME, state.memberUser.password || MEMBER_PASSWORD);
  const nextState: E2EState = {
    baseUrl,
    teamName: team.name,
    memberUser: {
      username: state.memberUser.username || MEMBER_USERNAME,
      password: state.memberUser.password || MEMBER_PASSWORD,
      token: memberToken,
    },
  };
  await fs.writeFile(stateFile, JSON.stringify(nextState, null, 2), "utf8");
  return nextState;
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

test("reply posts open in permalink thread view without getting stuck in loading", async () => {
  const initialState = await readState();
  const state = await ensureMm95State(initialState);
  const token = await loginApi(state.memberUser.username, state.memberUser.password);
  const extensionPath = path.resolve("./dist");

  const teams = await apiGet<Array<{ id: string; name: string }>>(token, "/users/me/teams");
  const team = teams.find((entry) => entry.name === state.teamName);
  expect(team).toBeTruthy();

  const channels = await apiGet<Array<{ id: string; name: string }>>(token, `/users/me/teams/${team!.id}/channels`);
  const townSquare = channels.find((entry) => entry.name === "town-square");
  expect(townSquare).toBeTruthy();

  const parentMessage = `Deck reply thread root ${Date.now()}`;
  const replyMessage = `Deck reply thread child ${Date.now()}`;
  const parent = await apiPost<{ id: string }>(token, "/posts", {
    channel_id: townSquare!.id,
    message: parentMessage,
  });
  const reply = await apiPost<{ id: string; root_id?: string }>(token, "/posts", {
    channel_id: townSquare!.id,
    root_id: parent.id,
    message: replyMessage,
  });

  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-reply-nav-"));
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
    await sw.evaluate((serverUrl: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ "mattermostDeck.serverUrl.v1": serverUrl }, () => resolve());
      });
    }, baseUrl);

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
    });
    await login(page, state.memberUser.username, state.memberUser.password);

    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(2_500);

    await page.evaluate(({ teamName, postId, rootId, channelName }) => {
      window.dispatchEvent(new CustomEvent("mattermost-deck-debug-open-thread", {
        detail: { teamName, postId, rootId, channelName },
      }));
    }, {
      teamName: state.teamName,
      postId: reply.id,
      rootId: parent.id,
      channelName: "town-square",
    });

    await expect(page).toHaveURL(new RegExp(`/pl/${reply.id}$`), { timeout: 20_000 });
    await expect(page.getByText(replyMessage, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    await apiDelete(token, `/posts/${reply.id}`).catch(() => undefined);
    await apiDelete(token, `/posts/${parent.id}`).catch(() => undefined);
  }
});
