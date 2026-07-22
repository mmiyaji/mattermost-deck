import { expect, test, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const profileId = "e2e-localization-profile";

interface E2EState {
  memberUser: { username: string; password: string };
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
}

async function launchExtension(): Promise<{ context: BrowserContext; serviceWorker: Worker; userDataDir: string }> {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-locale-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const [existingWorker] = context.serviceWorkers();
  const serviceWorker = existingWorker ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
  return { context, serviceWorker, userDataDir };
}

async function configureExtension(serviceWorker: Worker, language: string): Promise<void> {
  await serviceWorker.evaluate(({ serverUrl, profile, locale }) => new Promise<void>((resolve) => {
    chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": serverUrl,
      [`mattermostDeck.serverUrl.v1.profile.${profile}`]: serverUrl,
      [`mattermostDeck.language.v1.profile.${profile}`]: locale,
      "mattermostDeck.profiles.v1": {
        version: 1,
        profiles: [{
          id: profile,
          name: "Localization E2E",
          origin: serverUrl,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
        activeProfileIdByOrigin: { [serverUrl]: profile },
        lastActiveProfileId: profile,
      },
    }, () => resolve());
  }), { serverUrl: baseUrl, profile: profileId, locale: language });
}

async function setLanguage(serviceWorker: Worker, language: string): Promise<void> {
  await serviceWorker.evaluate(({ profile, locale }) => new Promise<void>((resolve) => {
    chrome.storage.local.set({ [`mattermostDeck.language.v1.profile.${profile}`]: locale }, () => resolve());
  }), { profile: profileId, locale: language });
}

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${baseUrl}/landing#/login`);
  const browserChoice = page.getByText("View in Browser");
  const loginId = page.locator('input[name="loginId"]');
  await Promise.race([
    browserChoice.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    loginId.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
  ]);
  if (await browserChoice.isVisible().catch(() => false)) await browserChoice.click();
  await loginId.waitFor({ state: "visible", timeout: 30_000 });
  await loginId.fill(username);
  await page.locator('input[name="password-input"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/channels|messages/, { timeout: 30_000 });
}

async function debugRequest<T>(page: Page, action: string, payload?: Record<string, unknown>): Promise<T> {
  return page.evaluate(({ action, payload }) => new Promise<T>((resolve) => {
    const id = `deck-debug-${Math.random().toString(36).slice(2)}`;
    const handleResponse = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; result?: T }>).detail;
      if (detail?.id !== id) return;
      window.removeEventListener("mattermost-deck-debug-response", handleResponse as EventListener);
      resolve(detail.result as T);
    };
    window.addEventListener("mattermost-deck-debug-response", handleResponse as EventListener);
    window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", { detail: { id, action, payload } }));
  }), { action, payload });
}

test("Deck and popup follow every supported configured language", async () => {
  const state = await readState();
  const { context, serviceWorker, userDataDir } = await launchExtension();
  try {
    await configureExtension(serviceWorker, "en");
    const extensionId = new URL(serviceWorker.url()).host;
    const mattermostPage = context.pages()[0] ?? await context.newPage();
    await mattermostPage.addInitScript(() => window.localStorage.setItem("mattermostDeck.debugLogs", "1"));
    await login(mattermostPage, state.memberUser.username, state.memberUser.password);
    await expect(mattermostPage.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect.poll(async () => (await debugRequest<{ stateStatus?: string }>(mattermostPage, "getState")).stateStatus, { timeout: 20_000 }).toBe("ready");
    await debugRequest(mattermostPage, "addColumn", { type: "diagnostics" });

    const popupPage = await context.newPage();
    const expectations = [
      { language: "en", empty: "Start with a channel", diagnostics: "Diagnostics", popup: "Install Mattermost app" },
      { language: "ja", empty: "チャンネルを選択して開始", diagnostics: "診断", popup: "Mattermost アプリをインストール" },
      { language: "de", empty: "Mit einem Kanal beginnen", diagnostics: "Diagnose", popup: "Mattermost-App installieren" },
      { language: "fr", empty: "Commencer avec un canal", diagnostics: "Diagnostic", popup: "Installer l’application Mattermost" },
      { language: "zh-CN", empty: "从频道开始", diagnostics: "诊断", popup: "安装 Mattermost 应用" },
    ];

    for (const expected of expectations) {
      await setLanguage(serviceWorker, expected.language);
      await expect.poll(() => debugRequest<string>(mattermostPage, "getRenderedText"), { timeout: 10_000 }).toContain(expected.empty);
      await expect.poll(() => debugRequest<string>(mattermostPage, "getRenderedText"), { timeout: 10_000 }).toContain(expected.diagnostics);
      await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect(popupPage.locator("#label-install")).toHaveText(expected.popup);
      await expect(popupPage.locator("html")).toHaveAttribute("lang", expected.language);
    }
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test("PWA install guide appears immediately and accepts a late install event", async () => {
  const { context, serviceWorker, userDataDir } = await launchExtension();
  try {
    await configureExtension(serviceWorker, "en");
    const installPage = context.pages()[0] ?? await context.newPage();
    await installPage.addInitScript(() => {
      const blocker = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      (window as Window & { __mmdE2eInstallBlocker?: EventListener }).__mmdE2eInstallBlocker = blocker;
      window.addEventListener("beforeinstallprompt", blocker, true);
    });
    await installPage.addInitScript({ path: path.resolve("dist/pwa-install.js") });
    await installPage.goto(baseUrl);
    await installPage.waitForLoadState("load");
    await expect(installPage.locator("#mmd-install-fallback-title")).toHaveText("Install Mattermost manually", { timeout: 15_000 });
    await expect(installPage.locator("#mmd-install-fallback")).toContainText(/Chrome:.*Install page as app/i);

    await installPage.evaluate(() => {
      const testWindow = window as Window & { __mmdE2eInstallBlocker?: EventListener };
      if (testWindow.__mmdE2eInstallBlocker) {
        window.removeEventListener("beforeinstallprompt", testWindow.__mmdE2eInstallBlocker, true);
        delete testWindow.__mmdE2eInstallBlocker;
      }
      const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: "dismissed" }>;
      };
      event.prompt = async () => undefined;
      event.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(event);
    });
    await expect(installPage.locator("#mmd-install-overlay")).toBeVisible();
    await expect(installPage.locator("#mmd-install-title")).toHaveText("Install Mattermost");
    await expect(installPage.locator("#mmd-install-fallback")).toHaveCount(0);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
