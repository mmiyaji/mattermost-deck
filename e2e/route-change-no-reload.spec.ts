import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");

interface E2EState {
  baseUrl: string;
  teamName: string;
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

test("route change to pl does not trigger deck app-state reload", async () => {
  const state = await readState();
  const token = await loginApi(state.memberUser.username, state.memberUser.password);
  const extensionPath = path.resolve("./dist");

  const teams = await apiGet<Array<{ id: string; name: string }>>(token, "/users/me/teams");
  const team = teams.find((entry) => entry.name === state.teamName);
  expect(team).toBeTruthy();

  const channels = await apiGet<Array<{ id: string; name: string }>>(token, `/users/me/teams/${team!.id}/channels`);
  const townSquare = channels.find((entry) => entry.name === "town-square");
  expect(townSquare).toBeTruthy();

  const postsResponse = await apiGet<{
    order: string[];
  }>(token, `/channels/${townSquare!.id}/posts?page=0&per_page=20`);
  expect(postsResponse.order.length).toBeGreaterThan(0);
  const postId = postsResponse.order[0]!;

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
  const debugLogs: string[] = [];
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
    await sw.evaluate((serverUrl: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ "mattermostDeck.serverUrl.v1": serverUrl }, () => resolve());
      });
    }, baseUrl);

    const page = await context.newPage();
    page.on("console", (message) => {
      const text = message.text();
      if (text.includes("[deck-debug]")) {
        debugLogs.push(text);
      }
    });
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
    });
    await login(page, state.memberUser.username, state.memberUser.password);
    await page.goto(`${baseUrl}/${state.teamName}/channels/town-square`);
    await page.waitForURL(new RegExp(`/${state.teamName}/channels/town-square`), { timeout: 30_000 });

    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(2_500);

    capture = true;
    await page.evaluate(({ teamName, postId }) => {
      window.dispatchEvent(new CustomEvent("mattermost-deck-debug-open-thread", {
        detail: { teamName, postId, channelName: "town-square" },
      }));
    }, { teamName: state.teamName, postId });
    await page.waitForTimeout(3_000);

    console.log("DEBUG LOGS AFTER ROUTE CHANGE");
    for (const line of debugLogs) {
      console.log(line);
    }

    expect(appStateRequests).toEqual([
      `GET ${baseUrl}/api/v4/users/me`,
      `GET ${baseUrl}/api/v4/users/me/teams`,
      `GET ${baseUrl}/api/v4/users/${state.memberUser.id}/teams/unread`,
      `GET ${baseUrl}/api/v4/teams/name/${state.teamName}`,
    ]);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
