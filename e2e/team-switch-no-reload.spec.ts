import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const ADMIN_USERNAME = "mm95admin";
const ADMIN_PASSWORD = "Admin1234!";

interface E2EState {
  teamName: string;
  memberUser: { id: string; username: string; password: string };
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
}

test("team route change keeps deck mounted and avoids full loading restart", async () => {
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-team-switch-"));
  const adminToken = await loginApi(ADMIN_USERNAME, ADMIN_PASSWORD);
  const timestamp = Date.now();
  const createdTeam = await apiPost<{ id: string; name: string }>(adminToken, "/teams", {
    name: `switch${timestamp}`,
    display_name: `Switch ${timestamp}`,
    type: "O",
  });

  await apiPost(adminToken, `/teams/${createdTeam.id}/members`, {
    team_id: createdTeam.id,
    user_id: state.memberUser.id,
  });

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
    await page.waitForTimeout(2_000);

    await page.evaluate(() => {
      (window as Window & { __deckRootRef?: HTMLElement | null }).__deckRootRef = document.getElementById("mattermost-deck-root");
    });

    await page.evaluate((nextTeamName: string) => {
      window.history.pushState({}, "", `/${nextTeamName}/channels/town-square`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, createdTeam.name);

    await expect(page).toHaveURL(new RegExp(`/${createdTeam.name}/channels/town-square$`), { timeout: 10_000 });
    await page.waitForTimeout(2_000);

    const rootStayedMounted = await page.evaluate(() => {
      const win = window as Window & { __deckRootRef?: HTMLElement | null };
      return win.__deckRootRef === document.getElementById("mattermost-deck-root");
    });

    expect(rootStayedMounted).toBe(true);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    await apiDelete(adminToken, `/teams/${createdTeam.id}`);
  }
});
