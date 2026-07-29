import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const soakEnabled = process.env.MM_DECK_RUN_SOAK === "1";
type SoakMode = "deck" | "auto-adjust-off" | "control";
const requestedSoakMode = process.env.MM_DECK_SOAK_MODE;
const soakMode: SoakMode = (
  requestedSoakMode === "auto-adjust-off" ||
  requestedSoakMode === "control"
)
  ? requestedSoakMode
  : "deck";
const deckExtensionEnabled = soakMode !== "control";
const autoAdjustEnabled = soakMode === "deck";
const requestedDurationMinutes = Number.parseFloat(
  process.env.MM_DECK_SOAK_MINUTES ?? "20",
);
const soakDurationMinutes = (
  Number.isFinite(requestedDurationMinutes) && requestedDurationMinutes > 0
)
  ? Math.min(Math.max(requestedDurationMinutes, 10), 120)
  : 20;
const requestedSeed = Number.parseInt(process.env.MM_DECK_SOAK_SEED ?? "42", 10);
const soakSeed = Number.isFinite(requestedSeed) ? Math.abs(requestedSeed) : 42;
const soakDurationMs = Math.round(soakDurationMinutes * 60_000);
const sampleIntervalMs = 15_000;
const warmupMs = Math.min(60_000, Math.max(30_000, soakDurationMs * 0.25));
const maxSamples = Math.min(512, Math.ceil(soakDurationMs / sampleIntervalMs) + 3);
const workloadGapMs = 1_500;
const rhsMutationOperationsPerStep = 100;
const samplingViewportWidth = 1_800;
const samplingSettleMs = 750;
const rootsPerChannel = 64;
const repliesPerRoot = 2;
const apiBatchSize = 4;
const cleanupBatchSize = 8;
const maxDiagnosticMessages = 32;
const railWidthStorageKey = "mattermostDeck.railWidth.v1";
const drawerOpenStorageKey = "mattermostDeck.drawerOpen.v1";
const autoAdjustStorageKey = "mattermostDeck.autoAdjustThreadLayout.v1";
const requestedRailWidth = 720;
const mebibyte = 1024 * 1024;

test.describe.configure({ mode: "serial" });

interface E2EState {
  mattermostVersion?: string;
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
  railWidth: number;
  requestedRailWidth: number;
  threadLayoutMode: "normal" | "compact" | "collapsed" | "override" | "control";
  hostLayoutMeasurementCount: number;
  userTimingMeasureCount: number;
}

interface PerformanceMetric {
  name: string;
  value: number;
}

interface PerformanceMetricsResponse {
  metrics: PerformanceMetric[];
}

interface DOMCountersResponse {
  documents: number;
  nodes: number;
  jsEventListeners: number;
}

interface HeapUsageResponse {
  usedSize: number;
  totalSize: number;
  embedderHeapUsedSize?: number;
  backingStorageSize?: number;
}

interface SoakSample {
  elapsedMs: number;
  workloadStep: number;
  jsHeapUsedBytes: number;
  jsHeapTotalBytes: number;
  embedderHeapUsedBytes: number;
  backingStorageBytes: number;
  nodes: number;
  documents: number;
  eventListeners: number;
  layoutCount: number;
  recalcStyleCount: number;
  taskDurationSeconds: number;
  scriptDurationSeconds: number;
  deckRootCount: number;
  deckRootMarkerMatches: boolean;
  rhsOpen: boolean;
  railWidth: number;
  threadLayoutMode: DeckDebugState["threadLayoutMode"];
  hostLayoutMeasurementCount: number;
  userTimingMeasureCount: number;
}

interface TrendSummary {
  firstMedian: number;
  lastMedian: number;
  retainedGrowth: number;
  slopePerMinute: number;
  monotonicIncreaseRatio: number;
  runaway: boolean;
  minimum: number;
  maximum: number;
}

interface SoakAnalysis {
  analyzedSampleCount: number;
  warmupMs: number;
  heap: TrendSummary;
  embedderHeap: TrendSummary;
  backingStorage: TrendSummary;
  nodes: TrendSummary;
  documents: TrendSummary;
  eventListeners: TrendSummary;
  userTimingMeasures: TrendSummary;
  hostLayoutMeasurements: TrendSummary;
  hostLayoutMeasurementDelta: number;
  workloadStepDelta: number;
  allowedHostLayoutMeasurementDelta: number;
  thresholds: {
    heapGrowthBytes: number;
    heapSlopeBytesPerMinute: number;
    nodeGrowth: number;
    nodeSlopePerMinute: number;
    documentGrowth: number;
    documentSlopePerMinute: number;
    eventListenerGrowth: number;
    eventListenerSlopePerMinute: number;
    userTimingMeasureGrowth: number;
    userTimingMeasureSlopePerMinute: number;
    hostLayoutMeasurementsPerWorkloadStep: number;
    hostLayoutMeasurementAllowance: number;
  };
}

