import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const RAIL_WIDTH_STORAGE_KEY = "mattermostDeck.railWidth.v1";
const DRAWER_OPEN_STORAGE_KEY = "mattermostDeck.drawerOpen.v1";
const AUTO_ADJUST_STORAGE_KEY = "mattermostDeck.autoAdjustThreadLayout.v1";
const REQUESTED_RAIL_WIDTH = 560;

interface E2EState {
  team: { id: string; name: string };
  memberUser: {
    username: string;
    password: string;
    token: string;
  };
}

interface MattermostChannel {
  id: string;
  name: string;
}

interface MattermostPost {
  id: string;
}

interface DeckDebugState {
  stateStatus: string;
  drawerOpen: boolean;
  effectiveDrawerOpen: boolean;
  railWidth: number;
  requestedRailWidth: number;
  autoAdjustThreadLayout: boolean;
  canResizeRail: boolean;
  threadLayoutMode: "normal" | "compact" | "collapsed" | "override";
  horizontalScrollLeft: number;
}

interface LayoutSnapshot {
  viewport: number;
  mattermost: number;
  center: number;
  rhs: number;
  deck: number;
  overlap: number;
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
}

async function apiCall<T>(
  token: string,
  method: "GET" | "POST" | "DELETE",
  pathname: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${method} ${pathname} failed with ${response.status}: ${text}`);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

async function login(page: Page, username: string, password: string): Promise<void> {
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

async function dismissFirstRunOverlays(page: Page): Promise<void> {
  const dismissOnboardingOverlay = async () => {
    const visibleOverlays = page.locator(
      '[data-cy="onboarding-task-list-overlay"]:visible',
    );
    if (await visibleOverlays.count() > 0) {
      await visibleOverlays.last().click({
        position: { x: 10, y: 10 },
        timeout: 5_000,
      }).catch(async (error: unknown) => {
        if (await visibleOverlays.count() > 0) {
          throw error;
        }
      });
    }
    await expect(visibleOverlays).toHaveCount(0, { timeout: 5_000 });
  };

  await dismissOnboardingOverlay();
  for (const locator of [
    page.locator('[data-testid="close_tutorial_tip"]'),
    page.getByRole("button", { name: /got it/i }),
  ]) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ force: true });
    }
  }
  // Closing a tutorial can reveal the task-list overlay again.
  await dismissOnboardingOverlay();
}

async function dismissOfflineStatusModal(page: Page): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastKnownTitle = "";

  while (Date.now() < deadline) {
    const state = await page.locator("#confirmModal:visible").evaluateAll((modals) => {
      if (modals.length === 0) {
        return { kind: "hidden" as const, title: "" };
      }

      const visibleTitles = modals.map((modal) =>
        (modal.querySelector("#confirmModalLabel")?.textContent ?? "").trim()
      );
      const unexpectedTitle = visibleTitles.find(
        (title) => title && !/Status is Set to "Offline"/i.test(title),
      );
      if (unexpectedTitle) {
        return { kind: "unexpected" as const, title: unexpectedTitle };
      }

      const modal = modals.at(-1);
      const title = visibleTitles.at(-1) ?? "";
      const cancelButton = modal?.querySelector<HTMLElement>("#cancelModalButton");
      if (!title || !cancelButton) {
        return { kind: "pending" as const, title };
      }

      // Mattermost can replace this modal while its status is settling. Read
      // the title and activate the button in one DOM task so a detached
      // instance cannot make Playwright wait on stale actionability state.
      cancelButton.click();
      return { kind: "clicked" as const, title };
    });

    if (state.kind === "hidden") {
      return;
    }
    if (state.kind === "unexpected") {
      throw new Error(`Unexpected Mattermost confirmation modal: ${state.title}`);
    }
    if (state.title) {
      lastKnownTitle = state.title;
    }
    await page.waitForTimeout(50);
  }

  throw new Error(
    `Mattermost confirmation modal did not close: ${lastKnownTitle || "title unavailable"}`,
  );
}

async function debugRequest<T>(
  page: Page,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  return await page.evaluate(({ action, payload }) => new Promise<T>((resolve, reject) => {
    const id = `deck-debug-${Math.random().toString(36).slice(2)}`;
    const handleResponse = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; result?: T }>).detail;
      if (detail?.id !== id) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("mattermost-deck-debug-response", handleResponse as EventListener);
      resolve(detail.result as T);
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener("mattermost-deck-debug-response", handleResponse as EventListener);
      reject(new Error(`Deck debug request timed out: ${action}`));
    }, 10_000);

    window.addEventListener("mattermost-deck-debug-response", handleResponse as EventListener);
    window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", {
      detail: { id, action, payload },
    }));
  }), { action, payload });
}

async function getLayoutSnapshot(page: Page): Promise<LayoutSnapshot> {
  return await page.evaluate(() => {
    const mattermost = document.querySelector<HTMLElement>("#root");
    const center = document.querySelector<HTMLElement>("#root .app__content");
    const deck = document.querySelector<HTMLElement>("#mattermost-deck-root");
    const rhs = document.querySelector<HTMLElement>("#sidebar-right.is-open, #rhsContainer");
    if (!mattermost || !center || !deck) {
      return {
        viewport: window.innerWidth,
        mattermost: -1,
        center: -1,
        rhs: -1,
        deck: -1,
        overlap: -1,
      };
    }

    const mattermostRect = mattermost.getBoundingClientRect();
    const deckRect = deck.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      mattermost: Math.round(mattermostRect.width),
      center: Math.round(center.getBoundingClientRect().width),
      rhs: Math.round(rhs?.getBoundingClientRect().width ?? 0),
      deck: Math.round(deckRect.width),
      overlap: Math.round(Math.max(0, mattermostRect.right - deckRect.left)),
    };
  });
}

async function capture(page: Page, testInfo: TestInfo, filename: string): Promise<void> {
  await page.waitForTimeout(250);
  const screenshotPath = testInfo.outputPath(filename);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach(filename, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

test("thread layout compacts, collapses, opts out, and restores without remounting Deck", async ({}, testInfo) => {
  test.setTimeout(180_000);

  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-thread-layout-"));
  let rootPostId: string | null = null;
  let replyPostId: string | null = null;
  let context: BrowserContext | null = null;

  try {
    const channel = await apiCall<MattermostChannel>(
      state.memberUser.token,
      "GET",
      `/teams/${state.team.id}/channels/name/town-square`,
    );
    const rootPost = await apiCall<MattermostPost>(
      state.memberUser.token,
      "POST",
      "/posts",
      {
        channel_id: channel.id,
        message: `Thread-aware layout E2E ${Date.now()}`,
      },
    );
    rootPostId = rootPost.id;
    const replyPost = await apiCall<MattermostPost>(
      state.memberUser.token,
      "POST",
      "/posts",
      {
        channel_id: channel.id,
        root_id: rootPost.id,
        message: "Thread-aware layout reply",
      },
    );
    replyPostId = replyPost.id;

    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1_800, height: 900 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    const [existingServiceWorker] = context.serviceWorkers();
    const serviceWorker = existingServiceWorker
      ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const extensionId = new URL(serviceWorker.url()).host;
    for (const existingPage of context.pages()) {
      if (existingPage.url().startsWith(`chrome-extension://${extensionId}/options.html`)) {
        await existingPage.close();
      }
    }
    await serviceWorker.evaluate(({
      serverUrl,
      railWidthKey,
      drawerOpenKey,
      autoAdjustKey,
      requestedWidth,
    }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": serverUrl,
      [railWidthKey]: requestedWidth,
      [drawerOpenKey]: 1,
      [autoAdjustKey]: "true",
    }), {
      serverUrl: baseUrl,
      railWidthKey: RAIL_WIDTH_STORAGE_KEY,
      drawerOpenKey: DRAWER_OPEN_STORAGE_KEY,
      autoAdjustKey: AUTO_ADJUST_STORAGE_KEY,
      requestedWidth: REQUESTED_RAIL_WIDTH,
    });

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
    });
    await login(page, state.memberUser.username, state.memberUser.password);
    await page.goto(`${baseUrl}/${state.team.name}/channels/${channel.name}`);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect(page.locator(`#post_${rootPost.id}`)).toBeVisible({ timeout: 20_000 });
    await dismissOfflineStatusModal(page);
    await dismissFirstRunOverlays(page);
    await expect.poll(
      async () => (await debugRequest<DeckDebugState>(page, "getState")).stateStatus,
      { timeout: 30_000 },
    ).toBe("ready");
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      effectiveDrawerOpen: true,
      railWidth: REQUESTED_RAIL_WIDTH,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      autoAdjustThreadLayout: true,
      threadLayoutMode: "normal",
    });

    const rootMarker = `thread-layout-${Date.now()}`;
    await page.evaluate((marker) => {
      const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
      if (!root) {
        throw new Error("Deck root not found");
      }
      root.dataset.e2eMarker = marker;
    }, rootMarker);
    await debugRequest<number>(page, "setHorizontalScrollLeft", { value: 120 });
    await expect.poll(
      async () => (await debugRequest<DeckDebugState>(page, "getState")).horizontalScrollLeft,
    ).toBe(120);

    const rootPostElement = page.locator(`#post_${rootPost.id}`);
    // The onboarding task list can mount after the channel and Deck have both
    // reported ready, so clear and verify it immediately before real pointer
    // interaction with the Mattermost post.
    await dismissFirstRunOverlays(page);
    await expect(
      page.locator('[data-cy="onboarding-task-list-overlay"]:visible'),
    ).toHaveCount(0, { timeout: 5_000 });
    await rootPostElement.hover({ timeout: 10_000 });
    const commentIcon = page.locator(`#CENTER_commentIcon_${rootPost.id}`);
    await expect(commentIcon).toBeVisible({ timeout: 10_000 });
    await commentIcon.click({ timeout: 10_000 });
    await expect(page.locator("#root")).toHaveClass(/rhs-open/, { timeout: 20_000 });
    await expect(page.locator(`#rhsPost_${replyPost.id}`)).toBeVisible({ timeout: 20_000 });

    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      effectiveDrawerOpen: true,
      railWidth: 360,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      canResizeRail: false,
      threadLayoutMode: "compact",
    });
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 1_800,
      rhs: 500,
      deck: 360,
      overlap: 0,
    });
    expect((await getLayoutSnapshot(page)).center).toBeGreaterThanOrEqual(560);
    await capture(page, testInfo, "01-wide-compact.png");

    await page.setViewportSize({ width: 1_280, height: 900 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      drawerOpen: true,
      effectiveDrawerOpen: false,
      railWidth: 52,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      canResizeRail: false,
      threadLayoutMode: "collapsed",
    });
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 1_280,
      mattermost: 1_228,
      deck: 52,
      overlap: 0,
    });
    await capture(page, testInfo, "02-narrow-collapsed.png");

    const optionsUrl = `chrome-extension://${extensionId}/options.html`;
    const optionsPage = await context.newPage();
    await optionsPage.goto(optionsUrl, { waitUntil: "domcontentloaded" });
    const appearanceNav = optionsPage.getByTestId("options-nav-appearance");
    await expect(appearanceNav).toBeVisible({ timeout: 10_000 });
    await appearanceNav.click();
    const autoAdjustToggle = optionsPage.getByTestId("auto-adjust-thread-layout");
    await expect(autoAdjustToggle).toBeVisible({ timeout: 10_000 });
    await expect(autoAdjustToggle).toBeChecked();
    await autoAdjustToggle.uncheck();
    await optionsPage.locator(".options-save-footer .options-button").click();

    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: false,
      drawerOpen: true,
      effectiveDrawerOpen: true,
      railWidth: REQUESTED_RAIL_WIDTH,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      canResizeRail: true,
      threadLayoutMode: "normal",
    });
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 1_280,
      mattermost: 720,
      deck: REQUESTED_RAIL_WIDTH,
      overlap: 0,
    });
    await capture(page, testInfo, "03-auto-adjust-off.png");

    await optionsPage.reload({ waitUntil: "domcontentloaded" });
    await optionsPage.getByTestId("options-nav-appearance").click();
    const reloadedAutoAdjustToggle = optionsPage.getByTestId("auto-adjust-thread-layout");
    await expect(reloadedAutoAdjustToggle).not.toBeChecked();
    await reloadedAutoAdjustToggle.check();
    await optionsPage.locator(".options-save-footer .options-button").click();

    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      effectiveDrawerOpen: false,
      railWidth: 52,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      canResizeRail: false,
      threadLayoutMode: "collapsed",
    });
    await page.setViewportSize({ width: 1_800, height: 900 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      effectiveDrawerOpen: true,
      railWidth: 360,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      canResizeRail: false,
      threadLayoutMode: "compact",
    });

    await page.locator("#rhsCloseButton").click({ timeout: 10_000 });
    await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, { timeout: 20_000 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      drawerOpen: true,
      effectiveDrawerOpen: true,
      railWidth: REQUESTED_RAIL_WIDTH,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      canResizeRail: true,
      threadLayoutMode: "normal",
      horizontalScrollLeft: 120,
    });
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 1_800,
      mattermost: 1_240,
      rhs: 0,
      deck: REQUESTED_RAIL_WIDTH,
      overlap: 0,
    });
    expect(await page.evaluate((marker) => {
      const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
      return {
        marker: root?.dataset.e2eMarker ?? null,
        rootCount: document.querySelectorAll("#mattermost-deck-root").length,
      };
    }, rootMarker)).toEqual({
      marker: rootMarker,
      rootCount: 1,
    });
    await capture(page, testInfo, "04-restored.png");

    const summaryPath = testInfo.outputPath("thread-aware-layout-summary.md");
    await fs.writeFile(summaryPath, [
      "# Thread-aware layout capture",
      "",
      "- `01-wide-compact.png`: 1800px viewport with the Mattermost thread open; Deck is temporarily compacted to 360px.",
      "- `02-narrow-collapsed.png`: 1280px viewport with the thread open; Deck is collapsed to its 52px rail.",
      "- `03-auto-adjust-off.png`: automatic adjustment is saved off through Options; the open thread keeps the requested 560px Deck width.",
      "- `04-restored.png`: automatic adjustment is saved back on, the thread is closed, and Deck restores its 560px width and horizontal scroll position.",
    ].join("\n"), "utf8");
    await testInfo.attach("thread-aware layout summary", {
      path: summaryPath,
      contentType: "text/markdown",
    });
  } finally {
    await context?.close().catch(() => undefined);
    await fs.rm(userDataDir, { recursive: true, force: true });
    if (replyPostId) {
      await apiCall<void>(state.memberUser.token, "DELETE", `/posts/${replyPostId}`).catch(() => undefined);
    }
    if (rootPostId) {
      await apiCall<void>(state.memberUser.token, "DELETE", `/posts/${rootPostId}`).catch(() => undefined);
    }
  }
});
