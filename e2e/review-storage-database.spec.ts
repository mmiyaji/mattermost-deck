import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("review migration survives local quota and stores more than 10MB across restart", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-review-database-"));
  const prefix = "mattermostDeck.mentionReview.v1:http%3A%2F%2F127.0.0.1%3A8066:database-fixture:";
  const mib = 1024 * 1024;
  let context: BrowserContext | undefined;
  const launch = () => chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`] });
  try {
    context = await launch();
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const optionsUrl = new URL("options.html", worker.url()).href;
    let page = await context.newPage();
    await page.goto(optionsUrl);
    const migration = await page.evaluate(async ({ prefix, mib }) => {
      const legacyKey = `${prefix}post:*:legacy`;
      await chrome.storage.local.set({ [legacyKey]: { id: "legacy", user_id: "author", channel_id: "channel", create_at: 1, message: "p".repeat(2 * mib) },
        [`${prefix}confirmed:old`]: 42, unrelatedFixture: "u".repeat(6 * mib) });
      let quotaRejected = false;
      try { await chrome.storage.local.set({ overflowFixture: "x".repeat(3 * mib) }); }
      catch (error) { quotaRejected = /quota|exceed/i.test(String(error)); }
      const beforeBytes = await chrome.storage.local.getBytesInUse();
      const result = await chrome.runtime.sendMessage({ type: "mattermost-deck:review-storage", prefix, operation: "get" });
      const local = await chrome.storage.local.get([legacyKey, `${prefix}confirmed:old`, "unrelatedFixture"]);
      return { quotaRejected, success: result.success, legacyLength: result.values?.[legacyKey]?.message.length,
        confirmation: result.values?.[`${prefix}confirmed:old`], legacyRemoved: !(legacyKey in local),
        unrelatedLength: local.unrelatedFixture?.length, beforeBytes, afterBytes: await chrome.storage.local.getBytesInUse() };
    }, { prefix, mib });
    expect(migration).toMatchObject({ quotaRejected: true, success: true, legacyLength: 2 * mib, confirmation: 42, legacyRemoved: true, unrelatedLength: 6 * mib });
    expect(migration.afterBytes).toBeLessThan(migration.beforeBytes - mib);

    const written = await page.evaluate(async ({ prefix, mib }) => {
      const post = (id: string, size: number) => ({ id, user_id: "author", channel_id: "channel", create_at: 2, message: "d".repeat(size) });
      return chrome.runtime.sendMessage({ type: "mattermost-deck:review-storage", prefix, operation: "write", sets: {
        [`${prefix}post:*:pending`]: true, [`${prefix}body:pending`]: post("pending", 7 * mib),
        [`${prefix}post:*:confirmed`]: true, [`${prefix}body:confirmed`]: post("confirmed", 5 * mib), [`${prefix}confirmed:confirmed`]: 77,
      } });
    }, { prefix, mib });
    expect(written.success).toBe(true);
    const peers = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(peers.map(peer => peer.goto("http://127.0.0.1:8066/login", { waitUntil: "domcontentloaded" })));
    const notified = await page.evaluate(async prefix => {
      const tabs = (await chrome.tabs.query({})).filter(tab => tab.id !== undefined && tab.url?.startsWith("http://127.0.0.1:8066/"));
      for (const tab of tabs) await chrome.scripting.executeScript({ target: { tabId: tab.id! }, args: [prefix], func: prefix => {
        const changes: unknown[] = [];
        (window as any).__reviewStorageTestChanges = changes;
        chrome.runtime.onMessage.addListener(message => { if (message?.type === "mattermost-deck:review-changed" && message.prefix === prefix) changes.push(message.changes); });
      } });
      await chrome.runtime.sendMessage({ type: "mattermost-deck:review-storage", prefix, operation: "write", sets: { [`${prefix}confirmed:pending`]: 88 } });
      await chrome.runtime.sendMessage({ type: "mattermost-deck:review-storage", prefix, operation: "write", removes: [`${prefix}confirmed:pending`] });
      const results = [];
      for (const tab of tabs) {
        const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => (window as any).__reviewStorageTestChanges });
        results.push(result.result);
      }
      return results;
    }, prefix);
    expect(notified).toHaveLength(2);
    for (const changes of notified) expect(changes).toEqual([{ [`${prefix}confirmed:pending`]: 88 }, { [`${prefix}confirmed:pending`]: null }]);
    await context.close();
    context = await launch();
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    page = await context.newPage();
    await page.goto(new URL("options.html", worker.url()).href);
    const restored = await page.evaluate(async prefix => {
      const result = await chrome.runtime.sendMessage({ type: "mattermost-deck:review-storage", prefix, operation: "get" });
      return { success: result.success, pendingLength: result.values?.[`${prefix}body:pending`]?.message.length,
        pendingConfirmed: result.values?.[`${prefix}confirmed:pending`] ?? null,
        confirmedLength: result.values?.[`${prefix}body:confirmed`]?.message.length,
        confirmation: result.values?.[`${prefix}confirmed:confirmed`], oldDecision: result.values?.[`${prefix}confirmed:old`] };
    }, prefix);
    expect(restored).toEqual({ success: true, pendingLength: 7 * mib, pendingConfirmed: null, confirmedLength: 5 * mib, confirmation: 77, oldDecision: 42 });
    await fs.writeFile(testInfo.outputPath("review-database-summary.json"), JSON.stringify({ migration, notifiedTabs: notified.length, restored }, null, 2));
  } finally {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
