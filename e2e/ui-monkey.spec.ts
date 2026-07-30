import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  ChaosCrawler,
  COMMON_IGNORE_PATTERNS,
  type ActionResult,
  type Driver,
  type PageResult,
} from "chaosbringer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl =
  process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const monkeyEnabled = process.env.MM_DECK_RUN_MONKEY === "1";
const stateFile =
  process.env.MM95_STATE_FILE ??
  path.resolve("e2e/mm95-state.json");
const extensionPath = path.resolve("./dist");
const seedValue = Number.parseInt(
  process.env.MM_DECK_MONKEY_SEED ?? "20260729",
  10,
);
const monkeySeed = Number.isFinite(seedValue)
  ? Math.abs(seedValue)
  : 20260729;
const actionValue = Number.parseInt(
  process.env.MM_DECK_MONKEY_ACTIONS ?? "60",
  10,
);
const monkeyActionCount = Number.isFinite(actionValue)
  ? Math.min(Math.max(actionValue, 24), 240)
  : 60;
const headed = process.env.MM_DECK_MONKEY_HEADED === "1";
const layoutStorageKey = "mattermostDeck.layout.v1";
const maximumMentionBuffer = 500;
const mebibyte = 1024 * 1024;
const expectedHttpNoiseRules = [
  {
    name: "unsupported-groups-endpoint",
    method: "GET",
    status: 501,
    path: /^\/api\/v4\/users\/[^/]+\/groups$/,
    maximum: 8,
  },
  {
    name: "playbooks-settings-unauthorized",
    method: "GET",
    status: 401,
    path: /^\/plugins\/playbooks\/api\/v0\/settings$/,
    maximum: 4,
  },
  {
    name: "cloud-products-unavailable",
    method: "GET",
    status: 400,
    path: /^\/api\/v4\/cloud\/products\/selfhosted$/,
    maximum: 4,
  },
  {
    name: "trial-license-forbidden",
    method: "GET",
    status: 403,
    path: /^\/api\/v4\/trial-license\/prev$/,
    maximum: 4,
  },
  {
    name: "apps-bindings-missing",
    method: "GET",
    status: 404,
    path: /^\/plugins\/com\.mattermost\.apps\/api\/v1\/bindings$/,
    maximum: 4,
  },
] as const;

test.describe.configure({ mode: "serial" });

interface E2EState {
  mattermostVersion?: string;
  team: {
    id: string;
    name: string;
  };
  adminUser: {
    username: string;
    password: string;
  };
  memberUser: {
    id: string;
    username: string;
    password: string;
  };
}

interface MattermostTeam {
  id: string;
  name: string;
}

interface MattermostChannel {
  id: string;
  name: string;
  team_id: string;
}

interface MattermostPost {
  id: string;
}

interface DeckColumnDebugState {
  postStatus?: string;
  visiblePostIds?: string[];
  mentionBufferedPostIds?: string[];
  mentionLoadActive?: boolean;
  mentionLoadCompletedTeams?: number;
  mentionLoadTotalTeams?: number;
  mentionPendingUpdateCount?: number;
  mentionUpdatePending?: boolean;
}

interface DeckState {
  stateStatus: string;
  wsStatus?: string;
  currentTeamId?: string;
  currentChannelId?: string;
  railWidth?: number;
  requestedRailWidth?: number;
  focusedColumnId?: string | null;
  threadLayoutMode?: string;
  drawerOpen?: boolean;
  effectiveDrawerOpen?: boolean;
  canResizeRail?: boolean;
  maximumInteractiveRailWidth?: number;
  columns: Array<{
    id: string;
    type: string;
    teamId?: string;
    channelId?: string;
    query?: string;
    unreadOnly?: boolean;
  }>;
}

interface MentionPresentationState {
  progressPresent?: boolean;
  updateButtonPresent?: boolean;
  updateCount?: number;
  skeletonCount?: number;
  viewportScrollTop?: number | null;
}

interface MemorySample {
  label: string;
  step: number;
  capturedAt: string;
  heapUsedBytes: number;
  heapTotalBytes: number;
  nodes: number;
  documents: number;
  eventListeners: number;
}

interface MonkeyActionLog {
  step: number;
  name: string;
  startedAt: string;
  durationMs: number;
  success: boolean;
  detail?: unknown;
  error?: string;
}

interface CoreInvariantSnapshot {
  state: DeckState;
  mention: DeckColumnDebugState | null;
  presentation: MentionPresentationState | null;
  layout: {
    viewport: number;
    deck: number;
    overlap: number;
    innerOverflow: number;
    boundaryGap: number;
    deckLeft: number;
    deckRight: number;
    marker: string | null;
    rootCount: number;
  };
}

async function readState(): Promise<E2EState> {
  return JSON.parse(
    await fs.readFile(stateFile, "utf8"),
  ) as E2EState;
}

async function loginViaApi(
  username: string,
  password: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v4/users/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      login_id: username,
      password,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Mattermost login failed with ${response.status}`,
    );
  }
  const token = response.headers.get("Token");
  if (!token) {
    throw new Error("Mattermost login did not return a token");
  }
  return token;
}

async function apiRequest<T>(
  token: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body:
      body === undefined
        ? undefined
        : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${method} ${pathname} failed with ${response.status}: ${detail}`,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function apiDelete(
  token: string,
  pathname: string,
): Promise<void> {
  await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).catch(() => undefined);
}

async function login(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}/landing#/login`, {
    waitUntil: "domcontentloaded",
  });
  const browserChoice = page.getByText("View in Browser");
  const loginId = page.locator('input[name="loginId"]');

  await Promise.race([
    browserChoice
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => undefined),
    loginId
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => undefined),
  ]);
  if (await browserChoice.isVisible().catch(() => false)) {
    await browserChoice.click();
  }

  await loginId.waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await loginId.fill(username);
  await page
    .locator('input[name="password-input"]')
    .fill(password);
  await page
    .getByRole("button", { name: /log in/i })
    .click();
  await page.waitForURL(/channels|messages/, {
    timeout: 30_000,
  });
}