interface SoakReport {
  outcome: "running" | "passed" | "failed";
  failure: string | null;
  mode: SoakMode;
  mattermostVersion: string | null;
  seed: number;
  durationMinutes: number;
  actualDurationMs: number;
  sampleIntervalMs: number;
  maxSamples: number;
  createdPostCount: number;
  cleanupFailureCount: number;
  workloadSteps: number;
  rhsMutationOperations: number;
  pageCrash: string | null;
  contextClosedUnexpectedly: boolean;
  oomSignals: string[];
  pageErrors: string[];
  samples: SoakSample[];
  analysis: SoakAnalysis | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function boundedPush(target: string[], value: string): void {
  if (target.length < maxDiagnosticMessages) {
    target.push(value.slice(0, 2_000));
  }
}

function isOomSignal(value: string): boolean {
  return /out of memory|\boom\b|allocation failed|heap limit/i.test(value);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function theilSenSlopePerMinute(
  samples: SoakSample[],
  valueOf: (sample: SoakSample) => number,
): number {
  const bounded = samples.slice(-64);
  const slopes: number[] = [];
  for (let left = 0; left < bounded.length; left += 1) {
    for (let right = left + 1; right < bounded.length; right += 1) {
      const elapsedMinutes = (
        bounded[right].elapsedMs - bounded[left].elapsedMs
      ) / 60_000;
      if (elapsedMinutes > 0) {
        slopes.push(
          (valueOf(bounded[right]) - valueOf(bounded[left])) /
            elapsedMinutes,
        );
      }
    }
  }
  return median(slopes);
}

function summarizeTrend(
  samples: SoakSample[],
  valueOf: (sample: SoakSample) => number,
  increaseNoiseFloor: number,
  runawayGrowthFloor: number,
  runawaySlopeFloor: number,
): TrendSummary {
  const values = samples.map(valueOf);
  const windowSize = Math.min(3, Math.max(1, Math.floor(values.length / 2)));
  const firstMedian = median(values.slice(0, windowSize));
  const lastMedian = median(values.slice(-windowSize));
  let meaningfulIncreases = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] - values[index - 1] > increaseNoiseFloor) {
      meaningfulIncreases += 1;
    }
  }
  const monotonicIncreaseRatio = values.length > 1
    ? meaningfulIncreases / (values.length - 1)
    : 0;
  const retainedGrowth = lastMedian - firstMedian;
  const slopePerMinute = theilSenSlopePerMinute(samples, valueOf);

  return {
    firstMedian,
    lastMedian,
    retainedGrowth,
    slopePerMinute,
    monotonicIncreaseRatio,
    runaway: (
      monotonicIncreaseRatio >= 0.8 &&
      retainedGrowth > runawayGrowthFloor &&
      slopePerMinute > runawaySlopeFloor
    ),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  };
}

