import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Exercise the built extension against repeatable Mattermost-like DOM churn.
// The qSA counter is installed in the extension's isolated world after startup
// and counts only the blocking-dialog selector used by route monitoring.
test("idle route monitoring ignores ordinary Mattermost DOM churn", async ({}, testInfo) => {
  const repeats = Number(process.env.DECK_IDLE_REPEATS ?? 3);
  const phaseMs = Number(process.env.DECK_IDLE_PHASE_MS ?? 10_000);
  const hiddenMs = Number(process.env.DECK_IDLE_HIDDEN_MS ?? 95_000);
  test.setTimeout(repeats * phaseMs + hiddenMs + 120_000);
  const baseline = process.env.DECK_PERF_BASELINE === "1";
  const extension = path.resolve(process.env.DECK_PERF_EXTENSION ?? "dist");
  const user = { id: "u".repeat(26), username: "sample", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test" };
  const requests: Record<string, number> = {};
  const server = createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!p.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><body class="app__body"><div id="root"><div id="SidebarContainer">Fixture</div><main class="app__content"><h1 class="channel-header">Test</h1><section id="posts"></section></main></div></body></html>');
      return;
    }
    requests[p] = (requests[p] ?? 0) + 1;
    const data = p.endsWith("/users/me") ? user : p.endsWith("/users/me/teams") ? [team]
      : p.endsWith("/config/client") ? { CollapsedThreads: "disabled" }
      : p.endsWith("/system/ping") ? { status: "OK" } : [];
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-idle-monitor-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1600, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await sw.evaluate(origin => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin,
      "mattermostDeck.language.v1": "en",
      "mattermostDeck.theme.v1": "light",
      "mattermostDeck.layout.v1": [{ id: "diagnostics", type: "diagnostics" }, { id: "favorites", type: "favorites" }],
    }), origin);
    const page = await context.newPage();
    await page.goto(`${origin}/testteam/channels/town-square`);
    const probe = (action: string) => sw.evaluate(async ({ origin, action }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      if (!tab?.id) return null;
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [action], func: action => {
        const state = window as any;
        if (action === "install" && !state.__idleMonitorProbe) {
          state.__idleMonitorProbe = { documentScans: 0, subtreeScans: 0, healthFetches: 0, sessionFetches: 0 };
          const original = Document.prototype.querySelectorAll;
          Document.prototype.querySelectorAll = function (selectors: string) {
            if (typeof selectors === "string" && selectors.includes(".modal-dialog") && selectors.includes("[role='dialog']")) {
              state.__idleMonitorProbe.documentScans++;
            }
            return original.call(this, selectors);
          };
          const originalElementQuery = Element.prototype.querySelectorAll;
          Element.prototype.querySelectorAll = function (selectors: string) {
            if (typeof selectors === "string" && selectors.includes(".modal-dialog") && selectors.includes("[role='dialog']")) {
              state.__idleMonitorProbe.subtreeScans++;
            }
            return originalElementQuery.call(this, selectors);
          };
          const originalFetch = window.fetch;
          window.fetch = function (...args: Parameters<typeof fetch>) {
            const stack = new Error().stack ?? "";
            if (stack.includes("checkApiHealth")) state.__idleMonitorProbe.healthFetches++;
            if (stack.includes("verifyMattermostSession")) state.__idleMonitorProbe.sessionFetches++;
            return originalFetch.apply(this, args);
          };
        }
        if (action === "hidden" || action === "visible") {
          Object.defineProperty(document, "hidden", { configurable: true, value: action === "hidden" });
          Object.defineProperty(document, "visibilityState", { configurable: true, value: action === "hidden" ? "hidden" : "visible" });
          document.dispatchEvent(new Event("visibilitychange"));
        }
        if (action === "churn") {
          const host = document.getElementById("posts");
          if (host) {
            const cards = Array.from({ length: 250 }, (_, i) => {
              const card = document.createElement("article");
              card.className = `post-row post-row-${i % 20}`;
              card.textContent = `Post ${i}`;
              return card;
            });
            host.replaceChildren(...cards);
            for (let pass = 0; pass < 8; pass++) {
              for (let i = 0; i < cards.length; i += 5) {
                const card = cards[i] as HTMLElement;
                card.classList.toggle("is-selected");
                card.style.setProperty("--fixture-update", String(pass));
                card.replaceChildren(document.createTextNode(`Post ${i} update ${pass}`));
              }
            }
          }
        }
        if (action === "dialogOpen") {
          const wrapper = document.createElement("div");
          wrapper.id = "fixture-dialog-wrapper";
          wrapper.style.position = "absolute";
          wrapper.style.top = "0px";
          wrapper.style.left = "0px";
          wrapper.style.width = "100px";
          wrapper.style.height = "100px";
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          wrapper.append(dialog);
          document.body.append(wrapper);
        }
        if (action === "dialogHide") {
          const wrapper = document.getElementById("fixture-dialog-wrapper");
          if (wrapper) (wrapper as HTMLElement).style.display = "none";
        }
        if (action === "dialogShow") {
          const wrapper = document.getElementById("fixture-dialog-wrapper");
          if (wrapper) (wrapper as HTMLElement).style.display = "";
        }
        if (action === "dialogClose") document.getElementById("fixture-dialog-wrapper")?.remove();
        const root = document.getElementById("mattermost-deck-root") as HTMLElement | null;
        return { documentScans: state.__idleMonitorProbe?.documentScans ?? 0,
          subtreeScans: state.__idleMonitorProbe?.subtreeScans ?? 0,
          healthFetches: state.__idleMonitorProbe?.healthFetches ?? 0,
          sessionFetches: state.__idleMonitorProbe?.sessionFetches ?? 0,
          hidden: document.hidden, rootExists: Boolean(root), rootZIndex: root?.style.zIndex ?? null };
      }});
      return result.result;
    }, { origin, action });
    await expect.poll(() => probe("read")).not.toBeNull();
    await probe("install");
    await expect.poll(async () => (await probe("readRootState"))?.rootExists).toBe(true);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const sample = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      const metrics = await cdp.send("Performance.getMetrics");
      const dom = await cdp.send("Memory.getDOMCounters");
      const heap = await cdp.send("Runtime.getHeapUsage");
      return { ...(await probe("read"))!, requests: { ...requests },
        taskSeconds: metrics.metrics.find(m => m.name === "TaskDuration")!.value,
        heapBytes: heap.usedSize, nodes: dom.nodes, listeners: dom.jsEventListeners };
    };
    // Warm up the route poller before collecting any timed samples.
    await page.waitForTimeout(5_500);
    const measurements = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      const before = await sample();
      // Separate mutation batches beyond the observer debounce interval so
      // each batch can independently trigger or avoid a dialog-state scan.
      for (let batch = 0; batch < 4; batch++) {
        await probe("churn");
        await page.waitForTimeout(phaseMs / 4);
      }
      const after = await sample();
      measurements.push({ repeat: repeat + 1, durationMs: phaseMs,
        fullDocumentDialogScans: after.documentScans - before.documentScans,
        subtreeCandidateDialogScans: after.subtreeScans - before.subtreeScans,
        taskMs: (after.taskSeconds - before.taskSeconds) * 1_000,
        heapDeltaBytes: after.heapBytes - before.heapBytes,
        nodesDelta: after.nodes - before.nodes,
        listenersDelta: after.listeners - before.listeners,
        apiRequestDelta: Object.fromEntries(Array.from(new Set([...Object.keys(before.requests), ...Object.keys(after.requests)])).map(p => [p, (after.requests[p] ?? 0) - (before.requests[p] ?? 0)])),
        before, after });
    }
    await probe("hidden");
    await page.waitForTimeout(300);
    const hiddenBefore = await sample();
    await page.waitForTimeout(hiddenMs);
    const hiddenAfter = await sample();
    const hiddenMeasurement = { phase: "hidden", durationMs: hiddenMs,
      fullDocumentDialogScans: hiddenAfter.documentScans - hiddenBefore.documentScans,
      subtreeCandidateDialogScans: hiddenAfter.subtreeScans - hiddenBefore.subtreeScans,
      healthFetches: hiddenAfter.healthFetches - hiddenBefore.healthFetches,
      sessionFetches: hiddenAfter.sessionFetches - hiddenBefore.sessionFetches,
      taskMs: (hiddenAfter.taskSeconds - hiddenBefore.taskSeconds) * 1_000,
      apiRequestDelta: Object.fromEntries(Array.from(new Set([...Object.keys(hiddenBefore.requests), ...Object.keys(hiddenAfter.requests)])).map(p => [p, (hiddenAfter.requests[p] ?? 0) - (hiddenBefore.requests[p] ?? 0)])),
      before: hiddenBefore, after: hiddenAfter };
    const resumeBefore = await sample();
    await probe("visible");
    await page.waitForTimeout(750);
    const resumeAfter = await sample();
    const resumeMeasurement = { phase: "visible-resume", durationMs: 750,
      fullDocumentDialogScans: resumeAfter.documentScans - resumeBefore.documentScans,
      subtreeCandidateDialogScans: resumeAfter.subtreeScans - resumeBefore.subtreeScans };
    const dialogTransitions = [];
    for (const action of ["dialogOpen", "dialogHide", "dialogShow", "dialogClose"]) {
      const before = await sample();
      await probe(action);
      const expectedZIndex = action === "dialogOpen" || action === "dialogShow" ? "0" : null;
      if (expectedZIndex !== null) {
        await expect.poll(async () => (await probe("readRootState"))?.rootZIndex, { timeout: 2_000 }).toBe(expectedZIndex);
      } else {
        await expect.poll(async () => (await probe("readRootState"))?.rootZIndex, { timeout: 2_000 }).not.toBe("0");
      }
      const after = await sample();
      dialogTransitions.push({ action, fullDocumentDialogScans: after.documentScans - before.documentScans,
        subtreeCandidateDialogScans: after.subtreeScans - before.subtreeScans,
        rootExists: after.rootExists, rootZIndex: after.rootZIndex });
    }
    const report = { baseline, extension, repeats, phaseMs,
      fixture: "250 post-like rows; 8 rounds of class, custom-style, and child-text changes per row",
      selectorCounter: "Document and Element querySelectorAll calls containing the blocking-dialog selector; counted separately in the extension isolated world",
      workload: "four mutation batches per timed phase, each separated by one quarter phase duration (greater than the 250ms observer debounce)",
      hiddenPhaseMs: hiddenMs,
      hiddenMeasurementNotes: "document.hidden/visibilityState and visibilitychange are simulated in the extension isolated world; health fetches are identified from checkApiHealth call stacks and session fetches from verifyMattermostSession stacks",
      selectorCounters: "full-document querySelectorAll and Element subtree querySelectorAll are counted separately for the blocking-dialog selector",
      measurements, hiddenMeasurement, resumeMeasurement, dialogTransitions };
    const output = testInfo.outputPath("idle-monitoring-performance.json");
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    await testInfo.attach("idle-monitoring-performance", { path: output, contentType: "application/json" });
    if (process.env.DECK_PERF_REPORT) await fs.writeFile(path.resolve(process.env.DECK_PERF_REPORT), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(measurements.map(({ before, after, ...summary }) => summary)));
    // Baseline is descriptive. After implementation, ensure ordinary DOM churn
    // no longer causes immediate dialog scans in addition to the fallback poll.
    if (!baseline) {
      expect(measurements.every(m => m.fullDocumentDialogScans <= Math.ceil(phaseMs / 5_000) + 1)).toBe(true);
      expect(hiddenMeasurement.fullDocumentDialogScans).toBe(0);
      expect(hiddenMeasurement.healthFetches).toBe(0);
      expect(resumeMeasurement.fullDocumentDialogScans).toBeGreaterThan(0);
      expect(dialogTransitions.every(m => m.fullDocumentDialogScans > 0)).toBe(true);
      expect(dialogTransitions.every(m => m.rootExists)).toBe(true);
      expect(dialogTransitions.find(m => m.action === "dialogOpen")?.rootZIndex).toBe("0");
      expect(dialogTransitions.find(m => m.action === "dialogHide")?.rootZIndex).not.toBe("0");
      expect(dialogTransitions.find(m => m.action === "dialogShow")?.rootZIndex).toBe("0");
      expect(dialogTransitions.find(m => m.action === "dialogClose")?.rootZIndex).not.toBe("0");
    }
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith("deck-idle-monitor-")) {
      throw new Error("Refusing to remove a profile outside the test temporary directory");
    }
    await fs.rm(profile, { recursive: true, force: true });
  }
});
