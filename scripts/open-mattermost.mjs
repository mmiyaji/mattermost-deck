import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const DEFAULT_MAX_LIFETIME_MINUTES = 8 * 60;
const PARENT_CHECK_INTERVAL_MS = 5_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const startedAt = Date.now();
const parentPidAtStartup = process.ppid;

function parseMaxLifetimeMinutes(value) {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_MAX_LIFETIME_MINUTES;
  }

  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(
      "MM95_BROWSER_MAX_LIFETIME_MINUTES must be a non-negative number.",
    );
  }
  return minutes;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") {
      return true;
    }
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

const maxLifetimeMinutes = parseMaxLifetimeMinutes(
  process.env.MM95_BROWSER_MAX_LIFETIME_MINUTES,
);
const extensionPath = path.resolve("./dist");
const statePath = path.resolve(process.env.MM95_STATE_FILE ?? "e2e/mm95-state.json");
const userDataDir = path.resolve(
  process.env.MM95_BROWSER_PROFILE ?? "./.tmp-open-browser/profile",
);

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
const baseUrl = process.env.MATTERMOST_BASE_URL ?? state.baseUrl ?? "http://127.0.0.1:8066";
const teamName = state.team?.name ?? state.teamName;
const teamSlugRestriction = process.env.MM95_TEAM_SLUG?.trim() ?? "";
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