function analyzeSamples(samples: SoakSample[]): SoakAnalysis {
  const postWarmup = samples.filter((sample) => sample.elapsedMs >= warmupMs);
  if (postWarmup.length < 5) {
    throw new Error(
      `At least five post-warmup samples are required; received ${postWarmup.length}`,
    );
  }

  const heapBaseline = median(
    postWarmup.slice(0, 3).map((sample) => sample.jsHeapUsedBytes),
  );
  const nodeBaseline = median(
    postWarmup.slice(0, 3).map((sample) => sample.nodes),
  );
  const eventListenerBaseline = median(
    postWarmup.slice(0, 3).map((sample) => sample.eventListeners),
  );
  const heapGrowthBytes = Math.max(24 * mebibyte, heapBaseline * 0.15);
  const heapSlopeBytesPerMinute = 2 * mebibyte;
  const nodeGrowth = Math.max(500, nodeBaseline * 0.05);
  const nodeSlopePerMinute = 50;
  const documentGrowth = 1;
  const documentSlopePerMinute = 0.2;
  const eventListenerGrowth = Math.max(100, eventListenerBaseline * 0.05);
  const eventListenerSlopePerMinute = 10;
  const userTimingMeasureGrowth = 20;
  const userTimingMeasureSlopePerMinute = 2;
  const hostLayoutMeasurementsPerWorkloadStep = 6;
  const hostLayoutMeasurementAllowance = 10;

  const heap = summarizeTrend(
    postWarmup,
    (sample) => sample.jsHeapUsedBytes,
    mebibyte,
    heapGrowthBytes * 0.5,
    heapSlopeBytesPerMinute * 0.5,
  );
  const embedderHeap = summarizeTrend(
    postWarmup,
    (sample) => sample.embedderHeapUsedBytes,
    mebibyte,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  const backingStorage = summarizeTrend(
    postWarmup,
    (sample) => sample.backingStorageBytes,
    mebibyte,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  const nodes = summarizeTrend(
    postWarmup,
    (sample) => sample.nodes,
    100,
    nodeGrowth * 0.5,
    nodeSlopePerMinute * 0.5,
  );
  const documents = summarizeTrend(
    postWarmup,
    (sample) => sample.documents,
    0,
    documentGrowth * 0.5,
    documentSlopePerMinute * 0.5,
  );
  const eventListeners = summarizeTrend(
    postWarmup,
    (sample) => sample.eventListeners,
    20,
    eventListenerGrowth * 0.5,
    eventListenerSlopePerMinute * 0.5,
  );
  const userTimingMeasures = summarizeTrend(
    postWarmup,
    (sample) => sample.userTimingMeasureCount,
    1,
    userTimingMeasureGrowth * 0.5,
    userTimingMeasureSlopePerMinute * 0.5,
  );
  const hostLayoutMeasurements = {
    ...summarizeTrend(
      postWarmup,
      (sample) => sample.hostLayoutMeasurementCount,
      0,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ),
    // This is an intentionally cumulative debug counter. Its bounded delta
    // per workload step is checked below instead of treating monotonicity as
    // a leak signal.
    runaway: false,
  };
  const firstSample = postWarmup[0];
  const lastSample = postWarmup.at(-1) ?? firstSample;
  const workloadStepDelta = Math.max(
    0,
    lastSample.workloadStep - firstSample.workloadStep,
  );
  const hostLayoutMeasurementDelta = Math.max(
    0,
    lastSample.hostLayoutMeasurementCount -
      firstSample.hostLayoutMeasurementCount,
  );
  const allowedHostLayoutMeasurementDelta = (
    workloadStepDelta * hostLayoutMeasurementsPerWorkloadStep
  ) + hostLayoutMeasurementAllowance;

  return {
    analyzedSampleCount: postWarmup.length,
    warmupMs,
    heap,
    embedderHeap,
    backingStorage,
    nodes,
    documents,
    eventListeners,
    userTimingMeasures,
    hostLayoutMeasurements,
    hostLayoutMeasurementDelta,
    workloadStepDelta,
    allowedHostLayoutMeasurementDelta,
    thresholds: {
      heapGrowthBytes,
      heapSlopeBytesPerMinute,
      nodeGrowth,
      nodeSlopePerMinute,
      documentGrowth,
      documentSlopePerMinute,
      eventListenerGrowth,
      eventListenerSlopePerMinute,
      userTimingMeasureGrowth,
      userTimingMeasureSlopePerMinute,
      hostLayoutMeasurementsPerWorkloadStep,
      hostLayoutMeasurementAllowance,
    },
  };
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
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `${method} ${pathname} failed with ${response.status}: ${responseText.slice(0, 1_000)}`,
    );
  }
  return response.status === 204
    ? undefined as T
    : await response.json() as T;
}

async function runInBatches<T>(
  items: T[],
  batchSize: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(operation));
  }
}

async function createLargeDataSet(
  state: E2EState,
  channels: MattermostChannel[],
  runId: string,
  searchTokens: [string, string],
  seed: number,
  createdPostIds: string[],
): Promise<void> {
  const payload = "memory-soak-payload ".repeat(48);
  const rootInputs = channels.flatMap((channel) => (
    Array.from({ length: rootsPerChannel }, (_, index) => ({
      channel,
      index,
      token: searchTokens[(index + seed) % searchTokens.length],
    }))
  ));

  await runInBatches(rootInputs, apiBatchSize, async ({ channel, index, token }) => {
    const root = await apiCall<MattermostPost>(
      state.memberUser.token,
      "POST",
      "/posts",
      {
        channel_id: channel.id,
        message: `${token} ${runId} ${channel.name} root-${index} ${payload}`,
      },
    );
    createdPostIds.push(root.id);

    const replyInputs = Array.from({ length: repliesPerRoot }, (_, replyIndex) => replyIndex);
    // Mattermost 9.5 creates the thread row when the first reply arrives.
    // Keep replies to the same root sequential to avoid racing that upsert;
    // roots from different channels still use the bounded outer batch.
    await runInBatches(replyInputs, 1, async (replyIndex) => {
      const reply = await apiCall<MattermostPost>(
        state.memberUser.token,
        "POST",
        "/posts",
        {
          channel_id: channel.id,
          root_id: root.id,
          message: `${token} ${runId} reply-${index}-${replyIndex} ${payload}`,
        },
      );
      createdPostIds.push(reply.id);
    });
  });
}

