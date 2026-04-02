import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8065";
const stateFile =
  process.env.CAB_MATTERMOST_E2E_STATE_FILE ??
  path.resolve("../chat-agent-bridge/data/runtime/mattermost-e2e.json");

async function readState(): Promise<{ memberUser: { username: string; password: string } }> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as {
    memberUser: { username: string; password: string };
  };
}

test("injects the right rail into Mattermost", async () => {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const page = await context.newPage();
    const state = await readState();

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
    await loginId.fill(state.memberUser.username);
    await page.locator('input[name="password-input"]').fill(state.memberUser.password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/channels|messages/, { timeout: 30_000 });

    await expect(page.locator("#mattermost-deck-root")).toBeAttached();
    await expect(page.locator("body")).toHaveClass(/mattermost-deck-body-offset/);
  } finally {
    await context.close();
  }
});