async function dismissMattermostOverlays(
  page: Page,
): Promise<void> {
  const noThanks = page.getByText(
    /No thanks, I.*figure it out myself/,
  );
  if (await noThanks.isVisible().catch(() => false)) {
    await noThanks.click({ force: true }).catch(() => undefined);
  }
  const dismissOnboardingOverlay = async () => {
    const overlays = page.locator(
      '[data-cy="onboarding-task-list-overlay"]:visible',
    );
    if ((await overlays.count()) > 0) {
      await overlays.last().click({
        position: { x: 10, y: 10 },
        timeout: 5_000,
      }).catch(async (error: unknown) => {
        if ((await overlays.count()) > 0) {
          throw error;
        }
      });
    }
    await expect(overlays).toHaveCount(0, {
      timeout: 5_000,
    });
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
  await dismissOnboardingOverlay();

  const deadline = Date.now() + 10_000;
  let lastKnownTitle = "";
  while (Date.now() < deadline) {
    const modalState = await page
      .locator("#confirmModal:visible")
      .evaluateAll((modals) => {
        if (modals.length === 0) {
          return {
            kind: "hidden" as const,
            title: "",
          };
        }
        const titles = modals.map((modal) =>
          (
            modal.querySelector(
              "#confirmModalLabel, #genericModalLabel",
            )?.textContent ?? ""
          ).trim()
        );
        const unexpectedTitle = titles.find(
          (title) =>
            title &&
            !/status is (?:set to )?["“]?offline["”]?/i.test(title),
        );
        if (unexpectedTitle) {
          return {
            kind: "unexpected" as const,
            title: unexpectedTitle,
          };
        }
        const modal = modals.at(-1);
        const title = titles.at(-1) ?? "";
        const cancelButton =
          modal?.querySelector<HTMLElement>(
            "#cancelModalButton",
          );
        if (!title || !cancelButton) {
          return {
            kind: "pending" as const,
            title,
          };
        }
        cancelButton.click();
        return {
          kind: "clicked" as const,
          title,
        };
      });
    if (modalState.kind === "hidden") {
      return;
    }
    if (modalState.kind === "unexpected") {
      throw new Error(
        `Unexpected Mattermost confirmation modal: ${modalState.title}`,
      );
    }
    if (modalState.title) {
      lastKnownTitle = modalState.title;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(
    `Mattermost confirmation modal did not close: ${
      lastKnownTitle || "title unavailable"
    }`,
  );
}

async function debugRequest<T>(
  page: Page,
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return await page.evaluate(
    ({ action, payload }) =>
      new Promise<T>((resolve, reject) => {
        const requestId =
          `deck-monkey-${Math.random().toString(36).slice(2)}`;
        const timeoutId = window.setTimeout(() => {
          window.removeEventListener(
            "mattermost-deck-debug-response",
            handleResponse as EventListener,
          );
          reject(
            new Error(
              `Mattermost Deck debug request timed out: ${action}`,
            ),
          );
        }, 3_000);
        const handleResponse = (event: Event) => {
          const customEvent = event as CustomEvent<{
            id?: string;
            result?: T;
          }>;
          if (customEvent.detail?.id !== requestId) {
            return;
          }
          window.clearTimeout(timeoutId);
          window.removeEventListener(
            "mattermost-deck-debug-response",
            handleResponse as EventListener,
          );
          resolve(customEvent.detail?.result as T);
        };
        window.addEventListener(
          "mattermost-deck-debug-response",
          handleResponse as EventListener,
        );
        window.dispatchEvent(
          new CustomEvent("mattermost-deck-debug-request", {
            detail: {
              id: requestId,
              action,
              payload,
            },
          }),
        );
      }),
    { action, payload },
  );
}

async function waitForDeckDebugBridge(
  page: Page,
): Promise<void> {
  await expect
    .poll(
      async () =>
        debugRequest<DeckState>(
          page,
          "getState",
        )
          .then(() => true)
          .catch(() => false),
      {
        timeout: 30_000,
        intervals: [100, 250, 500],
      },
    )
    .toBe(true);
}

async function closeRightSidebar(page: Page): Promise<boolean> {
  if ((await page.locator("#root.rhs-open").count()) === 0) {
    return false;
  }
  await page.keyboard.press("Control+.");
  await expect(page.locator("#root")).not.toHaveClass(
    /rhs-open/,
    { timeout: 15_000 },
  );
  return true;
}

async function clickMattermostHref(
  page: Page,
  href: string,
): Promise<void> {
  const link = page
    .locator(`a[href="${href}"]`)
    .filter({ visible: true })
    .first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link
    .evaluate((element) =>
      (element as HTMLAnchorElement).click()
    );
}

async function navigateToChannel(
  page: Page,
  team: MattermostTeam,
  channel: MattermostChannel,
): Promise<void> {
  const channelPath = `/${team.name}/channels/${channel.name}`;
  if (new URL(page.url()).pathname !== channelPath) {
    if (
      !new URL(page.url()).pathname.startsWith(
        `/${team.name}/`,
      )
    ) {
      await clickMattermostHref(page, `/${team.name}`);
      await page.waitForURL(
        new RegExp(`/${team.name}/channels/`),
        { timeout: 20_000 },
      );
    }
    await clickMattermostHref(page, channelPath);
    await page.waitForURL(
      new RegExp(
        `/${team.name}/channels/${channel.name}$`,
      ),
      { timeout: 20_000 },
    );
  }
  await dismissMattermostOverlays(page);
  await expect
    .poll(
      async () => {
        const state =
          await debugRequest<DeckState>(
            page,
            "getState",
          );
        return {
          stateStatus: state.stateStatus,
          wsStatus: state.wsStatus,
          currentTeamId: state.currentTeamId,
          currentChannelId: state.currentChannelId,
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      stateStatus: "ready",
      wsStatus: "connected",
      currentTeamId: team.id,
      currentChannelId: channel.id,
    });
}

async function openThread(
  page: Page,
  team: MattermostTeam,
  channel: MattermostChannel,
  rootPostId: string,
  replyPostId: string,
): Promise<void> {
  await page.setViewportSize({
    width: 1_800,
    height: 900,
  });
  await navigateToChannel(page, team, channel);
  await closeRightSidebar(page);
  const post = page.locator(`#post_${rootPostId}`);
  await expect(post).toBeVisible({ timeout: 20_000 });
  await post.hover();
  const replyButton = page.locator(
    `#CENTER_commentIcon_${rootPostId}`,
  );
  await expect(replyButton).toBeVisible({
    timeout: 10_000,
  });
  await replyButton.click();
  await expect(page.locator("#root")).toHaveClass(
    /rhs-open/,
    { timeout: 20_000 },
  );
  await expect(
    page.locator(`#rhsPost_${replyPostId}`),
  ).toBeVisible({ timeout: 20_000 });
}

async function openSearch(
  page: Page,
  query: string,
): Promise<void> {
  await page.setViewportSize({
    width: 1_800,
    height: 900,
  });
  await closeRightSidebar(page);
  const legacySearch = page.locator("#searchBox");
  const usesLegacySearch = await legacySearch
    .isVisible()
    .catch(() => false);
  if (!usesLegacySearch) {
    const searchLauncher = page.locator(
      "#searchFormContainer",
    );
    await expect(searchLauncher).toBeVisible({
      timeout: 10_000,
    });
    await searchLauncher.click();
  }
  const search = usesLegacySearch
    ? legacySearch
    : page.getByRole("searchbox", {
      name: /search messages/i,
    });
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.fill(query);
  await search.press("Enter");
  await expect(
    page.locator("#sidebar-right.is-open"),
  ).toBeVisible({ timeout: 20_000 });
}

async function dragDeckToWidth(
  page: Page,
  targetWidth: number,
): Promise<void> {
  const deckBox = await page
    .locator("#mattermost-deck-root")
    .boundingBox();
  if (!deckBox) {
    throw new Error(
      "Deck bounds are unavailable for resize",
    );
  }
  const handleX = deckBox.x + 7;
  const handleY = deckBox.y + deckBox.height / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  try {
    await page.mouse.move(
      handleX - (targetWidth - deckBox.width),
      handleY,
      { steps: 6 },
    );
  } finally {
    await page.mouse.up();
  }
}

async function collectMemory(
  cdp: CDPSession,
  label: string,
  step: number,
): Promise<MemorySample> {
  await cdp.send("Runtime.discardConsoleEntries");
  await cdp.send("HeapProfiler.collectGarbage");
  const [heap, dom] = await Promise.all([
    cdp.send("Runtime.getHeapUsage") as Promise<{
      usedSize: number;
      totalSize: number;
    }>,
    cdp.send("Memory.getDOMCounters") as Promise<{
      documents: number;
      nodes: number;
      jsEventListeners: number;
    }>,
  ]);
  return {
    label,
    step,
    capturedAt: new Date().toISOString(),
    heapUsedBytes: heap.usedSize,
    heapTotalBytes: heap.totalSize,
    nodes: dom.nodes,
    documents: dom.documents,
    eventListeners: dom.jsEventListeners,
  };
}

async function waitForCoreInvariants(
  page: Page,
  marker: string,
  initializeMarker: boolean,
): Promise<CoreInvariantSnapshot> {
  let snapshot: CoreInvariantSnapshot | null = null;
  await expect
    .poll(
      async () => {
        try {
          snapshot = await inspectCoreInvariants(
            page,
            marker,
            initializeMarker,
          );
          return "stable";
        } catch (error) {
          return error instanceof Error
            ? error.message
            : String(error);
        }
      },
      {
        timeout: 20_000,
        intervals: [200, 350, 500, 750],
      },
    )
    .toBe("stable");
  if (!snapshot) {
    throw new Error(
      "Core invariant snapshot was not collected",
    );
  }
  return snapshot;
}

async function inspectCoreInvariants(
  page: Page,
  marker: string,
  initializeMarker: boolean,
): Promise<CoreInvariantSnapshot> {
  const state = await debugRequest<DeckState>(
    page,
    "getState",
  );
  const mentionColumn = state.columns.find(
    (column) => column.type === "mentions",
  );
  const mention = mentionColumn
    ? await debugRequest<DeckColumnDebugState | null>(
        page,
        "getColumnState",
        { id: mentionColumn.id },
      )
    : null;
  const presentation = mentionColumn
    ? await debugRequest<MentionPresentationState | null>(
        page,
        "getMentionPresentationState",
        { id: mentionColumn.id },
      )
    : null;
  const layout = await page.evaluate(
    ({ marker, initializeMarker }) => {
      const mattermost =
        document.querySelector<HTMLElement>("#root");
      const appContent =
        document.querySelector<HTMLElement>(
          "#root .app__content",
        );
      const center =
        document.querySelector<HTMLElement>(
          "#root #channel_view, #root .center-channel",
        ) ?? appContent;
      const rhs =
        document.querySelector<HTMLElement>(
          "#sidebar-right.is-open",
        );
      const deck =
        document.querySelector<HTMLElement>(
          "#mattermost-deck-root",
        );
      if (
        !mattermost ||
        !appContent ||
        !center ||
        !deck
      ) {
        throw new Error(
          "Mattermost or Deck layout nodes are missing",
        );
      }
      if (initializeMarker) {
        deck.dataset.e2eMonkeyMarker = marker;
      }
      const mattermostRect =
        mattermost.getBoundingClientRect();
      const appContentRect =
        appContent.getBoundingClientRect();
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
        deck: Math.round(deckRect.width),
        overlap: Math.round(
          Math.max(
            0,
            mattermostRect.right - deckRect.left,
          ),
        ),
        innerOverflow: Math.round(
          Math.max(
            0,
            rightmostMattermostEdge -
              mattermostRect.right,
          ),
        ),
        boundaryGap: Math.round(
          deckRect.left - mattermostRect.right,
        ),
        deckLeft: Math.round(deckRect.left),
        deckRight: Math.round(deckRect.right),
        marker:
          deck.dataset.e2eMonkeyMarker ?? null,
        rootCount:
          document.querySelectorAll(
            "#mattermost-deck-root",
          ).length,
      };
    },
    { marker, initializeMarker },
  );

  expect(layout.rootCount).toBe(1);
  expect(layout.marker).toBe(marker);
  expect(layout.deck).toBeGreaterThanOrEqual(50);
  expect(layout.deckLeft).toBeGreaterThanOrEqual(-2);
  expect(layout.deckRight).toBeLessThanOrEqual(
    layout.viewport + 2,
  );
  expect(layout.overlap).toBeLessThanOrEqual(2);
  expect(Math.abs(layout.boundaryGap)).toBeLessThanOrEqual(
    2,
  );
  expect(state.stateStatus).toBe("ready");
  expect(state.wsStatus).toBe("connected");

  const columnIds = state.columns.map(
    (column) => column.id,
  );
  expect(new Set(columnIds).size).toBe(columnIds.length);
  expect(mentionColumn).toBeTruthy();
  expect(mention?.postStatus).not.toBe("error");
  expect(presentation?.skeletonCount ?? 0).toBe(0);

  for (const postIds of [
    mention?.visiblePostIds ?? [],
    mention?.mentionBufferedPostIds ?? [],
  ]) {
    expect(new Set(postIds).size).toBe(postIds.length);
    expect(postIds.length).toBeLessThanOrEqual(
      maximumMentionBuffer,
    );
  }

  const completed =
    mention?.mentionLoadCompletedTeams ?? 0;
  const total = mention?.mentionLoadTotalTeams ?? 0;
  expect(completed).toBeLessThanOrEqual(total);
  if (mention?.mentionUpdatePending) {
    expect(
      presentation?.updateButtonPresent,
    ).toBe(true);
    expect(presentation?.updateCount).toBe(
      mention.mentionPendingUpdateCount,
    );
  }

  return {
    state,
    mention,
    presentation,
    layout,
  };
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const screenshotPath = testInfo.outputPath(name);
  await page.screenshot({
    path: screenshotPath,
    fullPage: false,
  });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

function actionResult(
  name: string,
  success: boolean,
  error?: string,
): ActionResult {
  return {
    type:
      name.includes("scroll") ||
      name.includes("viewport") ||
      name.includes("drag")
        ? "scroll"
        : name.includes("navigate")
          ? "navigate"
          : "click",
    target: name,
    success,
    error,
    timestamp: Date.now(),
  };
}

test(
  "seeded Mattermost Deck UI monkey remains stable",
  async ({}, testInfo) => {
    test.skip(
      !monkeyEnabled,
      "Run npm run test:monkey or set MM_DECK_RUN_MONKEY=1",
    );
    test.setTimeout(15 * 60_000);

    const state = await readState();
    const adminToken = await loginViaApi(
      state.adminUser.username,
      state.adminUser.password,
    );
    const memberToken = await loginViaApi(
      state.memberUser.username,
      state.memberUser.password,
    );
    const timestamp = Date.now();
    const userDataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "mattermost-deck-ui-monkey-"),
    );
    let context: BrowserContext | null = null;
    let cdp: CDPSession | null = null;
    let createdTeamId: string | null = null;
    let createdChannelId: string | null = null;
    let chaosResult: PageResult | null = null;
    let page: Page | null = null;
    let markerInitialized = false;
    let crashed = false;
    let contextClosedUnexpectedly = false;
    const actionLogs: MonkeyActionLog[] = [];
    const memorySamples: MemorySample[] = [];
    const responseFailures: string[] = [];
    const ignoredExpectedResponseFailures: string[] = [];
    const expectedHttpNoiseCounts = new Map(
      expectedHttpNoiseRules.map((rule) => [rule.name, 0]),
    );
    const expectedHttpNoiseViolations = () =>
      expectedHttpNoiseRules
        .filter(
          (rule) =>
            (expectedHttpNoiseCounts.get(rule.name) ?? 0) >
            rule.maximum,
        )
        .map(
          (rule) =>
            `${rule.name}: expected at most ${rule.maximum}, received ${expectedHttpNoiseCounts.get(rule.name) ?? 0}`,
        );
    const requestFailures: string[] = [];
    const ignoredRequestAborts: string[] = [];
    const runtimeFailures: string[] = [];
    const ignoredRuntimeFailures: string[] = [];
    const layoutWarnings: Array<{
      step: number;
      action: string;
      viewport: number;
      deckWidth: number;
      innerOverflow: number;
      threadLayoutMode: string | null;
    }> = [];
    const actionFailures: string[] = [];
    const checkpointSteps = new Set([
      0,
      17,
      Math.floor(monkeyActionCount / 2),
      monkeyActionCount - 1,
    ]);
    const rootMarker =
      `ui-monkey-root-${monkeySeed}-${timestamp}`;
    const searchMarker =
      `ui-monkey-search-${timestamp}`;
    const temporaryQuery =
      `ui-monkey-temporary-${timestamp}`;

    try {
      const originalTeam: MattermostTeam = {
        id: state.team.id,
        name: state.team.name,
      };
      const monkeyTeam =
        await apiRequest<MattermostTeam>(
          adminToken,
          "POST",
          "/teams",
          {
            name: `monkey${timestamp}`,
            display_name: `Monkey ${timestamp}`,
            type: "O",
          },
        );
      createdTeamId = monkeyTeam.id;
      await apiRequest(
        adminToken,
        "POST",
        `/teams/${monkeyTeam.id}/members`,
        {
          team_id: monkeyTeam.id,
          user_id: state.memberUser.id,
        },
      );
      await expect
        .poll(
          async () =>
            (
              await apiRequest<MattermostTeam[]>(
                memberToken,
                "GET",
                "/users/me/teams",
              )
            ).some((team) => team.id === monkeyTeam.id),
          { timeout: 20_000 },
        )
        .toBe(true);

      const originalChannel =
        await apiRequest<MattermostChannel>(
          adminToken,
          "POST",
          "/channels",
          {
            team_id: originalTeam.id,
            name: `ui-monkey-${timestamp}`,
            display_name: `UI Monkey ${timestamp}`,
            type: "O",
          },
        );
      createdChannelId = originalChannel.id;
      await apiRequest(
        adminToken,
        "POST",
        `/channels/${originalChannel.id}/members`,
        {
          user_id: state.memberUser.id,
        },
      );
      const monkeyChannel =
        await apiRequest<MattermostChannel>(
          adminToken,
          "POST",
          "/channels",
          {
            team_id: monkeyTeam.id,
            name: `ui-monkey-alt-${timestamp}`,
            display_name: `UI Monkey Alt ${timestamp}`,
            type: "O",
          },
        );
      await apiRequest(
        adminToken,
        "POST",
        `/channels/${monkeyChannel.id}/members`,
        {
          user_id: state.memberUser.id,
        },
      );

      const rootPost =
        await apiRequest<MattermostPost>(
          adminToken,
          "POST",
          "/posts",
          {
            channel_id: originalChannel.id,
            message: `${searchMarker} thread root`,
          },
        );
      const replyPost =
        await apiRequest<MattermostPost>(
          adminToken,
          "POST",
          "/posts",
          {
            channel_id: originalChannel.id,
            root_id: rootPost.id,
            message: `${searchMarker} thread reply`,
          },
        );
      await Promise.all(
        Array.from({ length: 14 }, (_, index) =>
          apiRequest(
            adminToken,
            "POST",
            "/posts",
            {
              channel_id:
                index % 2 === 0
                  ? originalChannel.id
                  : monkeyChannel.id,
              message:
                `@${state.memberUser.username} ${searchMarker} mention ${index}`,
            },
          ),
        ),
      );
      for (const target of [
        {
          teamId: originalTeam.id,
          channelId: originalChannel.id,
        },
        {
          teamId: monkeyTeam.id,
          channelId: monkeyChannel.id,
        },
      ]) {
        await expect
          .poll(
            async () => {
              const members = await apiRequest<
                Array<{
                  channel_id: string;
                  mention_count?: number;
                  mention_count_root?: number;
                }>
              >(
                memberToken,
                "GET",
                `/users/me/teams/${target.teamId}/channels/members`,
              );
              const channelMember = members.find(
                (member) =>
                  member.channel_id === target.channelId,
              );
              return (
                (channelMember?.mention_count ?? 0) +
                (channelMember?.mention_count_root ?? 0)
              );
            },
            { timeout: 20_000 },
          )
          .toBeGreaterThan(0);
      }

      context =
        await chromium.launchPersistentContext(
          userDataDir,
          {
            channel: "chromium",
            headless: !headed,
            viewport: {
              width: 1_800,
              height: 900,
            },
            args: [
              `--disable-extensions-except=${extensionPath}`,
              `--load-extension=${extensionPath}`,
            ],
          },
        );
      let [serviceWorker] = context.serviceWorkers();
      serviceWorker ??=
        await context.waitForEvent("serviceworker", {
          timeout: 15_000,
        });
      const extensionId = new URL(
        serviceWorker.url(),
      ).host;
      const optionsPagePrefix =
        `chrome-extension://${extensionId}/options.html`;
      const closeOptionsPages = async () => {
        for (const existingPage of context!.pages()) {
          if (
            existingPage.url().startsWith(
              optionsPagePrefix,
            )
          ) {
            await existingPage.close();
          }
        }
      };

      await serviceWorker.evaluate(
        ({
          serverUrl,
          token,
          storageKey,
          channelId,
        }) =>
          new Promise<void>((resolve) => {
            chrome.storage.local.set(
              {
                "mattermostDeck.serverUrl.v1":
                  serverUrl,
                "mattermostDeck.wsPat.v1": token,
                "mattermostDeck.persistPat.v1":
                  "true",
                "mattermostDeck.pollingIntervalSeconds.v1":
                  "120",
                "mattermostDeck.drawerOpen.v1": 1,
                "mattermostDeck.preferredRailWidth.v1":
                  "620",
                "mattermostDeck.autoAdjustThreadLayout.v1":
                  "true",
                [storageKey]: [
                  {
                    id: "ui-monkey-mentions",
                    type: "mentions",
                  },
                  {
                    id: "ui-monkey-channel",
                    type: "channelWatch",
                    channelId,
                  },
                ],
              },
              () => resolve(),
            );
          }),
        {
          serverUrl: baseUrl,
          token: memberToken,
          storageKey: layoutStorageKey,
          channelId: originalChannel.id,
        },
      );
      page = await context.newPage();
      await new Promise((resolve) =>
        setTimeout(resolve, 500)
      );
      await closeOptionsPages();

      page.on("crash", () => {
        crashed = true;
      });
      page.on("pageerror", (error) => {
        const detail = error.stack ?? error.message;
        const isKnownPlaybooksAuthorizationNoise =
          /Not authorized/i.test(detail) &&
          /static\/plugins\/playbooks\//i.test(detail);
        const isKnownMattermostAiTeamNoise =
          /Unable to find an existing account matching your username for this team/i
            .test(detail) &&
          /static\/plugins\/mattermost-ai\//i.test(detail);
        if (
          isKnownPlaybooksAuthorizationNoise ||
          isKnownMattermostAiTeamNoise
        ) {
          ignoredRuntimeFailures.push(detail);
        } else {
          runtimeFailures.push(detail);
        }
      });
      context.on("close", () => {
        contextClosedUnexpectedly = true;
      });
      page.on("response", (response) => {
        if (!response.url().startsWith(baseUrl)) {
          return;
        }
        const responsePath = new URL(response.url()).pathname;
        const matchingExpectedNoise =
          expectedHttpNoiseRules.find(
            (rule) =>
              response.request().method() === rule.method &&
              response.status() === rule.status &&
              rule.path.test(responsePath),
          );
        if (matchingExpectedNoise) {
          expectedHttpNoiseCounts.set(
            matchingExpectedNoise.name,
            (expectedHttpNoiseCounts.get(
              matchingExpectedNoise.name,
            ) ?? 0) + 1,
          );
          ignoredExpectedResponseFailures.push(
            `${response.request().method()} ${response.status()} ${response.url()}`,
          );
          return;
        }
        if (response.status() >= 400) {
          responseFailures.push(
            `${response.request().method()} ${response.status()} ${response.url()}`,
          );
        }
      });
      page.on("requestfailed", (request) => {
        if (!request.url().startsWith(baseUrl)) {
          return;
        }
        const errorText =
          request.failure()?.errorText ?? "Unknown error";
        const failure =
          `${request.url()} - ${errorText}`;
        if (/net::ERR_ABORTED/i.test(errorText)) {
          ignoredRequestAborts.push(failure);
          return;
        }
        requestFailures.push(failure);
      });
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "mattermostDeck.debugLogs",
          "1",
        );
      });
      await login(
        page,
        state.memberUser.username,
        state.memberUser.password,
      );
      await page.goto(
        `${baseUrl}/${originalTeam.name}/channels/${originalChannel.name}`,
        { waitUntil: "domcontentloaded" },
      );
      await dismissMattermostOverlays(page);
      await expect(
        page.locator("#mattermost-deck-root"),
      ).toBeAttached({ timeout: 30_000 });
      await waitForDeckDebugBridge(page);
      await expect
        .poll(
          async () =>
            (
              await debugRequest<DeckState>(
                page!,
                "getState",
              )
            ).stateStatus,
          { timeout: 30_000 },
        )
        .toBe("ready");
      await expect
        .poll(
          async () =>
            (
              await debugRequest<DeckState>(
                page!,
                "getState",
              )
            ).wsStatus,
          { timeout: 30_000 },
        )
        .toBe("connected");
      cdp = await context.newCDPSession(page);
      await cdp.send("HeapProfiler.enable");

      const prelude = [
        "viewport-wide",
        "open-thread",
        "close-rhs",
        "open-search",
        "close-rhs",
        "drag-deck",
        "mention-scroll",
        "mention-refresh",
        "mention-pause-cycle",
        "mention-focus-cycle",
        "mention-scope",
        "mention-unread",
        "temporary-add",
        "temporary-move",
        "temporary-remove",
        "navigate-alternate",
        "navigate-original",
        "horizontal-scroll",
      ];
      const randomActions = [
        "navigate-original",
        "navigate-original",
        "navigate-alternate",
        "navigate-alternate",
        "viewport-random",
        "viewport-random",
        "viewport-random",
        "open-thread",
        "close-rhs",
        "open-search",
        "close-rhs",
        "drag-deck",
        "drag-deck",
        "horizontal-scroll",
        "mention-scroll",
        "mention-scroll",
        "mention-scope",
        "mention-unread",
        "mention-refresh",
        "mention-pause-cycle",
        "mention-focus-cycle",
        "apply-updates",
        "temporary-add",
        "temporary-move",
        "temporary-remove",
      ];

      const ensureDeckOpen = async (): Promise<DeckState> => {
        let current =
          await debugRequest<DeckState>(
            page!,
            "getState",
          );
        if (
          current.effectiveDrawerOpen &&
          current.canResizeRail
        ) {
          return current;
        }
        await debugRequest(
          page!,
          "ensureDrawerOpen",
        );
        await expect
          .poll(
            async () => {
              current =
                await debugRequest<DeckState>(
                  page!,
                  "getState",
                );
              return {
                effectiveDrawerOpen:
                  current.effectiveDrawerOpen,
                canResizeRail:
                  current.canResizeRail,
              };
            },
            { timeout: 10_000 },
          )
          .toEqual({
            effectiveDrawerOpen: true,
            canResizeRail: true,
          });
        return current;
      };

      const performNamedAction = async (
        actionName: string,
        randomValue: number,
      ): Promise<unknown> => {
        const currentState =
          await debugRequest<DeckState>(
            page!,
            "getState",
          );
        const mentionColumn =
          currentState.columns.find(
            (column) =>
              column.type === "mentions",
          );
        if (!mentionColumn) {
          throw new Error(
            "The mentions column disappeared",
          );
        }

        switch (actionName) {
          case "viewport-wide":
            await page!.setViewportSize({
              width: 2_200,
              height: 900,
            });
            return { width: 2_200 };
          case "viewport-random": {
            const widths = [
              1_024,
              1_280,
              1_440,
              1_800,
              2_200,
            ];
            const width =
              widths[
                Math.floor(
                  randomValue * widths.length,
                )
              ];
            await page!.setViewportSize({
              width,
              height: 900,
            });
            return { width };
          }
          case "navigate-original":
            await navigateToChannel(
              page!,
              originalTeam,
              originalChannel,
            );
            return {
              team: originalTeam.name,
              channel: originalChannel.name,
            };
          case "navigate-alternate":
            await navigateToChannel(
              page!,
              monkeyTeam,
              monkeyChannel,
            );
            return {
              team: monkeyTeam.name,
              channel: monkeyChannel.name,
            };
          case "open-thread":
            await openThread(
              page!,
              originalTeam,
              originalChannel,
              rootPost.id,
              replyPost.id,
            );
            return { rootPostId: rootPost.id };
          case "close-rhs":
            return {
              closed: await closeRightSidebar(
                page!,
              ),
            };
          case "open-search":
            await openSearch(page!, searchMarker);
            return { query: searchMarker };
          case "drag-deck": {
            if (
              (page!.viewportSize()?.width ?? 0) <
              1_280
            ) {
              await page!.setViewportSize({
                width: 1_440,
                height: 900,
              });
            }
            await ensureDeckOpen();
            const targetWidth =
              360 +
              Math.floor(randomValue * 440);
            const expectedWidth = targetWidth;
            await dragDeckToWidth(
              page!,
              targetWidth,
            );
            await expect
              .poll(
                async () =>
                  (
                    await debugRequest<DeckState>(
                      page!,
                      "getState",
                    )
                  ).railWidth ?? 0,
                { timeout: 10_000 },
              )
              .toBeGreaterThanOrEqual(
                expectedWidth - 12,
              );
            const actualWidth =
              (
                await debugRequest<DeckState>(
                  page!,
                  "getState",
                )
              ).railWidth ?? 0;
            expect(actualWidth).toBeLessThanOrEqual(
              expectedWidth + 12,
            );
            return {
              targetWidth,
              expectedWidth,
              actualWidth,
            };
          }
          case "horizontal-scroll": {
            const value =
              randomValue > 0.5 ? 10_000 : 0;
            return {
              value:
                await debugRequest<number>(
                  page!,
                  "setHorizontalScrollLeft",
                  { value },
                ),
            };
          }
          case "mention-scroll": {
            await ensureDeckOpen();
            const value =
              randomValue > 0.5 ? 10_000 : 0;
            return {
              value:
                await debugRequest<number>(
                  page!,
                  "setMentionScrollTop",
                  {
                    id: mentionColumn.id,
                    value,
                  },
                ),
            };
          }
          case "mention-scope": {
            const teamId =
              randomValue > 0.5
                ? originalTeam.id
                : monkeyTeam.id;
            await debugRequest(
              page!,
              "updateColumn",
              {
                id: mentionColumn.id,
                patch: { teamId },
              },
            );
            return { teamId };
          }
          case "mention-unread": {
            const unreadOnly =
              !Boolean(
                mentionColumn.unreadOnly,
              );
            await debugRequest(
              page!,
              "updateColumn",
              {
                id: mentionColumn.id,
                patch: { unreadOnly },
              },
            );
            return { unreadOnly };
          }
          case "mention-refresh":
          case "mention-pause-cycle":
          case "mention-focus-cycle": {
            await ensureDeckOpen();
            const control =
              actionName === "mention-refresh"
                ? "refresh"
                : actionName ===
                    "mention-pause-cycle"
                   ? "pause"
                   : "focus";

            const clickVisibleControl =
              async (): Promise<boolean> =>
                debugRequest<boolean>(
                  page!,
                  "clickMentionControl",
                  {
                    id: mentionColumn.id,
                    control,
                  },
                );
            await debugRequest(
              page!,
              "clickMentionControl",
              {
                id: mentionColumn.id,
                control: "expandControls",
              },
            );
            await page!.waitForTimeout(150);
            let clicked = await clickVisibleControl();
            for (
              let attempt = 0;
              !clicked &&
              attempt <
                (
                  actionName ===
                  "mention-refresh"
                    ? 4
                    : 20
                );
              attempt += 1
            ) {
              await page!.waitForTimeout(250);
              clicked = await clickVisibleControl();
            }
            if (!clicked) {
              if (
                actionName === "mention-refresh"
              ) {
                return {
                  control,
                  clicked: false,
                  skipped:
                    "refresh is disabled while mention loading is active",
                };
              }
              throw new Error(
                `Mention toolbar control is unavailable: ${control}`,
              );
            }
            if (
              actionName !== "mention-refresh" &&
              clicked
            ) {
              await page!.waitForTimeout(150);
              const restored = await clickVisibleControl();
              if (!restored) {
                throw new Error(
                  `Mention toolbar control did not restore: ${control}`,
                );
              }
            }
            return { control, clicked };
          }
          case "apply-updates":
            return {
              clicked:
                await debugRequest<boolean>(
                  page!,
                  "applyMentionUpdates",
                  { id: mentionColumn.id },
                ),
            };
          case "temporary-add": {
            const existing =
              currentState.columns.find(
                (column) =>
                  column.query === temporaryQuery,
              );
            if (!existing) {
              await debugRequest(
                page!,
                "addColumn",
                {
                  type: "search",
                  defaults: {
                    query: temporaryQuery,
                  },
                },
              );
            }
            return {
              existed: Boolean(existing),
            };
          }
          case "temporary-move": {
            const temporary =
              currentState.columns.find(
                (column) =>
                  column.query === temporaryQuery,
              );
            const beforeIndex = temporary
              ? currentState.columns.findIndex(
                  (column) =>
                    column.id === temporary.id,
                )
              : -1;
            if (temporary) {
              const direction =
                beforeIndex === 0 ? "right" : "left";
              await debugRequest(
                page!,
                "moveColumn",
                {
                  id: temporary.id,
                  direction,
                },
              );
              await expect
                .poll(
                  async () =>
                    (
                      await debugRequest<DeckState>(
                        page!,
                        "getState",
                      )
                    ).columns.findIndex(
                      (column) =>
                        column.id === temporary.id,
                    ),
                  { timeout: 5_000 },
                )
                .not.toBe(beforeIndex);
            }
            return {
              moved: Boolean(temporary),
              beforeIndex,
            };
          }
          case "temporary-remove": {
            const temporary =
              currentState.columns.find(
                (column) =>
                  column.query === temporaryQuery,
              );
            if (temporary) {
              await debugRequest(
                page!,
                "removeColumn",
                { id: temporary.id },
              );
            }
            return {
              removed: Boolean(temporary),
            };
          }
          default:
            throw new Error(
              `Unknown monkey action: ${actionName}`,
            );
        }
      };

      const canonicalizeDeck = async (): Promise<void> => {
        await page!.setViewportSize({
          width: 1_800,
          height: 900,
        });
        await navigateToChannel(
          page!,
          originalTeam,
          originalChannel,
        );
        await closeRightSidebar(page!);
        await debugRequest(
          page!,
          "clearColumnFocus",
        );

        let canonicalState =
          await debugRequest<DeckState>(
            page!,
            "getState",
          );
        for (const column of canonicalState.columns) {
          if (column.query === temporaryQuery) {
            await debugRequest(
              page!,
              "removeColumn",
              { id: column.id },
            );
          }
        }
        canonicalState =
          await debugRequest<DeckState>(
            page!,
            "getState",
          );
        const mentionColumn =
          canonicalState.columns.find(
            (column) =>
              column.type === "mentions",
          );
        if (!mentionColumn) {
          throw new Error(
            "The mentions column disappeared during canonicalization",
          );
        }
        await debugRequest(
          page!,
          "updateColumn",
          {
            id: mentionColumn.id,
            patch: {
              teamId: undefined,
              unreadOnly: false,
            },
          },
        );
        await debugRequest(
          page!,
          "clickMentionControl",
          {
            id: mentionColumn.id,
            control: "collapseControls",
          },
        );
        await dragDeckToWidth(page!, 620);
        await debugRequest(
          page!,
          "setHorizontalScrollLeft",
          { value: 0 },
        );
        await debugRequest(
          page!,
          "setMentionScrollTop",
          {
            id: mentionColumn.id,
            value: 0,
          },
        );

        await expect
          .poll(
            async () => {
              const stableState =
                await debugRequest<DeckState>(
                  page!,
                  "getState",
                );
              const stableMentionColumn =
                stableState.columns.find(
                  (column) =>
                    column.type === "mentions",
                );
              const stableMention =
                stableMentionColumn
                  ? await debugRequest<DeckColumnDebugState | null>(
                      page!,
                      "getColumnState",
                      {
                        id: stableMentionColumn.id,
                      },
                    )
                  : null;
              const presentation =
                stableMentionColumn
                  ? await debugRequest<MentionPresentationState | null>(
                      page!,
                      "getMentionPresentationState",
                      {
                        id: stableMentionColumn.id,
                      },
                    )
                  : null;
              return {
                stateStatus:
                  stableState.stateStatus,
                wsStatus: stableState.wsStatus,
                currentTeamId:
                  stableState.currentTeamId,
                currentChannelId:
                  stableState.currentChannelId,
                focusedColumnId:
                  stableState.focusedColumnId ?? null,
                railWidth:
                  Math.round(
                    stableState.railWidth ?? 0,
                  ),
                temporaryColumnPresent:
                  stableState.columns.some(
                    (column) =>
                      column.query ===
                      temporaryQuery,
                  ),
                mentionTeamId:
                  stableMentionColumn?.teamId ??
                  null,
                mentionUnreadOnly:
                  stableMentionColumn?.unreadOnly ??
                  false,
                mentionLoadActive:
                  stableMention?.mentionLoadActive ??
                  false,
                skeletonCount:
                  presentation?.skeletonCount ?? 0,
              };
            },
            {
              timeout: 30_000,
              intervals: [250, 500, 750],
            },
          )
          .toEqual({
            stateStatus: "ready",
            wsStatus: "connected",
            currentTeamId: originalTeam.id,
            currentChannelId:
              originalChannel.id,
            focusedColumnId: null,
            railWidth: 620,
            temporaryColumnPresent: false,
            mentionTeamId: null,
            mentionUnreadOnly: false,
            mentionLoadActive: false,
            skeletonCount: 0,
          });

        let consecutiveIdleSamples = 0;
        await expect
          .poll(
            async () => {
              const idleState =
                await debugRequest<DeckState>(
                  page!,
                  "getState",
                );
              const idleMentionColumn =
                idleState.columns.find(
                  (column) =>
                    column.type === "mentions",
                );
              const idleMention =
                idleMentionColumn
                  ? await debugRequest<DeckColumnDebugState | null>(
                      page!,
                      "getColumnState",
                      {
                        id: idleMentionColumn.id,
                      },
                    )
                  : null;
              const idlePresentation =
                idleMentionColumn
                  ? await debugRequest<MentionPresentationState | null>(
                      page!,
                      "getMentionPresentationState",
                      {
                        id: idleMentionColumn.id,
                      },
                    )
                  : null;
              const isIdle =
                idleState.stateStatus === "ready" &&
                idleState.wsStatus === "connected" &&
                idleMention?.mentionLoadActive !==
                  true &&
                idlePresentation?.progressPresent !==
                  true &&
                (
                  idlePresentation?.skeletonCount ??
                  0
                ) === 0;
              consecutiveIdleSamples = isIdle
                ? consecutiveIdleSamples + 1
                : 0;
              return consecutiveIdleSamples;
            },
            {
              timeout: 30_000,
              intervals: [300, 500, 750],
            },
          )
          .toBeGreaterThanOrEqual(3);
      };

      const driver: Driver = {
        name: "mattermost-deck-safe-monkey",
        async selectAction(step) {
          const actionName =
            step.stepIndex < prelude.length
              ? prelude[step.stepIndex]
              : randomActions[
                  Math.floor(
                    step.rng.next() *
                      randomActions.length,
                  )
                ];
          const randomValue = step.rng.next();
          return {
            kind: "custom",
            source: "mattermost-deck-safe-monkey",
            reasoning: actionName,
            perform: async () => {
              const startedAt = Date.now();
              const log: MonkeyActionLog = {
                step: step.stepIndex,
                name: actionName,
                startedAt:
                  new Date(startedAt).toISOString(),
                durationMs: 0,
                success: false,
              };
              try {
                log.detail =
                  await performNamedAction(
                    actionName,
                    randomValue,
                  );
                if (
                  step.stepIndex ===
                  prelude.length - 1
                ) {
                  await canonicalizeDeck();
                }
                await page!.waitForTimeout(250);
                const invariantSnapshot =
                  await waitForCoreInvariants(
                  page!,
                  rootMarker,
                  !markerInitialized,
                );
                markerInitialized = true;
                if (
                  invariantSnapshot.layout
                    .innerOverflow > 2
                ) {
                  layoutWarnings.push({
                    step: step.stepIndex,
                    action: actionName,
                    viewport:
                      invariantSnapshot.layout
                        .viewport,
                    deckWidth:
                      invariantSnapshot.layout.deck,
                    innerOverflow:
                      invariantSnapshot.layout
                        .innerOverflow,
                    threadLayoutMode:
                      invariantSnapshot.state
                        .threadLayoutMode ??
                      null,
                  });
                }
                if (
                  checkpointSteps.has(
                    step.stepIndex,
                  )
                ) {
                  await capture(
                    page!,
                    testInfo,
                    `ui-monkey-${String(
                      step.stepIndex,
                    ).padStart(3, "0")}.png`,
                  );
                }
                if (
                  step.stepIndex ===
                    prelude.length - 1 ||
                  (
                    step.stepIndex >
                      prelude.length - 1 &&
                    step.stepIndex % 20 === 0
                  )
                ) {
                  memorySamples.push(
                    await collectMemory(
                      cdp!,
                      `step-${step.stepIndex}`,
                      step.stepIndex,
                    ),
                  );
                }
                log.success = true;
                return actionResult(
                  actionName,
                  true,
                );
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.stack ??
                      error.message
                    : String(error);
                log.error = message;
                actionFailures.push(
                  `${step.stepIndex}:${actionName}: ${message}`,
                );
                await capture(
                  page!,
                  testInfo,
                  `ui-monkey-failure-${String(
                    step.stepIndex,
                  ).padStart(3, "0")}.png`,
                ).catch(() => undefined);
                return actionResult(
                  actionName,
                  false,
                  message,
                );
              } finally {
                log.durationMs =
                  Date.now() - startedAt;
                actionLogs.push(log);
              }
            },
          };
        },
      };

      const escapedBaseUrl = baseUrl.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      const crawler = new ChaosCrawler(
        {
          baseUrl:
            `${baseUrl}/${originalTeam.name}/channels/${originalChannel.name}`,
          seed: monkeySeed,
          maxPages: 1,
          maxActionsPerPage:
            monkeyActionCount,
          timeout: 60_000,
          blockExternalNavigation: true,
          enableRecovery: false,
          driver,
          ignoreErrorPatterns: [
            ...COMMON_IGNORE_PATTERNS,
            "ResizeObserver loop",
            "pdat\\.matterlytics\\.com",
            // Chromium's console message for a failed resource omits the
            // resource URL, so ChaosCrawler cannot match these by endpoint.
            // The response/request listeners above still validate the exact
            // method, status, path, and bounded count before the test passes.
            "Failed to load resource: the server responded with a status of (?:400|401|403|404|501)",
            // Navigation deliberately aborts in-flight Mattermost requests.
            // Non-abort request failures remain fatal in requestFailures.
            "net::ERR_ABORTED",
            `${escapedBaseUrl}/api/v4/users/[^/]+/groups`,
            `${escapedBaseUrl}/api/v4/cloud/products/selfhosted`,
            `${escapedBaseUrl}/api/v4/trial-license/prev`,
            `${escapedBaseUrl}/plugins/playbooks/api/v0/settings`,
            `${escapedBaseUrl}/plugins/com\\.mattermost\\.apps/api/v1/bindings`,
            `${escapedBaseUrl}/static/plugins/playbooks/`,
            `${escapedBaseUrl}/static/plugins/mattermost-ai/`,
            "Unable to find an existing account matching your username for this team",
          ],
          spaPatterns: [
            `${escapedBaseUrl}/[^/?#]+/(?:channels|messages)/[^/?#]+(?:[?#].*)?$`,
          ],
          invariants: [
            {
              name: "monkey-actions-succeed",
              when: "afterActions",
              check: () =>
                actionFailures.length === 0 ||
                actionFailures
                  .slice(0, 5)
                  .join("\n"),
            },
            {
              name: "mattermost-api-has-no-unexpected-http-errors",
              when: "afterActions",
              check: () =>
                responseFailures.length === 0 ||
                responseFailures
                  .slice(0, 5)
                  .join("\n"),
            },
            {
              name: "known-mattermost-http-noise-stays-bounded",
              when: "afterActions",
              check: () =>
                expectedHttpNoiseViolations().length === 0 ||
                expectedHttpNoiseViolations().join("\n"),
            },
            {
              name: "mattermost-network-requests-succeed",
              when: "afterActions",
              check: () =>
                requestFailures.length === 0 ||
                requestFailures
                  .slice(0, 5)
                  .join("\n"),
            },
            {
              name: "browser-runtime-has-no-errors",
              when: "afterActions",
              check: () =>
                runtimeFailures.length === 0 ||
                runtimeFailures
                  .slice(0, 5)
                  .join("\n"),
            },
          ],
        },
        {
          onAction: (action) => {
            if (!action.success && action.error) {
              actionFailures.push(
                `chaosbringer:${action.target}: ${action.error}`,
              );
            }
          },
        },
      );

      chaosResult = await crawler.testPage(
        page,
        `${baseUrl}/${originalTeam.name}/channels/${originalChannel.name}`,
      );
      await canonicalizeDeck();
      await waitForCoreInvariants(
        page,
        rootMarker,
        false,
      );
      memorySamples.push(
        await collectMemory(
          cdp,
          "final",
          monkeyActionCount,
        ),
      );
      await capture(
        page,
        testInfo,
        "ui-monkey-final.png",
      );

      const firstMemory = memorySamples[0];
      const finalMemory =
        memorySamples[memorySamples.length - 1];
      const memoryAnalysis =
        firstMemory && finalMemory
          ? {
              heapGrowthBytes:
                finalMemory.heapUsedBytes -
                firstMemory.heapUsedBytes,
              nodeGrowth:
                finalMemory.nodes -
                firstMemory.nodes,
              documentGrowth:
                finalMemory.documents -
                firstMemory.documents,
              eventListenerGrowth:
                finalMemory.eventListeners -
                firstMemory.eventListeners,
              thresholds: {
                heapGrowthBytes: Math.max(
                  64 * mebibyte,
                  firstMemory.heapUsedBytes *
                    0.5,
                ),
                nodeGrowth: 5_000,
                documentGrowth: 2,
                eventListenerGrowth: 3_000,
              },
            }
          : null;
      const ignoredChaosErrors = chaosResult.errors.filter(
        (error) =>
          error.type === "network" &&
          / - net::ERR_ABORTED$/i.test(error.message) &&
          ignoredRequestAborts.includes(error.message),
      );
      const unexpectedChaosErrors =
        chaosResult.errors.filter(
          (error) =>
            !ignoredChaosErrors.includes(error),
        );
      const memoryLimitViolations = memoryAnalysis
        ? [
            memoryAnalysis.heapGrowthBytes >
            memoryAnalysis.thresholds.heapGrowthBytes
              ? `heap growth ${memoryAnalysis.heapGrowthBytes} exceeds ${memoryAnalysis.thresholds.heapGrowthBytes}`
              : null,
            memoryAnalysis.nodeGrowth >
            memoryAnalysis.thresholds.nodeGrowth
              ? `node growth ${memoryAnalysis.nodeGrowth} exceeds ${memoryAnalysis.thresholds.nodeGrowth}`
              : null,
            memoryAnalysis.documentGrowth >
            memoryAnalysis.thresholds.documentGrowth
              ? `document growth ${memoryAnalysis.documentGrowth} exceeds ${memoryAnalysis.thresholds.documentGrowth}`
              : null,
            memoryAnalysis.eventListenerGrowth >
            memoryAnalysis.thresholds.eventListenerGrowth
              ? `event-listener growth ${memoryAnalysis.eventListenerGrowth} exceeds ${memoryAnalysis.thresholds.eventListenerGrowth}`
              : null,
          ].filter((message): message is string =>
            Boolean(message),
          )
        : [];
      const hasReportFailure =
        unexpectedChaosErrors.length > 0 ||
        actionFailures.length > 0 ||
        responseFailures.length > 0 ||
        expectedHttpNoiseViolations().length > 0 ||
        requestFailures.length > 0 ||
        runtimeFailures.length > 0 ||
        crashed ||
        contextClosedUnexpectedly ||
        memoryLimitViolations.length > 0;

      const reportPath = testInfo.outputPath(
        "ui-monkey-report.json",
      );
      await fs.writeFile(
        reportPath,
        JSON.stringify(
          {
            outcome: hasReportFailure
              ? "failed"
              : "passed",
            mattermostVersion:
              state.mattermostVersion ?? null,
            seed: monkeySeed,
            actionsRequested:
              monkeyActionCount,
            actionsCompleted:
              actionLogs.length,
            headed,
            chaosResult,
            ignoredChaosErrors,
            unexpectedChaosErrors,
            actionFailures,
            responseFailures,
            ignoredExpectedResponseFailures,
            expectedHttpNoiseCounts: Object.fromEntries(
              expectedHttpNoiseCounts,
            ),
            requestFailures,
            ignoredRequestAborts,
            runtimeFailures,
            ignoredRuntimeFailures,
            layoutWarnings,
            crashed,
            contextClosedUnexpectedly,
            memorySamples,
            memoryAnalysis,
            memoryLimitViolations,
            actions: actionLogs,
          },
          null,
          2,
        ),
        "utf8",
      );
      await testInfo.attach(
        "ui-monkey-report.json",
        {
          path: reportPath,
          contentType: "application/json",
        },
      );

      expect(crashed).toBe(false);
      expect(
        contextClosedUnexpectedly,
      ).toBe(false);
      expect(actionLogs).toHaveLength(
        monkeyActionCount,
      );
      expect(actionFailures).toEqual([]);
      expect(responseFailures).toEqual([]);
      expect(expectedHttpNoiseViolations()).toEqual([]);
      expect(requestFailures).toEqual([]);
      expect(runtimeFailures).toEqual([]);
      expect(chaosResult.status).toBe("success");
      expect(unexpectedChaosErrors).toEqual([]);
      if (memoryAnalysis) {
        expect(
          memoryAnalysis.heapGrowthBytes,
        ).toBeLessThanOrEqual(
          memoryAnalysis.thresholds
            .heapGrowthBytes,
        );
        expect(
          memoryAnalysis.nodeGrowth,
        ).toBeLessThanOrEqual(
          memoryAnalysis.thresholds.nodeGrowth,
        );
        expect(
          memoryAnalysis.documentGrowth,
        ).toBeLessThanOrEqual(
          memoryAnalysis.thresholds
            .documentGrowth,
        );
        expect(
          memoryAnalysis.eventListenerGrowth,
        ).toBeLessThanOrEqual(
          memoryAnalysis.thresholds
            .eventListenerGrowth,
        );
      }
    } finally {
      contextClosedUnexpectedly = false;
      await cdp
        ?.detach()
        .catch(() => undefined);
      await context
        ?.close()
        .catch(() => undefined);
      await fs
        .rm(userDataDir, {
          recursive: true,
          force: true,
        })
        .catch(() => undefined);
      if (createdChannelId) {
        await apiDelete(
          adminToken,
          `/channels/${createdChannelId}`,
        ).catch(() => undefined);
      }
      if (createdTeamId) {
        await apiDelete(
          adminToken,
          `/teams/${createdTeamId}`,
        ).catch(() => undefined);
      }
    }
  },
);
