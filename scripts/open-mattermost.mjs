import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const extensionPath = path.resolve("./dist");
const statePath = path.resolve(process.env.MM95_STATE_FILE ?? "e2e/mm95-state.json");
const userDataDir = path.resolve(
  process.env.MM95_BROWSER_PROFILE ?? "./.tmp-open-browser/profile",
);

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
const baseUrl = process.env.MATTERMOST_BASE_URL ?? state.baseUrl ?? "http://127.0.0.1:8066";
const teamName = state.team?.name ?? state.teamName;
if (!teamName) {
  throw new Error(`Mattermost team name is missing from ${statePath}`);
}
await fs.mkdir(userDataDir, { recursive: true });

async function getExtensionServiceWorker(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  return serviceWorker;
}

async function configureExtension(context, baseUrl, teamName) {
  const serviceWorker = await getExtensionServiceWorker(context);
  const extensionId = new URL(serviceWorker.url()).host;
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const optionsPage = context.pages().find((candidate) => candidate.url() === optionsUrl)
    ?? await context.newPage();
  await optionsPage.goto(optionsUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const serverUrlInput = optionsPage.locator('input[type="url"]').first();
  const teamSlugInput = optionsPage.locator('input[type="text"]').first();
  await serverUrlInput.waitFor({ state: "visible", timeout: 30_000 });
  await serverUrlInput.fill(baseUrl);
  await teamSlugInput.fill(teamName);

  const saveButton = optionsPage.locator(".options-save-footer button");
  await saveButton.click();

  // Saving through the real Options UI preserves profile scoping and provides
  // the user gesture Chrome requires when an optional host permission is new.
  await serviceWorker.evaluate(({ serverUrl, teamSlug }) => new Promise((resolve, reject) => {
    const parsed = new URL(serverUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    const normalizedServerUrl = `${parsed.origin}${normalizedPath === "/" ? "" : normalizedPath}`;
    const originPattern = `${parsed.origin}/*`;
    const deadline = Date.now() + 60_000;
    const check = () => {
      chrome.permissions.contains({ origins: [originPattern] }, (granted) => {
        chrome.storage.local.get(null, (stored) => {
          const scopedTeamSaved = Object.entries(stored).some(
            ([key, value]) => key.startsWith("mattermostDeck.teamSlug.v1.profile.") && value === teamSlug,
          );
          if (granted && stored["mattermostDeck.serverUrl.v1"] === normalizedServerUrl && scopedTeamSaved) {
            resolve();
            return;
          }
          if (Date.now() >= deadline) {
            reject(new Error(
              `Options did not save the Mattermost URL or host permission for ${originPattern}. `
              + "Approve Chrome's permission prompt and try again.",
            ));
            return;
          }
          setTimeout(check, 250);
        });
      });
    };
    check();
  }), { serverUrl: baseUrl, teamSlug: teamName });

  return { extensionId, optionsUrl };
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

// Always create a dedicated Mattermost tab. A fresh extension install opens
// options.html automatically, and reusing the first tab can race that flow.
const page = await context.newPage();
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

const { optionsUrl } = await configureExtension(context, baseUrl, teamName);
await page.goto(`${baseUrl}/${teamName}/channels/town-square`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForTimeout(3_000);

// Keep the requested screen in front instead of Options tabs opened by the
// extension's first-install handler. Preserve unrelated restored tabs when a
// reusable browser profile was requested.
await Promise.all(
  context.pages()
    .filter((candidate) => candidate !== page && candidate.url() === optionsUrl)
    .map((candidate) => candidate.close().catch(() => undefined)),
);
await page.bringToFront();
console.log(`Mattermost Deck is ready for screen checking at ${page.url()}`);

if (process.env.MM95_BROWSER_CLOSE_AFTER_READY === "1") {
  await context.close();
  process.exit(0);
}

const shutdown = async () => {
  await context.close().catch(() => undefined);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep the browser session alive for manual interaction.
setInterval(() => {}, 1 << 30);
