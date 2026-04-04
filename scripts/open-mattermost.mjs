import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const extensionPath = path.resolve("./dist");
const statePath = path.resolve("../chat-agent-bridge/data/runtime/mattermost-e2e.json");
const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8065";
const userDataDir = path.resolve("./.tmp-open-browser/profile");

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
await fs.mkdir(userDataDir, { recursive: true });

async function getExtensionId(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  return new URL(serviceWorker.url()).host;
}

async function configureExtension(page, extensionId, baseUrl, teamName) {
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const serverUrlInput = page.locator('input[type="url"]').first();
  const teamSlugInput = page.locator('input[type="text"]').first();
  await serverUrlInput.waitFor({ state: "visible", timeout: 30_000 });
  await serverUrlInput.fill(baseUrl);
  await teamSlugInput.fill(teamName);

  const saveButton = page.getByRole("button", { name: /save/i }).first();
  await saveButton.click();
  await page.waitForTimeout(1_000);
}

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: false,
  viewport: null,
  args: [
    "--start-maximized",
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(`${baseUrl}/landing#/login`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});

const browserChoice = page.getByText("View in Browser");
const loginId = page.locator('input[name="loginId"]');
const passwordInput = page.locator('input[name="password-input"]');

await Promise.race([
  browserChoice.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
  loginId.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
  page.waitForURL(/channels|messages/, { timeout: 15_000 }).catch(() => undefined),
]);

if (await browserChoice.isVisible().catch(() => false)) {
  await browserChoice.click();
  await Promise.race([
    loginId.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    page.waitForURL(/channels|messages/, { timeout: 30_000 }).catch(() => undefined),
  ]);
}

if ((await page.waitForURL(/channels|messages/, { timeout: 2_000 }).then(() => true).catch(() => false)) === false) {
  await loginId.waitFor({ state: "visible", timeout: 30_000 });
  await loginId.fill(state.memberUser.username);
  await passwordInput.fill(state.memberUser.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/channels|messages/, { timeout: 60_000 });
}

const extensionId = await getExtensionId(context);
await configureExtension(page, extensionId, baseUrl, state.team.name);
await page.goto(`${baseUrl}/${state.team.name}/channels/town-square`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForTimeout(3_000);

const shutdown = async () => {
  await context.close().catch(() => undefined);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep the browser session alive for manual interaction.
setInterval(() => {}, 1 << 30);
