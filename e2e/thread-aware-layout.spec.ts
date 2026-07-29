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
const PREFERRED_RAIL_WIDTH_STORAGE_KEY = "mattermostDeck.preferredRailWidth.v1";
const REQUESTED_RAIL_WIDTH = 900;
const MANUAL_OVERRIDE_RAIL_WIDTH = 480;

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
  hostLayoutMeasurementCount: number;
  userTimingMeasureCount: number;
  horizontalScrollLeft: number;
}

interface LayoutSnapshot {
  viewport: number;
  mattermost: number;
  appContent: number;
  center: number;
  rhs: number;
  deck: number;
  overlap: number;
  boundaryGap: number;
}

interface DeckWidthTrace {
  widths: number[];
  callbackCount: number;
  overflow: boolean;
}

interface DeckTargetWidthTrace {
  widths: number[];
  callbackCount: number;
}

interface LayoutTransitionTrace {
  sampleCount: number;
  maxCenterRhsOverlap: number;
  maxMattermostDeckOverlap: number;
  maxBoundaryGap: number;
  overflow: boolean;
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
    const appContent = document.querySelector<HTMLElement>("#root .app__content");
    const center = document.querySelector<HTMLElement>(
      "#root #channel_view, #root .center-channel",
    ) ?? appContent;
    const deck = document.querySelector<HTMLElement>("#mattermost-deck-root");
    const rhs = document.querySelector<HTMLElement>("#sidebar-right.is-open, #rhsContainer");
    if (!mattermost || !appContent || !center || !deck) {
      return {
        viewport: window.innerWidth,
        mattermost: -1,
        appContent: -1,
        center: -1,
        rhs: -1,
        deck: -1,
        overlap: -1,
        boundaryGap: -1,
      };
    }

