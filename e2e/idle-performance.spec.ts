import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Real extension renderer; deterministic API fixture and isolated-world visibility
// transitions make before/after runs comparable even in headless Chromium.
test("diagnostics stop sampling out of view and resume without accumulating work", async ({}, testInfo) => {
  const phaseMs = Number(process.env.DECK_PERF_PHASE_MS ?? 6_000);
  test.setTimeout(phaseMs * 4 + 60_000);
  const baseline = process.env.DECK_PERF_BASELINE === "1";
  const extension = path.resolve(process.env.DECK_PERF_EXTENSION ?? "dist");
  const user = { id: "u".repeat(26), username: "sample", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test" };
  let requests = 0;
  const server = createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!p.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><body class="app__body"><div id="root"><div id="SidebarContainer">Fixture</div><main class="app__content"><h1 class="channel-header">Test</h1></main></div></body></html>');
      return;
    }
    requests++;
    const data = p.endsWith("/users/me") ? user : p.endsWith("/users/me/teams") ? [team]
      : p.endsWith("/config/client") ? { CollapsedThreads: "disabled" }
      : p.endsWith("/system/ping") ? { status: "OK" } : [];
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-idle-perf-"));
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
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
        const pane = root?.querySelector(".deck-column--diagnostics") as HTMLElement | null;
        if (!pane) return null;
        const state = window as any;
        if (action === "install" && !state.__idleProbe) {
          state.__idleProbe = { samples: 0 };
          const original = document.getElementsByTagName.bind(document);
          document.getElementsByTagName = ((name: string) => {
            if (name === "*") state.__idleProbe.samples++;
            return original(name);
          }) as typeof document.getElementsByTagName;
        }
        if (action === "hidden" || action === "visible") {
          Object.defineProperty(document, "hidden", { configurable: true, value: action === "hidden" });
          Object.defineProperty(document, "visibilityState", { configurable: true, value: action === "hidden" ? "hidden" : "visible" });
          document.dispatchEvent(new Event("visibilitychange"));
        }
        if (action === "offscreen" || action === "onscreen") {
          (pane.closest(".deck-pane-frame") as HTMLElement).style.display = action === "offscreen" ? "none" : "";
        }
        return { samples: state.__idleProbe?.samples ?? 0, hidden: document.hidden };
      }});
      return result.result;
    }, { origin, action });
    await expect.poll(() => probe("read")).not.toBeNull();
    await probe("install");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const sample = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      const metrics = await cdp.send("Performance.getMetrics");
      const dom = await cdp.send("Memory.getDOMCounters");
      const heap = await cdp.send("Runtime.getHeapUsage");
      return { ...(await probe("read"))!, requests, taskSeconds: metrics.metrics.find(m => m.name === "TaskDuration")!.value,
        heapBytes: heap.usedSize, nodes: dom.nodes, listeners: dom.jsEventListeners };
    };
    const measurements = [];
    for (const phase of ["visible", "hidden", "offscreen", "resumed"]) {
      if (phase === "hidden") await probe("hidden");
      if (phase === "offscreen") { await probe("offscreen"); await probe("visible"); }
      if (phase === "resumed") await probe("onscreen");
      // Allow IntersectionObserver's 250ms settling delay and the immediate poll.
      await page.waitForTimeout(750);
      const before = await sample();
      await page.waitForTimeout(phaseMs);
      const after = await sample();
      const measurement = { phase, durationMs: phaseMs, samples: after.samples - before.samples,
        requests: after.requests - before.requests, taskMs: (after.taskSeconds - before.taskSeconds) * 1_000,
        heapDeltaBytes: after.heapBytes - before.heapBytes, nodesDelta: after.nodes - before.nodes,
        listenersDelta: after.listeners - before.listeners, before, after };
      measurements.push(measurement);
      if (!baseline && (phase === "hidden" || phase === "offscreen")) expect(measurement.samples).toBe(0);
      if (phase === "visible" || phase === "resumed") expect(measurement.samples).toBeGreaterThan(0);
    }
    const report = { baseline, extension, phaseMs, visibility: "simulated document state; actual IntersectionObserver for pane hiding", measurements };
    const output = testInfo.outputPath("idle-performance.json");
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    await testInfo.attach("idle-performance", { path: output, contentType: "application/json" });
    if (process.env.DECK_PERF_REPORT) await fs.writeFile(path.resolve(process.env.DECK_PERF_REPORT), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(measurements.map(({ before, after, ...summary }) => summary)));
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith("deck-idle-perf-")) {
      throw new Error("Refusing to remove a profile outside the test temporary directory");
    }
    await fs.rm(profile, { recursive: true, force: true });
  }
});