async function cleanupPosts(token: string, postIds: string[]): Promise<number> {
  const reverseIds = [...postIds].reverse();
  let failureCount = 0;
  for (let index = 0; index < reverseIds.length; index += cleanupBatchSize) {
    const results = await Promise.allSettled(
      reverseIds.slice(index, index + cleanupBatchSize).map((postId) => (
        apiCall<void>(token, "DELETE", `/posts/${postId}`)
      )),
    );
    const batchFailureCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    failureCount += batchFailureCount;
    if (batchFailureCount === results.length) {
      failureCount += Math.max(
        0,
        reverseIds.length - index - results.length,
      );
      break;
    }
  }
  return failureCount;
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

async function debugRequest<T>(page: Page, action: string): Promise<T> {
  return await page.evaluate((debugAction) => new Promise<T>((resolve, reject) => {
    const id = `deck-soak-${Math.random().toString(36).slice(2)}`;
    const handleResponse = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; result?: T }>).detail;
      if (detail?.id !== id) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener(
        "mattermost-deck-debug-response",
        handleResponse as EventListener,
      );
      resolve(detail.result as T);
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener(
        "mattermost-deck-debug-response",
        handleResponse as EventListener,
      );
      reject(new Error(`Deck debug request timed out: ${debugAction}`));
    }, 10_000);

    window.addEventListener(
      "mattermost-deck-debug-response",
      handleResponse as EventListener,
    );
    window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", {
      detail: { id, action: debugAction, payload: {} },
    }));
  }), action);
}

function metricValue(metrics: Map<string, number>, name: string): number {
  const value = metrics.get(name);
  return Number.isFinite(value) ? value as number : 0;
}

async function collectSample(
  page: Page,
  cdp: CDPSession,
  startedAt: number,
  workloadStep: number,
  rootMarker: string | null,
): Promise<SoakSample> {
  // DevTools keeps console arguments strongly reachable until discarded.
  // Clear them before GC so diagnostic logging cannot contaminate retention.
  await cdp.send("Runtime.discardConsoleEntries");
  await cdp.send("HeapProfiler.collectGarbage");
  const debugStatePromise: Promise<DeckDebugState> = deckExtensionEnabled
    ? debugRequest<DeckDebugState>(page, "getState")
    : Promise.resolve({
      stateStatus: "control",
      railWidth: 0,
      requestedRailWidth: 0,
      threadLayoutMode: "control",
      hostLayoutMeasurementCount: 0,
      userTimingMeasureCount: 0,
    });
  const [
    performanceResponse,
    heapUsage,
    domCounters,
    debugState,
    domState,
  ] = await Promise.all([
    cdp.send("Performance.getMetrics") as Promise<PerformanceMetricsResponse>,
    cdp.send("Runtime.getHeapUsage") as Promise<HeapUsageResponse>,
    cdp.send("Memory.getDOMCounters") as Promise<DOMCountersResponse>,
    debugStatePromise,
    page.evaluate((marker) => ({
      deckRootCount: document.querySelectorAll("#mattermost-deck-root").length,
      deckRootMarkerMatches: marker === null
        ? document.querySelectorAll("#mattermost-deck-root").length === 0
        : document.querySelector<HTMLElement>("#mattermost-deck-root")
            ?.dataset.memorySoakMarker === marker,
      rhsOpen: document.querySelector("#root")?.classList.contains("rhs-open") ?? false,
    }), rootMarker),
  ]);
  if (!Number.isFinite(debugState.hostLayoutMeasurementCount)) {
    throw new Error(
      "Deck debug state must expose a finite hostLayoutMeasurementCount",
    );
  }
  if (!Number.isFinite(debugState.userTimingMeasureCount)) {
    throw new Error(
      "Deck debug state must expose a finite userTimingMeasureCount",
    );
  }
  const metrics = new Map(
    performanceResponse.metrics.map((metric) => [metric.name, metric.value]),
  );

  return {
    elapsedMs: Date.now() - startedAt,
    workloadStep,
    jsHeapUsedBytes: heapUsage.usedSize,
    jsHeapTotalBytes: heapUsage.totalSize,
    embedderHeapUsedBytes: heapUsage.embedderHeapUsedSize ?? 0,
    backingStorageBytes: heapUsage.backingStorageSize ?? 0,
    nodes: domCounters.nodes,
    documents: domCounters.documents,
    eventListeners: domCounters.jsEventListeners,
    layoutCount: metricValue(metrics, "LayoutCount"),
    recalcStyleCount: metricValue(metrics, "RecalcStyleCount"),
    taskDurationSeconds: metricValue(metrics, "TaskDuration"),
    scriptDurationSeconds: metricValue(metrics, "ScriptDuration"),
    deckRootCount: domState.deckRootCount,
    deckRootMarkerMatches: domState.deckRootMarkerMatches,
    rhsOpen: domState.rhsOpen,
    railWidth: debugState.railWidth,
    threadLayoutMode: debugState.threadLayoutMode,
    hostLayoutMeasurementCount: debugState.hostLayoutMeasurementCount,
    userTimingMeasureCount: debugState.userTimingMeasureCount,
  };
}