async function configureExtension(context, baseUrl, teamSlug) {
  const serviceWorker = await getExtensionServiceWorker(context);
  const extensionId = new URL(serviceWorker.url()).host;
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const parsedServerUrl = new URL(baseUrl);
  const isBundledLoopbackOrigin =
    parsedServerUrl.hostname === "127.0.0.1" ||
    parsedServerUrl.hostname === "localhost" ||
    parsedServerUrl.hostname === "[::1]" ||
    parsedServerUrl.hostname.endsWith(".localhost");

  if (isBundledLoopbackOrigin) {
    await serviceWorker.evaluate(({ serverUrl, teamSlug }) => {
      return new Promise((resolve) => {
        const parsed = new URL(serverUrl);
        const normalizedPath = parsed.pathname.replace(/\/+$/, "");
        const normalizedServerUrl =
          `${parsed.origin}${normalizedPath === "/" ? "" : normalizedPath}`;
        const serverKey = "mattermostDeck.serverUrl.v1";
        const teamKey = "mattermostDeck.teamSlug.v1";
        const profilesKey = "mattermostDeck.profiles.v1";

        chrome.storage.local.get(profilesKey, (stored) => {
          const writes = {
            [serverKey]: normalizedServerUrl,
            [teamKey]: teamSlug,
          };
          const registry = stored[profilesKey];
          const profiles = Array.isArray(registry?.profiles)
            ? registry.profiles
            : [];
          for (const profile of profiles) {
            if (profile?.origin !== parsed.origin || typeof profile.id !== "string") {
              continue;
            }
            writes[`${serverKey}.profile.${profile.id}`] = normalizedServerUrl;
            writes[`${teamKey}.profile.${profile.id}`] = teamSlug;
          }

          chrome.storage.local.set(writes, () => {
            chrome.runtime.sendMessage(
              { type: "mattermost-deck:sync-content-script" },
              () => resolve(),
            );
          });
        });
      });
    }, { serverUrl: baseUrl, teamSlug });
    return { extensionId, optionsUrl };
  }

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
  await teamSlugInput.fill(teamSlug);

  const saveButton = optionsPage.locator(".options-save-footer button");
  await saveButton.click();

  // Saving through the real Options UI preserves profile scoping and provides
  // the user gesture Chrome requires when an optional host permission is new.
  await serviceWorker.evaluate(({ serverUrl, teamSlug }) => new Promise((resolve, reject) => {
    const parsed = new URL(serverUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    const normalizedServerUrl = `${parsed.origin}${normalizedPath === "/" ? "" : normalizedPath}`;
    const originPattern = `${parsed.protocol}//${parsed.hostname}/*`;
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
  }), { serverUrl: baseUrl, teamSlug });

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

let shutdownPromise = null;
let requestedExitCode = 0;
let parentWatchTimer = null;
let maxLifetimeTimer = null;
let keepAliveTimer = null;

const clearLifecycleTimers = () => {
  if (parentWatchTimer !== null) {
    clearInterval(parentWatchTimer);
    parentWatchTimer = null;
  }
  if (maxLifetimeTimer !== null) {
    clearTimeout(maxLifetimeTimer);
    maxLifetimeTimer = null;
  }
  if (keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
};

const shutdown = async (exitCode, reason, error) => {
  if (exitCode !== 0) {
    requestedExitCode = exitCode;
  }
  if (error !== undefined) {
    console.error(`${reason}:`, error);
  } else {
    console.log(reason);
  }

  if (!shutdownPromise) {
    shutdownPromise = Promise.resolve().then(async () => {
      clearLifecycleTimers();
      await context.close().catch((closeError) => {
        console.error("Failed to close the browser context:", closeError);
      });
    });
  }

  await shutdownPromise;
  process.exit(requestedExitCode);
};

const requestShutdown = (exitCode, reason, error) => {
  void shutdown(exitCode, reason, error);
};

process.on("SIGINT", () => {
  requestShutdown(130, "Received SIGINT; closing the browser context.");
});
process.on("SIGTERM", () => {
  requestShutdown(143, "Received SIGTERM; closing the browser context.");
});
process.on("uncaughtException", (error, origin) => {
  requestShutdown(
    1,
    `Uncaught exception (${origin}); closing the browser context.`,
    error,
  );
});
process.on("unhandledRejection", (reason) => {
  requestShutdown(
    1,
    "Unhandled rejection; closing the browser context.",
    reason,
  );
});
context.on("close", () => {
  if (!shutdownPromise) {
    requestShutdown(0, "Browser context closed.");
  }
});

const scheduleMaxLifetime = () => {
  if (maxLifetimeMinutes === 0) {
    return;
  }

  const deadline = startedAt + maxLifetimeMinutes * 60_000;
  const checkDeadline = () => {
    maxLifetimeTimer = null;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      requestShutdown(
        0,
        `Browser maximum lifetime of ${maxLifetimeMinutes} minute(s) reached.`,
      );
      return;
    }
    maxLifetimeTimer = setTimeout(
      checkDeadline,
      Math.min(remainingMs, MAX_TIMER_DELAY_MS),
    );
  };
  checkDeadline();
};

try {
  if (!isProcessAlive(parentPidAtStartup)) {
    await shutdown(
      0,
      `Parent process ${parentPidAtStartup} is no longer running.`,
    );
  }
  parentWatchTimer = setInterval(() => {
    if (!isProcessAlive(parentPidAtStartup)) {
      requestShutdown(
        0,
        `Parent process ${parentPidAtStartup} exited; closing the browser context.`,
      );
    }
  }, PARENT_CHECK_INTERVAL_MS);
  scheduleMaxLifetime();

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

// Keep the Deck mounted across teams by default. Set MM95_TEAM_SLUG only when
// manually testing the optional single-team activation restriction.
const { optionsUrl } = await configureExtension(context, baseUrl, teamSlugRestriction);
await page.goto(`${baseUrl}/${teamName}/channels/town-square`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.locator("#mattermost-deck-root").waitFor({
  state: "attached",
  timeout: 30_000,
});

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
  await shutdown(0, "MM95_BROWSER_CLOSE_AFTER_READY requested.");
}

// Keep the browser session alive for manual interaction.
// Do not unref this or the lifecycle timers: the launcher must remain resident
// so it can close the persistent context when its parent exits.
keepAliveTimer = setInterval(() => {}, 1 << 30);
} catch (error) {
  await shutdown(
    1,
    "Mattermost browser setup failed; closing the browser context.",
    error,
  );
}