    const mattermostRect = mattermost.getBoundingClientRect();
    const appContentRect = appContent.getBoundingClientRect();
    const centerRect = center.getBoundingClientRect();
    const rhsRect = rhs?.getBoundingClientRect() ?? null;
    const deckRect = deck.getBoundingClientRect();
    const rightmostMattermostEdge = Math.max(
      mattermostRect.right,
      appContentRect.right,
      centerRect.right,
      rhsRect?.right ?? 0,
    );
    return {
      viewport: window.innerWidth,
      mattermost: Math.round(mattermostRect.width),
      appContent: Math.round(appContentRect.width),
      center: Math.round(centerRect.width),
      rhs: Math.round(rhsRect?.width ?? 0),
      deck: Math.round(deckRect.width),
      overlap: Math.round(Math.max(0, rightmostMattermostEdge - deckRect.left)),
      boundaryGap: Math.round(deckRect.left - mattermostRect.right),
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

async function dragDeckToWidth(page: Page, targetWidth: number): Promise<void> {
  const viewport = page.viewportSize();
  const deckBox = await page.locator("#mattermost-deck-root").boundingBox();
  if (!viewport || !deckBox) {
    throw new Error("Deck or viewport bounds are unavailable for the resize gesture");
  }

  // The resize button spans the first 14px inside the closed shadow root.
  const handleX = deckBox.x + 7;
  const handleY = deckBox.y + deckBox.height / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  try {
    await page.mouse.move(
      handleX - (targetWidth - deckBox.width),
      handleY,
    );
  } finally {
    await page.mouse.up();
  }
}

async function startDeckWidthTrace(page: Page, maxSamples = 64): Promise<void> {
  await page.evaluate((sampleLimit) => {
    const targetWindow = window as typeof window & {
      __mattermostDeckWidthTrace?: DeckWidthTrace;
      __mattermostDeckWidthObserver?: ResizeObserver;
    };
    targetWindow.__mattermostDeckWidthObserver?.disconnect();

    const deck = document.querySelector<HTMLElement>("#mattermost-deck-root");
    if (!deck) {
      throw new Error("Deck root not found");
    }

    const trace: DeckWidthTrace = {
      widths: [Math.round(deck.getBoundingClientRect().width)],
      callbackCount: 0,
      overflow: false,
    };
    const observer = new ResizeObserver(() => {
      trace.callbackCount += 1;
      if (trace.widths.length >= sampleLimit) {
        trace.overflow = true;
        return;
      }
      trace.widths.push(Math.round(deck.getBoundingClientRect().width));
    });
    observer.observe(deck);
    targetWindow.__mattermostDeckWidthTrace = trace;
    targetWindow.__mattermostDeckWidthObserver = observer;
  }, maxSamples);
}

async function stopDeckWidthTrace(page: Page): Promise<DeckWidthTrace> {
  return await page.evaluate(() => {
    const targetWindow = window as typeof window & {
      __mattermostDeckWidthTrace?: DeckWidthTrace;
      __mattermostDeckWidthObserver?: ResizeObserver;
    };
    targetWindow.__mattermostDeckWidthObserver?.disconnect();
    targetWindow.__mattermostDeckWidthObserver = undefined;
    const trace = targetWindow.__mattermostDeckWidthTrace ?? {
      widths: [],
      callbackCount: 0,
      overflow: false,
    };
    const finalWidth = Math.round(
      document.querySelector<HTMLElement>("#mattermost-deck-root")
        ?.getBoundingClientRect().width ?? Number.NaN,
    );
    if (
      !trace.overflow &&
      Number.isFinite(finalWidth) &&
      trace.widths[trace.widths.length - 1] !== finalWidth
    ) {
      trace.widths.push(finalWidth);
    }
    return trace;
  });
}

async function startDeckTargetWidthTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const targetWindow = window as typeof window & {
      __mattermostDeckTargetWidthTrace?: DeckTargetWidthTrace;
      __mattermostDeckTargetWidthObserver?: MutationObserver;
    };
    targetWindow.__mattermostDeckTargetWidthObserver?.disconnect();

    const readTargetWidth = () => Math.round(Number.parseFloat(
      document.documentElement.style.getPropertyValue("--mattermost-deck-rail-width"),
    ));
    const initialWidth = readTargetWidth();
    const trace: DeckTargetWidthTrace = {
      widths: Number.isFinite(initialWidth) ? [initialWidth] : [],
      callbackCount: 0,
    };
    const record = () => {
      trace.callbackCount += 1;
      const width = readTargetWidth();
      if (
        Number.isFinite(width) &&
        trace.widths[trace.widths.length - 1] !== width
      ) {
        trace.widths.push(width);
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    targetWindow.__mattermostDeckTargetWidthTrace = trace;
    targetWindow.__mattermostDeckTargetWidthObserver = observer;
  });
}

async function stopDeckTargetWidthTrace(page: Page): Promise<DeckTargetWidthTrace> {
  return await page.evaluate(() => {
    const targetWindow = window as typeof window & {
      __mattermostDeckTargetWidthTrace?: DeckTargetWidthTrace;
      __mattermostDeckTargetWidthObserver?: MutationObserver;
    };
    targetWindow.__mattermostDeckTargetWidthObserver?.disconnect();
    targetWindow.__mattermostDeckTargetWidthObserver = undefined;
    return targetWindow.__mattermostDeckTargetWidthTrace ?? {
      widths: [],
      callbackCount: 0,
    };
  });
}

async function startLayoutTransitionTrace(
  page: Page,
  maxSamples = 96,
): Promise<void> {
  await page.evaluate((sampleLimit) => {
    const targetWindow = window as typeof window & {
      __mattermostDeckLayoutTrace?: LayoutTransitionTrace;
      __mattermostDeckLayoutTraceFrame?: number;
    };
    if (targetWindow.__mattermostDeckLayoutTraceFrame !== undefined) {
      window.cancelAnimationFrame(targetWindow.__mattermostDeckLayoutTraceFrame);
    }

    const trace: LayoutTransitionTrace = {
      sampleCount: 0,
      maxCenterRhsOverlap: 0,
      maxMattermostDeckOverlap: 0,
      maxBoundaryGap: 0,
      overflow: false,
    };
    const sample = () => {
      const mattermost = document.querySelector<HTMLElement>("#root");
      // Query fallbacks separately. A selector list returns the first node in
      // document order, which would choose the outer #channel_view ancestor
      // and count its 15px layout gutter as visible main content.
      const center = (
        document.querySelector<HTMLElement>("#root #channel_view .inner-wrap") ??
        document.querySelector<HTMLElement>("#root #channel_view .channel__wrap") ??
        document.querySelector<HTMLElement>("#root #channel_view .post-list__dynamic") ??
        document.querySelector<HTMLElement>("#root #channel_view")
      );
      const rhs = document.querySelector<HTMLElement>("#sidebar-right.is-open");
      const deck = document.querySelector<HTMLElement>("#mattermost-deck-root");
      if (mattermost && center && deck) {
        const mattermostRect = mattermost.getBoundingClientRect();
        const centerRect = center.getBoundingClientRect();
        const rhsRect = rhs?.getBoundingClientRect() ?? null;
        const deckRect = deck.getBoundingClientRect();
        trace.sampleCount += 1;
        trace.maxCenterRhsOverlap = Math.max(
          trace.maxCenterRhsOverlap,
          rhsRect
            ? Math.max(
              0,
              Math.min(centerRect.right, rhsRect.right) -
                Math.max(centerRect.left, rhsRect.left),
            )
            : 0,
        );
        trace.maxMattermostDeckOverlap = Math.max(
          trace.maxMattermostDeckOverlap,
          Math.max(
            0,
            Math.max(mattermostRect.right, rhsRect?.right ?? 0) -
              deckRect.left,
          ),
        );
        trace.maxBoundaryGap = Math.max(
          trace.maxBoundaryGap,
          Math.abs(deckRect.left - mattermostRect.right),
        );
      }

      if (trace.sampleCount >= sampleLimit) {
        trace.overflow = true;
        targetWindow.__mattermostDeckLayoutTraceFrame = undefined;
        return;
      }
      targetWindow.__mattermostDeckLayoutTraceFrame =
        window.requestAnimationFrame(sample);
    };

    targetWindow.__mattermostDeckLayoutTrace = trace;
    targetWindow.__mattermostDeckLayoutTraceFrame =
      window.requestAnimationFrame(sample);
  }, maxSamples);
}

async function stopLayoutTransitionTrace(
  page: Page,
): Promise<LayoutTransitionTrace> {
  return await page.evaluate(() => {
    const targetWindow = window as typeof window & {
      __mattermostDeckLayoutTrace?: LayoutTransitionTrace;
      __mattermostDeckLayoutTraceFrame?: number;
    };
    if (targetWindow.__mattermostDeckLayoutTraceFrame !== undefined) {
      window.cancelAnimationFrame(targetWindow.__mattermostDeckLayoutTraceFrame);
      targetWindow.__mattermostDeckLayoutTraceFrame = undefined;
    }
    return targetWindow.__mattermostDeckLayoutTrace ?? {
      sampleCount: 0,
      maxCenterRhsOverlap: 0,
      maxMattermostDeckOverlap: 0,
      maxBoundaryGap: 0,
      overflow: false,
    };
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
      viewport: { width: 2_400, height: 900 },
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
      preferredRailWidthKey,
      requestedWidth,
    }) => new Promise<void>((resolve) => {
      chrome.storage.local.remove(railWidthKey, () => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          [preferredRailWidthKey]: String(requestedWidth),
          [drawerOpenKey]: 1,
          [autoAdjustKey]: "true",
        }, () => resolve());
      });
    }), {
      serverUrl: baseUrl,
      railWidthKey: RAIL_WIDTH_STORAGE_KEY,
      drawerOpenKey: DRAWER_OPEN_STORAGE_KEY,
      autoAdjustKey: AUTO_ADJUST_STORAGE_KEY,
      preferredRailWidthKey: PREFERRED_RAIL_WIDTH_STORAGE_KEY,
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
    const userTimingMeasureCountBeforeLayoutChurn = (
      await debugRequest<DeckDebugState>(page, "getState")
    ).userTimingMeasureCount;
    const layoutBeforeRhs = await getLayoutSnapshot(page);
    expect(layoutBeforeRhs).toMatchObject({
      viewport: 2_400,
      rhs: 0,
      deck: REQUESTED_RAIL_WIDTH,
      overlap: 0,
      boundaryGap: 0,
    });
    await capture(page, testInfo, "00-wide-normal.png");

    const rootPostElement = page.locator(`#post_${rootPost.id}`);
    const openThread = async () => {
      // The onboarding task list can mount after the channel and Deck have
      // both reported ready, so clear and verify it immediately before real
      // pointer interaction with the Mattermost post.
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
      await dismissFirstRunOverlays(page);
    };

    await startDeckTargetWidthTrace(page);
    await startDeckWidthTrace(page);
    await startLayoutTransitionTrace(page);
    await openThread();

    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      effectiveDrawerOpen: true,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      canResizeRail: true,
      threadLayoutMode: "compact",
    });
    const autoCompactRailWidth = (
      await debugRequest<DeckDebugState>(page, "getState")
    ).railWidth;
    expect(autoCompactRailWidth).toBe(400);
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 2_400,
      rhs: 500,
      deck: autoCompactRailWidth,
      overlap: 0,
      boundaryGap: 0,
    });
    const layoutWithThread = await getLayoutSnapshot(page);
    expect(
      REQUESTED_RAIL_WIDTH - layoutWithThread.deck,
    ).toBe(layoutWithThread.rhs);
    expect(
      Math.abs(layoutWithThread.center - layoutBeforeRhs.center),
    ).toBeLessThanOrEqual(4);
    await page.waitForTimeout(500);
    const initialOpenTargetTrace = await stopDeckTargetWidthTrace(page);
    const initialOpenRenderedTrace = await stopDeckWidthTrace(page);
    const initialOpenLayoutTrace = await stopLayoutTransitionTrace(page);
    expect(initialOpenTargetTrace.widths).toEqual([
      REQUESTED_RAIL_WIDTH,
      autoCompactRailWidth,
    ]);
    expect(initialOpenRenderedTrace.overflow).toBe(false);
    expect(initialOpenRenderedTrace.widths.length).toBeGreaterThanOrEqual(2);
    expect(initialOpenRenderedTrace.widths.every((width, index, widths) => (
      index === 0 || width <= widths[index - 1] + 2
    ))).toBe(true);
    expect(Math.abs(
      (initialOpenRenderedTrace.widths.at(-1) ?? Number.NaN) -
      autoCompactRailWidth,
    )).toBeLessThanOrEqual(2);
    expect(initialOpenLayoutTrace.overflow).toBe(false);
    expect(initialOpenLayoutTrace.sampleCount).toBeGreaterThan(0);
    expect(initialOpenLayoutTrace.maxCenterRhsOverlap).toBeLessThanOrEqual(4);
    expect(initialOpenLayoutTrace.maxMattermostDeckOverlap).toBeLessThanOrEqual(1);
    expect(initialOpenLayoutTrace.maxBoundaryGap).toBeLessThanOrEqual(1);
    await capture(page, testInfo, "01-wide-compact.png");

    // Read Mattermost's live RHS box during viewport resize. This prevents a
    // stale 500px wide-screen measurement from producing an intermediate
    // collapse before Mattermost settles on its 400px narrow-screen RHS.
    await startDeckTargetWidthTrace(page);
    await startDeckWidthTrace(page);
    await startLayoutTransitionTrace(page);
    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.waitForTimeout(100);
    expect(await debugRequest<DeckDebugState>(page, "getState")).toMatchObject({
      effectiveDrawerOpen: true,
      railWidth: 320,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "compact",
    });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: 320,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "compact",
    });
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 1_440,
      rhs: 400,
      deck: 320,
      overlap: 0,
      boundaryGap: 0,
    });
    await page.waitForTimeout(500);
    const narrowCompactTargetTrace = await stopDeckTargetWidthTrace(page);
    const narrowCompactRenderedTrace = await stopDeckWidthTrace(page);
    const narrowCompactLayoutTrace = await stopLayoutTransitionTrace(page);
    expect(narrowCompactTargetTrace.widths).toEqual([400, 320]);
    expect(narrowCompactRenderedTrace.overflow).toBe(false);
    expect(narrowCompactRenderedTrace.widths.every((width, index, widths) => (
      index === 0 || width <= widths[index - 1] + 2
    ))).toBe(true);
    expect(narrowCompactLayoutTrace.overflow).toBe(false);
    expect(narrowCompactLayoutTrace.sampleCount).toBeGreaterThan(0);
    expect(narrowCompactLayoutTrace.maxCenterRhsOverlap).toBeLessThanOrEqual(4);
    expect(narrowCompactLayoutTrace.maxMattermostDeckOverlap).toBeLessThanOrEqual(1);
    expect(narrowCompactLayoutTrace.maxBoundaryGap).toBeLessThanOrEqual(1);

    // At a compact width below the persisted 360px minimum, one keyboard
    // expansion reaches that usable minimum and creates a manual override.
    const narrowCompactDeckBox = await page
      .locator("#mattermost-deck-root")
      .boundingBox();
    if (!narrowCompactDeckBox) {
      throw new Error("Compact Deck bounds are unavailable");
    }
    await page.mouse.click(
      narrowCompactDeckBox.x + 7,
      narrowCompactDeckBox.y + narrowCompactDeckBox.height / 2,
    );
    await page.keyboard.press("ArrowLeft");
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: 360,
      requestedRailWidth: 360,
      threadLayoutMode: "override",
    });
    await page.locator("#rhsCloseButton").click({ timeout: 10_000 });
    await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, { timeout: 20_000 });
    await dragDeckToWidth(page, REQUESTED_RAIL_WIDTH);
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: REQUESTED_RAIL_WIDTH,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "normal",
    });
    await openThread();
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: 500,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "compact",
    });

    await startDeckTargetWidthTrace(page);
    await page.setViewportSize({ width: 2_400, height: 900 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: autoCompactRailWidth,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "compact",
    });
    await page.waitForTimeout(500);
    expect((await stopDeckTargetWidthTrace(page)).widths).toEqual([
      500,
      autoCompactRailWidth,
    ]);

    const compactDeckBox = await page.locator("#mattermost-deck-root").boundingBox();
    if (!compactDeckBox) {
      throw new Error("Deck bounds are unavailable for the resize gesture");
    }
    // The resize button spans the first 14px inside the closed shadow root.
    const resizeHandleX = compactDeckBox.x + 7;
    const resizeHandleY = compactDeckBox.y + compactDeckBox.height / 2;

    // Pointer jitter below the drag threshold must not create a manual
    // override.
    await page.mouse.move(resizeHandleX, resizeHandleY);
    await page.mouse.down();
    try {
      await page.mouse.move(resizeHandleX + 2, resizeHandleY);
    } finally {
      await page.mouse.up();
    }
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 10_000 },
    ).toMatchObject({
      railWidth: autoCompactRailWidth,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      canResizeRail: true,
      threadLayoutMode: "compact",
    });
    await expect.poll(async () => await serviceWorker.evaluate(async (railWidthKey) => {
      const stored = await chrome.storage.local.get(railWidthKey);
      return stored[railWidthKey];
    }, RAIL_WIDTH_STORAGE_KEY), { timeout: 10_000 }).toBe(REQUESTED_RAIL_WIDTH);

    // Both directions remain usable while compacted. First shrink the 400px
    // automatic width to 376px and verify it becomes the exact override.
    const shrunkOverrideRailWidth = autoCompactRailWidth - 24;
    await dragDeckToWidth(page, shrunkOverrideRailWidth);
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: shrunkOverrideRailWidth,
      requestedRailWidth: shrunkOverrideRailWidth,
      threadLayoutMode: "override",
    });
    await expect.poll(async () => await serviceWorker.evaluate(async (railWidthKey) => {
      const stored = await chrome.storage.local.get(railWidthKey);
      return stored[railWidthKey];
    }, RAIL_WIDTH_STORAGE_KEY), { timeout: 10_000 }).toBe(shrunkOverrideRailWidth);

    // Restore the original 900px baseline, reopen the RHS, and exercise the
    // opposite direction from 400px to a 480px manual override.
    await page.locator("#rhsCloseButton").click({ timeout: 10_000 });
    await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, { timeout: 20_000 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: shrunkOverrideRailWidth,
      requestedRailWidth: shrunkOverrideRailWidth,
      threadLayoutMode: "normal",
    });
    await dragDeckToWidth(page, REQUESTED_RAIL_WIDTH);
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: REQUESTED_RAIL_WIDTH,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "normal",
    });
    await openThread();
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: autoCompactRailWidth,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "compact",
    });

    await dragDeckToWidth(page, MANUAL_OVERRIDE_RAIL_WIDTH);

    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      drawerOpen: true,
      effectiveDrawerOpen: true,
      railWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      canResizeRail: true,
      threadLayoutMode: "override",
    });
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 2_400,
      mattermost: 1_920,
      rhs: 500,
      deck: MANUAL_OVERRIDE_RAIL_WIDTH,
      overlap: 0,
    });
    await expect.poll(async () => await serviceWorker.evaluate(async (railWidthKey) => {
      const stored = await chrome.storage.local.get(railWidthKey);
      return stored[railWidthKey];
    }, RAIL_WIDTH_STORAGE_KEY), { timeout: 10_000 }).toBe(MANUAL_OVERRIDE_RAIL_WIDTH);
    await capture(page, testInfo, "02-manual-override.png");

    await page.locator("#rhsCloseButton").click({ timeout: 10_000 });
    await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, { timeout: 20_000 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      drawerOpen: true,
      effectiveDrawerOpen: true,
      railWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      canResizeRail: true,
      threadLayoutMode: "normal",
      horizontalScrollLeft: 0,
    });
    await debugRequest<number>(page, "setHorizontalScrollLeft", { value: 120 });
    await expect.poll(
      async () => (
        await debugRequest<DeckDebugState>(page, "getState")
      ).horizontalScrollLeft,
    ).toBe(120);

    await page.setViewportSize({ width: 1_440, height: 900 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      threadLayoutMode: "normal",
    });
    await startDeckTargetWidthTrace(page);
    await startDeckWidthTrace(page);
    await startLayoutTransitionTrace(page);
    await openThread();
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      effectiveDrawerOpen: false,
      railWidth: 52,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      canResizeRail: false,
      threadLayoutMode: "collapsed",
    });
    await page.waitForTimeout(100);
    const collapsedOpenTargetTrace = await stopDeckTargetWidthTrace(page);
    const collapsedOpenRenderedTrace = await stopDeckWidthTrace(page);
    const collapsedOpenLayoutTrace = await stopLayoutTransitionTrace(page);
    expect(collapsedOpenTargetTrace.widths).toEqual([
      MANUAL_OVERRIDE_RAIL_WIDTH,
      52,
    ]);
    expect(collapsedOpenRenderedTrace.overflow).toBe(false);
    expect([...new Set(collapsedOpenRenderedTrace.widths)]).toEqual([
      MANUAL_OVERRIDE_RAIL_WIDTH,
      52,
    ]);
    expect(collapsedOpenLayoutTrace.overflow).toBe(false);
    expect(collapsedOpenLayoutTrace.sampleCount).toBeGreaterThan(0);
    expect(collapsedOpenLayoutTrace.maxCenterRhsOverlap).toBeLessThanOrEqual(4);
    expect(collapsedOpenLayoutTrace.maxMattermostDeckOverlap).toBeLessThanOrEqual(1);
    expect(collapsedOpenLayoutTrace.maxBoundaryGap).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1_280, height: 900 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      drawerOpen: true,
      effectiveDrawerOpen: false,
      railWidth: 52,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      canResizeRail: false,
      threadLayoutMode: "collapsed",
    });
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 1_280,
      mattermost: 1_228,
      deck: 52,
      overlap: 0,
    });
    await capture(page, testInfo, "03-narrow-collapsed.png");

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
      railWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      canResizeRail: true,
      threadLayoutMode: "normal",
    });
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 1_280,
      mattermost: 800,
      deck: MANUAL_OVERRIDE_RAIL_WIDTH,
      overlap: 0,
    });
    await expect(page.locator("#root")).toHaveClass(/rhs-open/);
    await expect(page.locator(`#rhsPost_${replyPost.id}`)).toBeVisible();
    await capture(page, testInfo, "04-auto-adjust-off.png");

    await optionsPage.reload({ waitUntil: "domcontentloaded" });
    await optionsPage.getByTestId("options-nav-appearance").click();
    const reloadedAutoAdjustToggle = optionsPage.getByTestId("auto-adjust-thread-layout");
    await expect(reloadedAutoAdjustToggle).not.toBeChecked();
    await startDeckTargetWidthTrace(page);
    await startDeckWidthTrace(page);
    await reloadedAutoAdjustToggle.check();
    await optionsPage.locator(".options-save-footer .options-button").click();

    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      effectiveDrawerOpen: false,
      railWidth: 52,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      canResizeRail: false,
      threadLayoutMode: "collapsed",
    });
    await page.waitForTimeout(500);
    const enabledWhileOpenTargetTrace = await stopDeckTargetWidthTrace(page);
    const enabledWhileOpenRenderedTrace = await stopDeckWidthTrace(page);
    expect(enabledWhileOpenTargetTrace.widths).toEqual([
      MANUAL_OVERRIDE_RAIL_WIDTH,
      52,
    ]);
    expect(enabledWhileOpenRenderedTrace.overflow).toBe(false);
    expect(enabledWhileOpenRenderedTrace.widths.every((width, index, widths) => (
      index === 0 || width <= widths[index - 1] + 2
    ))).toBe(true);
    await page.setViewportSize({ width: 1_800, height: 900 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      effectiveDrawerOpen: false,
      railWidth: 52,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      canResizeRail: false,
      threadLayoutMode: "collapsed",
    });

    // Let Mattermost's own responsive RHS breakpoint and the bounded trailing
    // host measurement settle before testing the independent close motion.
    await page.waitForTimeout(2_000);
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 10_000 },
    ).toMatchObject({
      effectiveDrawerOpen: false,
      railWidth: 52,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      threadLayoutMode: "collapsed",
    });
    const widthBeforeClose = (
      await debugRequest<DeckDebugState>(page, "getState")
    ).railWidth;
    await expect.poll(
      () => getLayoutSnapshot(page),
      { timeout: 10_000 },
    ).toMatchObject({
      deck: widthBeforeClose,
      overlap: 0,
    });
    await startDeckTargetWidthTrace(page);
    await startDeckWidthTrace(page);
    await page.locator("#rhsCloseButton").click({ timeout: 10_000 });
    await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, { timeout: 20_000 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      drawerOpen: true,
      effectiveDrawerOpen: true,
      railWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      requestedRailWidth: MANUAL_OVERRIDE_RAIL_WIDTH,
      canResizeRail: true,
      threadLayoutMode: "normal",
      horizontalScrollLeft: 120,
    });
    await expect.poll(() => getLayoutSnapshot(page), { timeout: 20_000 }).toMatchObject({
      viewport: 1_800,
      mattermost: 1_320,
      rhs: 0,
      deck: MANUAL_OVERRIDE_RAIL_WIDTH,
      overlap: 0,
    });
    const closeTargetTrace = await stopDeckTargetWidthTrace(page);
    const closeRenderedTrace = await stopDeckWidthTrace(page);
    expect(closeTargetTrace.widths).toEqual([
      widthBeforeClose,
      MANUAL_OVERRIDE_RAIL_WIDTH,
    ]);
    expect(closeRenderedTrace.overflow).toBe(false);
    expect(closeRenderedTrace.widths.every((width, index, widths) => (
      index === 0 || width >= widths[index - 1] - 2
    ))).toBe(true);
    expect(Math.abs(
      (closeRenderedTrace.widths.at(-1) ?? Number.NaN) -
      MANUAL_OVERRIDE_RAIL_WIDTH,
    )).toBeLessThanOrEqual(2);
    await capture(page, testInfo, "05-restored.png");

    await dragDeckToWidth(page, REQUESTED_RAIL_WIDTH);
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      railWidth: REQUESTED_RAIL_WIDTH,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "normal",
    });

    // Mattermost uses the same canonical RHS for search, pinned messages,
    // channel information, and plugin-provided views. Search is a reliable
    // real-world surface that contains none of the thread-specific markers.
    const searchBox = page.locator("#searchBox");
    await expect(searchBox).toBeVisible({ timeout: 10_000 });
    await searchBox.fill(rootPost.message);
    await expect(searchBox).toHaveValue(rootPost.message);
    // Search suggestions are an overlay, not a canonical Mattermost RHS, and
    // must not constrain Deck before the search is submitted.
    await expect(page.locator("#root")).not.toHaveClass(/rhs-open/);
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 10_000 },
    ).toMatchObject({
      railWidth: REQUESTED_RAIL_WIDTH,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "normal",
    });
    const layoutBeforeSearch = await getLayoutSnapshot(page);
    await startDeckTargetWidthTrace(page);
    await startDeckWidthTrace(page);
    await startLayoutTransitionTrace(page);
    await searchBox.press("Enter");
    const openRhs = page.locator("#sidebar-right.is-open");
    await expect(openRhs).toBeVisible({ timeout: 20_000 });
    await expect(openRhs).toContainText("Search Results", { timeout: 20_000 });
    await expect(page.locator([
      ".ThreadViewer:visible",
      "[data-testid='thread-viewer']:visible",
      "#reply_textbox:visible",
      "[id^='rhsPost_']:visible",
    ].join(", "))).toHaveCount(0);

    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      autoAdjustThreadLayout: true,
      effectiveDrawerOpen: true,
      railWidth: 400,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      canResizeRail: true,
      threadLayoutMode: "compact",
    });
    const searchDebugState = await debugRequest<DeckDebugState>(page, "getState");
    expect(searchDebugState.railWidth).toBe(400);
    await expect.poll(
      () => getLayoutSnapshot(page),
      { timeout: 10_000 },
    ).toMatchObject({
      deck: searchDebugState.railWidth,
      overlap: 0,
    });
    const layoutWithSearch = await getLayoutSnapshot(page);
    expect(REQUESTED_RAIL_WIDTH - layoutWithSearch.deck).toBe(layoutWithSearch.rhs);
    expect(
      Math.abs(layoutWithSearch.center - layoutBeforeSearch.center),
    ).toBeLessThanOrEqual(4);
    await page.waitForTimeout(100);
    const searchTargetTrace = await stopDeckTargetWidthTrace(page);
    const searchRenderedTrace = await stopDeckWidthTrace(page);
    const searchLayoutTrace = await stopLayoutTransitionTrace(page);
    expect(searchTargetTrace.widths).toEqual([REQUESTED_RAIL_WIDTH, 400]);
    expect(searchRenderedTrace.overflow).toBe(false);
    expect([...new Set(searchRenderedTrace.widths)]).toEqual([
      REQUESTED_RAIL_WIDTH,
      400,
    ]);
    expect(searchLayoutTrace.overflow).toBe(false);
    expect(searchLayoutTrace.maxCenterRhsOverlap).toBeLessThanOrEqual(4);
    expect(searchLayoutTrace.maxMattermostDeckOverlap).toBeLessThanOrEqual(1);
    expect(searchLayoutTrace.maxBoundaryGap).toBeLessThanOrEqual(1);
    await capture(page, testInfo, "06-search-rhs-adjusted.png");

    // Switching the content inside an already-open canonical RHS must not
    // briefly restore the requested Deck width or remount Deck.
    await startDeckWidthTrace(page);
    await page.locator("#channelHeaderPinButton").click({ timeout: 10_000 });
    await expect(openRhs).toContainText("Pinned messages", { timeout: 20_000 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "compact",
    });
    await page.waitForTimeout(500);
    const contentSwitchTrace = await stopDeckWidthTrace(page);
    expect(contentSwitchTrace.overflow).toBe(false);
    expect(contentSwitchTrace.widths.length).toBeGreaterThan(0);
    expect(contentSwitchTrace.widths.every(
      (width) => width < REQUESTED_RAIL_WIDTH,
    )).toBe(true);
    expect(
      Math.max(...contentSwitchTrace.widths) - Math.min(...contentSwitchTrace.widths),
    ).toBeLessThanOrEqual(4);
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

    // Exercise many internal RHS child mutations in bounded batches. Reusing
    // one hidden node prevents the test itself from accumulating DOM or trace
    // samples while still giving layout observers 1,000 add/remove records.
    let lastStableMeasurementCount = -1;
    let stableMeasurementSamples = 0;
    await expect.poll(async () => {
      const count = (
        await debugRequest<DeckDebugState>(page, "getState")
      ).hostLayoutMeasurementCount;
      if (count === lastStableMeasurementCount) {
        stableMeasurementSamples += 1;
      } else {
        lastStableMeasurementCount = count;
        stableMeasurementSamples = 0;
      }
      return stableMeasurementSamples;
    }, {
      timeout: 5_000,
      // The implementation's trailing host-layout settle window is 360ms.
      // Two unchanged samples 400ms apart guarantee that callbacks from the
      // preceding pinned/search transition cannot enter the churn baseline.
      intervals: [400],
    }).toBeGreaterThanOrEqual(2);
    const measurementCountBeforeChurn = lastStableMeasurementCount;
    await startDeckWidthTrace(page);
    await page.evaluate(async () => {
      const rhs = document.querySelector<HTMLElement>("#sidebar-right.is-open");
      const churnHost = rhs?.querySelector<HTMLElement>("#rhsContainer") ?? rhs;
      if (!churnHost) {
        throw new Error("Open Mattermost RHS not found");
      }
      const churnNode = document.createElement("span");
      churnNode.hidden = true;
      churnNode.dataset.e2eRhsChurn = "true";

      for (let batch = 0; batch < 20; batch += 1) {
        for (let operation = 0; operation < 50; operation += 1) {
          churnHost.appendChild(churnNode);
          churnNode.remove();
        }
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      }
    });
    await page.waitForTimeout(500);
    const churnTrace = await stopDeckWidthTrace(page);
    expect(churnTrace.overflow).toBe(false);
    expect(churnTrace.callbackCount).toBeLessThanOrEqual(4);
    expect(churnTrace.widths.every(
      (width) => Math.abs(width - searchDebugState.railWidth) <= 4,
    )).toBe(true);
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 10_000 },
    ).toMatchObject({
      effectiveDrawerOpen: true,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "compact",
    });
    const postChurnState = await debugRequest<DeckDebugState>(page, "getState");
    // A small constant number of ResizeObserver/settle callbacks is allowed;
    // it must remain unrelated to the 1,000 RHS child mutations.
    expect(
      postChurnState.hostLayoutMeasurementCount - measurementCountBeforeChurn,
    ).toBeLessThanOrEqual(8);
    expect(await page.evaluate((marker) => ({
      marker: document.querySelector<HTMLElement>("#mattermost-deck-root")
        ?.dataset.e2eMarker ?? null,
      rootCount: document.querySelectorAll("#mattermost-deck-root").length,
      churnNodeCount: document.querySelectorAll("[data-e2e-rhs-churn]").length,
    }), rootMarker)).toEqual({
      marker: rootMarker,
      rootCount: 1,
      churnNodeCount: 0,
    });

    // The pinned-posts header in Mattermost 9.5 does not expose the same
    // close-button id as the thread/search headers. Use Mattermost's own
    // Ctrl+. RHS toggle so this remains surface-independent.
    await page.keyboard.press("Control+.");
    await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, { timeout: 20_000 });
    await expect.poll(
      async () => await debugRequest<DeckDebugState>(page, "getState"),
      { timeout: 20_000 },
    ).toMatchObject({
      effectiveDrawerOpen: true,
      railWidth: REQUESTED_RAIL_WIDTH,
      requestedRailWidth: REQUESTED_RAIL_WIDTH,
      threadLayoutMode: "normal",
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
    await expect.poll(async () => await serviceWorker.evaluate(async (railWidthKey) => {
      const stored = await chrome.storage.local.get(railWidthKey);
      return stored[railWidthKey];
    }, RAIL_WIDTH_STORAGE_KEY), { timeout: 10_000 }).toBe(REQUESTED_RAIL_WIDTH);
    const finalDebugState = await debugRequest<DeckDebugState>(page, "getState");
    expect(
      finalDebugState.userTimingMeasureCount -
        userTimingMeasureCountBeforeLayoutChurn,
    ).toBeLessThanOrEqual(20);

    const summaryPath = testInfo.outputPath("thread-aware-layout-summary.md");
    await fs.writeFile(summaryPath, [
      "# Thread-aware layout capture",
      "",
      "- `00-wide-normal.png`: 2400px viewport before opening a Mattermost right pane; Deck uses the requested 900px width.",
      "- `01-wide-compact.png`: the 500px Mattermost thread pane opens at 2400px; Deck yields exactly 500px (900px to 400px) while the main content keeps its pre-open width.",
      "- `02-manual-override.png`: dragging the compacted Deck changes it to a persisted 480px manual override while the thread remains open.",
      "- `03-narrow-collapsed.png`: when less than 280px would remain after reopening the thread and resizing to 1280px, Deck collapses to the 52px rail.",
      "- `04-auto-adjust-off.png`: automatic adjustment is saved off through Options; the open thread keeps the requested 480px Deck width.",
      "- `05-restored.png`: automatic adjustment is saved back on, the thread closes, and Deck restores its persisted 480px width and horizontal scroll position.",
      "- `06-search-rhs-adjusted.png`: Mattermost search opens the same 500px canonical right pane and applies the same exact 900px-to-400px width transfer.",
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