async function stabilizeForMemorySample(
  page: Page,
  canonicalSearchToken: string,
): Promise<void> {
  if (page.viewportSize()?.width !== samplingViewportWidth) {
    await page.setViewportSize({
      width: samplingViewportWidth,
      height: 900,
    });
  }

  const openRhs = page.locator("#sidebar-right.is-open");
  const canonicalSearchAlreadyOpen = (
    await openRhs.isVisible().catch(() => false) &&
    (await openRhs.textContent().catch(() => ""))?.includes(
      canonicalSearchToken,
    )
  );
  if (!canonicalSearchAlreadyOpen) {
    if (await page.locator("#root.rhs-open").count() > 0) {
      await page.keyboard.press("Control+.");
      await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, {
        timeout: 10_000,
      });
    }
    const searchBox = page.locator("#searchBox");
    await searchBox.fill(canonicalSearchToken);
    await searchBox.press("Enter");
    await expect(openRhs).toBeVisible({ timeout: 10_000 });
    await expect(openRhs).toContainText(canonicalSearchToken, {
      timeout: 10_000,
    });
  }

  // Wait beyond Deck's 360ms host-layout settle window and the CSS width
  // transition so every GC sample has the same open-search RHS geometry.
  await page.waitForTimeout(samplingSettleMs);
}

async function runWorkloadStep(
  page: Page,
  step: number,
  searchTokens: [string, string],
  seed: number,
): Promise<number> {
  const viewportWidths = [2_200, 1_800, 1_500, 1_280];
  if (step % 2 === 0) {
    await page.setViewportSize({
      width: viewportWidths[
        (Math.floor(step / 2) + seed) % viewportWidths.length
      ],
      height: 900,
    });
  }

  // Switch among real Mattermost RHS surfaces periodically, while avoiding
  // the unrealistic native-search cache growth caused by submitting a query
  // every 1.5 seconds for the entire soak.
  if (step > 0 && step % 80 === 79) {
    if (await page.locator("#root.rhs-open").count() > 0) {
      await page.keyboard.press("Control+.");
      await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, {
        timeout: 10_000,
      });
    }
    const alternateQuery = searchTokens[1];
    const searchBox = page.locator("#searchBox");
    await searchBox.fill(alternateQuery);
    await searchBox.press("Enter");
    const openRhs = page.locator("#sidebar-right.is-open");
    await expect(openRhs).toBeVisible({ timeout: 10_000 });
    await expect(openRhs).toContainText(alternateQuery, {
      timeout: 10_000,
    });
    return 0;
  }

  if (step > 0 && step % 40 === 39) {
    if (await page.locator("#root.rhs-open").count() > 0) {
      await page.keyboard.press("Control+.");
      await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, {
        timeout: 10_000,
      });
    }
    await page.locator("#channelHeaderPinButton").click({ timeout: 10_000 });
    await expect(page.locator("#sidebar-right.is-open")).toBeVisible({
      timeout: 10_000,
    });
    return 0;
  }

  if (step > 0 && step % 20 === 19) {
    if (await page.locator("#root.rhs-open").count() > 0) {
      await page.keyboard.press("Control+.");
      await expect(page.locator("#root")).not.toHaveClass(/rhs-open/, {
        timeout: 10_000,
      });
    }
    return 0;
  }

  // The product observer deliberately ignores RHS descendants. Reuse one
  // hidden node for a high-volume, allocation-bounded mutation workload that
  // would expose accidental subtree observation or retained MutationRecords.
  const churned = await page.evaluate((operationCount) => {
    const rhs = document.querySelector<HTMLElement>("#sidebar-right.is-open");
    const churnHost = rhs?.querySelector<HTMLElement>("#rhsContainer") ?? rhs;
    if (!churnHost) {
      return false;
    }
    const churnNode = document.createElement("span");
    churnNode.hidden = true;
    churnNode.dataset.memorySoakChurn = "true";
    for (let operation = 0; operation < operationCount; operation += 1) {
      churnHost.appendChild(churnNode);
      churnNode.remove();
    }
    return true;
  }, rhsMutationOperationsPerStep);
  await expect(page.locator("[data-memory-soak-churn]")).toHaveCount(0, {
    timeout: 5_000,
  });
  return churned ? rhsMutationOperationsPerStep : 0;
}

