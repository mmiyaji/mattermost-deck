import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile =
  process.env.MM95_STATE_FILE ??
  process.env.CAB_MATTERMOST_E2E_STATE_FILE ??
  path.resolve("e2e/mm95-state.json");

interface E2EState {
  team: { id: string; name: string };
  adminUser: { token: string };
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

async function apiPut<T>(token: string, pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PUT ${pathname} failed with ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
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

test("mentions column includes @here posts on initial load", async () => {
  test.setTimeout(150_000);
  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-special-mentions-"));
  const presenceUserDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-special-presence-"));
  let postId = "";
  let channelId = "";
  let context: import("@playwright/test").BrowserContext | null = null;
  let presenceContext: import("@playwright/test").BrowserContext | null = null;
  const previousStatus = await apiGet<{ status: string }>(
    state.memberUser.token,
    `/users/${state.memberUser.id}/status`,
  );

  const marker = `special-mention-${Date.now()}`;

  try {
    const targetChannel = await apiPost<{ id: string }>(
      state.adminUser.token,
      "/channels",
      {
        team_id: state.team.id,
        name: `special-mention-${Date.now()}`,
        display_name: `Special mention ${Date.now()}`,
        type: "O",
      },
    );
    channelId = targetChannel.id;
    await apiPost(state.adminUser.token, `/channels/${channelId}/members`, {
      user_id: state.memberUser.id,
    });

    presenceContext = await chromium.launchPersistentContext(presenceUserDataDir, {
      channel: "chromium",
      headless: true,
    });
    const presencePage = presenceContext.pages()[0] ?? await presenceContext.newPage();
    await login(presencePage, state.memberUser.username, state.memberUser.password);
    await apiPut(state.memberUser.token, `/users/${state.memberUser.id}/status`, {
      user_id: state.memberUser.id,
      status: "online",
    });
    await expect.poll(
      async () => (
        await apiGet<{ status: string }>(
          state.memberUser.token,
          `/users/${state.memberUser.id}/status`,
        )
      ).status,
      { timeout: 10_000 },
    ).toBe("online");

    const created = await apiPost<{ id: string }>(state.adminUser.token, "/posts", {
      // Keep the presence browser on another channel. Posting into its active
      // channel marks the message viewed before Deck can exercise bootstrap.
      channel_id: channelId,
      message: `Deck mentions bootstrap check @here ${marker}`,
    });
    postId = created.id;
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
    await sw.evaluate((serverUrl: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          "mattermostDeck.layout.v1": [{ id: "mentions-bootstrap", type: "mentions" }],
        }, () => resolve());
      });
    }, baseUrl);

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
    });
    await login(page, state.memberUser.username, state.memberUser.password);

    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect
      .poll(async () => {
        const result = await debugRequest<{ stateStatus?: string }>(page, "getState");
        return result?.stateStatus ?? "missing";
      }, { timeout: 20_000 })
      .toBe("ready");

    const stateSnapshot = await debugRequest<{ columns: Array<{ id: string; type: string }> }>(page, "getState");
    const mentionsColumn = stateSnapshot.columns.find((column) => column.type === "mentions");
    expect(mentionsColumn).toBeTruthy();

    await expect
      .poll(async () => {
        const columnState = await debugRequest<{ postMessages?: string[] } | null>(page, "getColumnState", { id: mentionsColumn!.id });
        return columnState?.postMessages ?? [];
      }, { timeout: 60_000 })
      .toContainEqual(expect.stringContaining(marker));
  } finally {
    await context?.close().catch(() => undefined);
    await presenceContext?.close().catch(() => undefined);
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.rm(presenceUserDataDir, { recursive: true, force: true });
    if (postId) {
      await apiDelete(state.adminUser.token, `/posts/${postId}`);
    }
    if (channelId) {
      await apiDelete(state.adminUser.token, `/channels/${channelId}`);
    }
    await apiPut(state.memberUser.token, `/users/${state.memberUser.id}/status`, {
      user_id: state.memberUser.id,
      status: previousStatus.status,
    }).catch(() => undefined);
  }
});
