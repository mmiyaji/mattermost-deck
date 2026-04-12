import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile =
  process.env.MM95_STATE_FILE ??
  process.env.CAB_MATTERMOST_E2E_STATE_FILE ??
  path.resolve("../chat-agent-bridge/data/runtime/mattermost-e2e.json");

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

const RUN_ID = Date.now();
const TEST_CHANNEL_NAME = `e2e-imgtest-${RUN_ID}`;
const TEST_CHANNEL_DISPLAY = `E2E Image ${RUN_ID}`;

interface E2EState {
  team: { id: string; name: string; display_name?: string };
  memberUser: { id: string; username: string; password: string; token: string };
}

async function apiGet<T>(token: string, pathname: string): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${pathname} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(token: string, pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${pathname} failed: ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiDelete(token: string, pathname: string): Promise<void> {
  await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function uploadFile(token: string, channelId: string): Promise<string> {
  const pngBytes = Buffer.from(TINY_PNG_BASE64, "base64");
  const formData = new FormData();
  formData.set("channel_id", channelId);
  formData.set("files", new Blob([pngBytes], { type: "image/png" }), "test-image.png");

  const res = await fetch(`${baseUrl}/api/v4/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`File upload failed: ${res.status}: ${text}`);
  }
  const data = await res.json() as { file_infos: Array<{ id: string }> };
  return data.file_infos[0].id;
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

test("image attachment posts load in a configured channel watch column", async ({}, testInfo) => {
  testInfo.setTimeout(180_000);
  const state = JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
  const { token } = state.memberUser;

  const allChannels = await apiGet<Array<{ id: string; name: string }>>(token, `/users/me/teams/${state.team.id}/channels`);
  for (const channelEntry of allChannels.filter((entry) => entry.name.startsWith("e2e-imgtest-"))) {
    await apiDelete(token, `/channels/${channelEntry.id}`).catch(() => undefined);
  }

  const channel = await apiPost<{ id: string; name: string; display_name: string }>(token, "/channels", {
    team_id: state.team.id,
    name: TEST_CHANNEL_NAME,
    display_name: TEST_CHANNEL_DISPLAY,
    type: "O",
  });

  let createdPostId = "";

  try {
    const fileId = await uploadFile(token, channel.id);
    const post = await apiPost<{ id: string }>(token, "/posts", {
      channel_id: channel.id,
      message: "E2E test: image attachment",
      file_ids: [fileId],
    });
    createdPostId = post.id;

    const extensionPath = path.resolve("./dist");
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-img-"));
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
      await sw.evaluate((url: string) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.set({ "mattermostDeck.serverUrl.v1": url }, () => resolve());
        });
      }, baseUrl);

      const page = await context.newPage();
      await page.addInitScript(() => {
        window.localStorage.setItem("mattermostDeck.debugLogs", "1");
      });
      await login(page, state.memberUser.username, state.memberUser.password);

      await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
      await expect(page.locator("body")).toHaveClass(/mattermost-deck-body-offset/, { timeout: 10_000 });
      await expect
        .poll(async () => {
          const result = await debugRequest<{ stateStatus?: string }>(page, "getState");
          return result?.stateStatus ?? "missing";
        }, { timeout: 60_000 })
        .toBe("ready");

      const columnId = await debugRequest<string>(page, "addColumn", { type: "channelWatch" });
      await debugRequest(page, "updateColumn", {
        id: columnId,
        patch: { teamId: state.team.id, channelId: channel.id },
      });

      await expect
        .poll(async () => {
          return await debugRequest<{
            kind?: string;
            channelStatus?: string;
            selectedTeamId?: string | null;
            selectedChannelId?: string | null;
          } | null>(page, "getColumnState", { id: columnId });
        }, { timeout: 30_000 })
        .toMatchObject({
          kind: "channelWatch",
          channelStatus: "ready",
          selectedTeamId: state.team.id,
          selectedChannelId: channel.id,
        });
    } finally {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  } finally {
    if (createdPostId) {
      await apiDelete(token, `/posts/${createdPostId}`).catch(() => undefined);
    }
    await apiDelete(token, `/channels/${channel.id}`).catch(() => undefined);
  }
});