function markdownReport(report: SoakReport): string {
  const analysis = report.analysis;
  const metricRows = analysis
    ? [
      ["JS heap", analysis.heap, mebibyte],
      ["Embedder heap", analysis.embedderHeap, mebibyte],
      ["Backing storage", analysis.backingStorage, mebibyte],
      ["DOM nodes", analysis.nodes, 1],
      ["Documents", analysis.documents, 1],
      ["Event listeners", analysis.eventListeners, 1],
      ["User Timing measures", analysis.userTimingMeasures, 1],
      ["Host layout measurements", analysis.hostLayoutMeasurements, 1],
    ].map(([label, summaryValue, divisorValue]) => {
      const summary = summaryValue as TrendSummary;
      const divisor = divisorValue as number;
      return `| ${label} | ${(summary.firstMedian / divisor).toFixed(2)} | ${
        (summary.lastMedian / divisor).toFixed(2)
      } | ${(summary.retainedGrowth / divisor).toFixed(2)} | ${
        (summary.slopePerMinute / divisor).toFixed(2)
      } | ${(summary.monotonicIncreaseRatio * 100).toFixed(1)}% |`;
    })
    : [];

  return [
    "# Mattermost Deck layout memory soak",
    "",
    `- Outcome: **${report.outcome}**`,
    `- Mode: ${report.mode}`,
    `- Mattermost: ${report.mattermostVersion ?? "unknown"}`,
    `- Seed: ${report.seed}`,
    `- Requested duration: ${report.durationMinutes.toFixed(2)} minutes`,
    `- Actual duration: ${(report.actualDurationMs / 60_000).toFixed(2)} minutes`,
    `- Workload steps: ${report.workloadSteps}`,
    `- RHS mutation operations: ${report.rhsMutationOperations}`,
    `- Created posts: ${report.createdPostCount}`,
    `- Cleanup failures: ${report.cleanupFailureCount}`,
    `- Retained samples: ${report.samples.length}/${report.maxSamples}`,
    `- Page crash: ${report.pageCrash ?? "none"}`,
    `- OOM signals: ${report.oomSignals.length}`,
    `- Failure: ${report.failure ?? "none"}`,
    "",
    "## Post-warmup trends",
    "",
    "| Metric | First median | Last median | Growth | Theil–Sen slope/min | Increasing intervals |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...metricRows,
    "",
    analysis
      ? `Host layout measurements: ${analysis.hostLayoutMeasurementDelta} for ${
        analysis.workloadStepDelta
      } workload steps; allowed ${analysis.allowedHostLayoutMeasurementDelta}.`
      : "Analysis was not completed.",
    "",
    "Heap values in the table are MiB; other metrics are counts.",
    report.mode === "control"
      ? "Control-mode memory samples cover the Mattermost page renderer without Mattermost Deck; browser-process RSS is outside this CDP target."
      : "Memory samples cover the Mattermost + Deck page renderer; the MV3 service worker and browser-process RSS are outside this CDP target.",
  ].join("\n");
}

test("large Mattermost data and RHS churn remain memory-bounded", async ({}, testInfo) => {
  test.skip(
    !soakEnabled,
    "Set MM_DECK_RUN_SOAK=1 to run the long-lived layout memory soak",
  );
  if (testInfo.config.workers !== 1) {
    throw new Error(
      "Run the memory soak in isolation with Playwright --workers=1",
    );
  }
  test.setTimeout(soakDurationMs + 10 * 60_000);
  testInfo.annotations.push({
    type: "soak-duration",
    description: `${soakDurationMinutes} minute(s); run with --workers=1`,
  });

  const state = await readState();
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "mattermost-deck-layout-soak-"),
  );
  const runId = Date.now().toString(36);
  const searchTokens: [string, string] = [
    `mmdecksoaka${runId}`,
    `mmdecksoakb${runId}`,
  ];
  const createdPostIds: string[] = [];
  const samples: SoakSample[] = [];
  const oomSignals: string[] = [];
  const pageErrors: string[] = [];
  let context: BrowserContext | null = null;
  let cdp: CDPSession | null = null;
  let pageCrash: string | null = null;
  let contextClosedUnexpectedly = false;
  let intentionalShutdown = false;
  let workloadSteps = 0;
  let rhsMutationOperations = 0;
  let startedAt = Date.now();
  let analysis: SoakAnalysis | null = null;
  const report: SoakReport = {
    outcome: "running",
    failure: null,
    mode: soakMode,
    mattermostVersion: state.mattermostVersion ?? null,
    seed: soakSeed,
    durationMinutes: soakDurationMinutes,
    actualDurationMs: 0,
    sampleIntervalMs,
    maxSamples,
    createdPostCount: 0,
    cleanupFailureCount: 0,
    workloadSteps: 0,
    rhsMutationOperations: 0,
    pageCrash: null,
    contextClosedUnexpectedly: false,
    oomSignals,
    pageErrors,
    samples,
    analysis: null,
  };

  try {
    const channels = await Promise.all(
      ["town-square", "off-topic"].map((channelName) => (
        apiCall<MattermostChannel>(
          state.memberUser.token,
          "GET",
          `/teams/${state.team.id}/channels/name/${channelName}`,
        )
      )),
    );
    await createLargeDataSet(
      state,
      channels,
      runId,
      searchTokens,
      soakSeed,
      createdPostIds,
    );
    report.createdPostCount = createdPostIds.length;

    const extensionArguments = deckExtensionEnabled
      ? [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ]
      : [];
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1_800, height: 900 },
      args: extensionArguments,
    });
    context.on("close", () => {
      if (!intentionalShutdown) {
        contextClosedUnexpectedly = true;
      }
    });

    if (deckExtensionEnabled) {
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
        railKey,
        drawerKey,
        autoAdjustKey,
        width,
        autoAdjust,
      }) => chrome.storage.local.set({
        "mattermostDeck.serverUrl.v1": serverUrl,
        [railKey]: width,
        [drawerKey]: 1,
        [autoAdjustKey]: autoAdjust ? "true" : "false",
      }), {
        serverUrl: baseUrl,
        railKey: railWidthStorageKey,
        drawerKey: drawerOpenStorageKey,
        autoAdjustKey: autoAdjustStorageKey,
        width: requestedRailWidth,
        autoAdjust: autoAdjustEnabled,
      });
    }

    const page = await context.newPage();
    page.on("crash", () => {
      pageCrash = "Chromium renderer crashed";
    });
    page.on("close", () => {
      if (!intentionalShutdown && !pageCrash) {
        pageCrash = "Mattermost page closed unexpectedly";
      }
    });
    page.on("pageerror", (error) => {
      const text = errorMessage(error);
      boundedPush(pageErrors, text);
      if (isOomSignal(text)) {
        boundedPush(oomSignals, `pageerror: ${text}`);
      }
    });
    page.on("console", (message) => {
      const text = message.text();
      if (isOomSignal(text)) {
        boundedPush(oomSignals, `${message.type()}: ${text}`);
      }
    });
    if (deckExtensionEnabled) {
      await page.addInitScript(() => {
        window.localStorage.setItem("mattermostDeck.debugLogs", "1");
      });
    }
    await login(page, state.memberUser.username, state.memberUser.password);
    await page.goto(`${baseUrl}/${state.team.name}/channels/town-square`);
    await dismissOfflineStatusModal(page);
    await dismissFirstRunOverlays(page);
    let rootMarker: string | null = null;
    if (deckExtensionEnabled) {
      await expect(page.locator("#mattermost-deck-root")).toBeAttached({
        timeout: 20_000,
      });
      await expect.poll(
        async () => (await debugRequest<DeckDebugState>(page, "getState")).stateStatus,
        { timeout: 30_000 },
      ).toBe("ready");

      rootMarker = `layout-memory-soak-${runId}`;
      await page.evaluate((marker) => {
        const root = document.querySelector<HTMLElement>("#mattermost-deck-root");
        if (!root) {
          throw new Error("Deck root not found");
        }
        root.dataset.memorySoakMarker = marker;
      }, rootMarker);
      const initialDebugState = await debugRequest<DeckDebugState>(page, "getState");
      if (!Number.isFinite(initialDebugState.hostLayoutMeasurementCount)) {
        throw new Error(
          "Deck debug state must expose a finite hostLayoutMeasurementCount",
        );
      }
      if (!Number.isFinite(initialDebugState.userTimingMeasureCount)) {
        throw new Error(
          "Deck debug state must expose a finite userTimingMeasureCount",
        );
      }
    } else {
      await expect(page.locator("#mattermost-deck-root")).toHaveCount(0);
    }

    cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.enable");
    startedAt = Date.now();
    const deadline = startedAt + soakDurationMs;
    let nextSampleAt = startedAt;

    while (Date.now() < deadline) {
      if (pageCrash || contextClosedUnexpectedly || page.isClosed()) {
        throw new Error(
          pageCrash ?? "Browser context or Mattermost page closed unexpectedly",
        );
      }
      if (oomSignals.length > 0) {
        throw new Error(`OOM signal detected: ${oomSignals[0]}`);
      }

      rhsMutationOperations += await runWorkloadStep(
        page,
        workloadSteps,
        searchTokens,
        soakSeed,
      );
      workloadSteps += 1;

      if (Date.now() >= nextSampleAt && samples.length < maxSamples) {
        await stabilizeForMemorySample(page, searchTokens[0]);
        samples.push(await collectSample(
          page,
          cdp,
          startedAt,
          workloadSteps,
          rootMarker,
        ));
        nextSampleAt = Date.now() + sampleIntervalMs;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) {
        await page.waitForTimeout(Math.min(workloadGapMs, remainingMs));
      }
    }

    if (
      samples.length < maxSamples &&
      (
        samples.length === 0 ||
        (Date.now() - startedAt) - samples.at(-1)!.elapsedMs >= 2_000
      )
    ) {
      await stabilizeForMemorySample(page, searchTokens[0]);
      samples.push(await collectSample(
        page,
        cdp,
        startedAt,
        workloadSteps,
        rootMarker,
      ));
    }

    analysis = analyzeSamples(samples);
    report.analysis = analysis;
    report.outcome = "passed";

    expect(pageCrash).toBeNull();
    expect(contextClosedUnexpectedly).toBe(false);
    expect(oomSignals).toEqual([]);
    expect(samples.length).toBeLessThanOrEqual(maxSamples);
    expect(samples.every((sample) => sample.jsHeapUsedBytes > 0)).toBe(true);
    expect(samples.every((sample) => sample.embedderHeapUsedBytes >= 0)).toBe(true);
    expect(samples.every((sample) => sample.backingStorageBytes >= 0)).toBe(true);
    expect(samples.every((sample) => sample.nodes > 0)).toBe(true);
    expect(samples.every((sample) => sample.documents > 0)).toBe(true);
    expect(samples.every((sample) => sample.rhsOpen)).toBe(true);
    expect(samples.every((sample) => (
      Number.isFinite(sample.userTimingMeasureCount)
    ))).toBe(true);
    expect(samples.every((sample) => (
      sample.deckRootCount === (deckExtensionEnabled ? 1 : 0)
    ))).toBe(true);
    expect(samples.every((sample) => sample.deckRootMarkerMatches)).toBe(true);
    expect(analysis.heap.retainedGrowth).toBeLessThanOrEqual(
      analysis.thresholds.heapGrowthBytes,
    );
    expect(analysis.heap.slopePerMinute).toBeLessThanOrEqual(
      analysis.thresholds.heapSlopeBytesPerMinute,
    );
    expect(analysis.heap.runaway).toBe(false);
    expect(analysis.nodes.retainedGrowth).toBeLessThanOrEqual(
      analysis.thresholds.nodeGrowth,
    );
    expect(analysis.nodes.slopePerMinute).toBeLessThanOrEqual(
      analysis.thresholds.nodeSlopePerMinute,
    );
    expect(analysis.nodes.runaway).toBe(false);
    expect(analysis.documents.retainedGrowth).toBeLessThanOrEqual(
      analysis.thresholds.documentGrowth,
    );
    expect(analysis.documents.slopePerMinute).toBeLessThanOrEqual(
      analysis.thresholds.documentSlopePerMinute,
    );
    expect(analysis.documents.runaway).toBe(false);
    expect(analysis.eventListeners.retainedGrowth).toBeLessThanOrEqual(
      analysis.thresholds.eventListenerGrowth,
    );
    expect(analysis.eventListeners.slopePerMinute).toBeLessThanOrEqual(
      analysis.thresholds.eventListenerSlopePerMinute,
    );
    expect(analysis.eventListeners.runaway).toBe(false);
    expect(analysis.userTimingMeasures.retainedGrowth).toBeLessThanOrEqual(
      analysis.thresholds.userTimingMeasureGrowth,
    );
    expect(analysis.userTimingMeasures.slopePerMinute).toBeLessThanOrEqual(
      analysis.thresholds.userTimingMeasureSlopePerMinute,
    );
    expect(analysis.userTimingMeasures.runaway).toBe(false);
    if (autoAdjustEnabled) {
      expect(analysis.hostLayoutMeasurementDelta).toBeLessThanOrEqual(
        analysis.allowedHostLayoutMeasurementDelta,
      );
    } else {
      expect(analysis.hostLayoutMeasurementDelta).toBe(0);
    }
  } catch (error) {
    report.outcome = "failed";
    report.failure = errorMessage(error);
    throw error;
  } finally {
    report.actualDurationMs = Date.now() - startedAt;
    report.workloadSteps = workloadSteps;
    report.rhsMutationOperations = rhsMutationOperations;
    report.createdPostCount = createdPostIds.length;
    report.pageCrash = pageCrash;
    report.contextClosedUnexpectedly = contextClosedUnexpectedly;
    report.analysis = analysis;
    intentionalShutdown = true;
    await cdp?.detach().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await fs.rm(userDataDir, { recursive: true, force: true });
    report.cleanupFailureCount = await cleanupPosts(
      state.memberUser.token,
      createdPostIds,
    );
    let cleanupError: Error | null = null;
    if (report.cleanupFailureCount > 0 && report.outcome === "passed") {
      cleanupError = new Error(
        `Failed to delete ${report.cleanupFailureCount} soak-test posts`,
      );
      report.outcome = "failed";
      report.failure = cleanupError.message;
    }

    const jsonPath = testInfo.outputPath("layout-memory-soak.json");
    const markdownPath = testInfo.outputPath("layout-memory-soak.md");
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
    await fs.writeFile(markdownPath, markdownReport(report), "utf8");
    await testInfo.attach("layout memory soak metrics", {
      path: jsonPath,
      contentType: "application/json",
    });
    await testInfo.attach("layout memory soak summary", {
      path: markdownPath,
      contentType: "text/markdown",
    });
    if (cleanupError) {
      throw cleanupError;
    }
  }
});
