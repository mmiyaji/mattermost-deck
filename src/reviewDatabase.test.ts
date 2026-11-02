import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";

const prefix = "mattermostDeck.mentionReview.v1:https%3A%2F%2Fchat.example:user:";
const otherPrefix = "mattermostDeck.mentionReview.v1:https%3A%2F%2Fchat.example:other-user:";
type TestRuntime = typeof globalThis & { reviewDatabase: typeof import("./reviewDatabase"); failAdds: boolean };

describe("review database migration transactions", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let bundle: string;
  beforeAll(async () => {
    const result = await build({ entryPoints: ["src/reviewDatabase.ts"], bundle: true, write: false, format: "iife", globalName: "reviewDatabase", platform: "browser" });
    bundle = result.outputFiles[0]!.text;
    browser = await chromium.launch({ headless: true });
  }, 30_000);
  afterAll(async () => { await browser?.close(); });
  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.route("https://review.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Review database test</title>" }));
    await page.goto("https://review.test/");
    await page.addScriptTag({ content: bundle });
  });
  afterEach(async () => { await context?.close(); });

  const read = () => page.evaluate(prefix => (globalThis as TestRuntime).reviewDatabase.readReviewRecords(prefix), prefix);
  const migrated = () => page.evaluate(prefix => (globalThis as TestRuntime).reviewDatabase.isReviewMigrated(prefix), prefix);
  const cleanup = () => page.evaluate(prefix => (globalThis as TestRuntime).reviewDatabase.readReviewMigrationCleanup(prefix), prefix);
  const write = (sets: Record<string, unknown>, removes: string[] = []) => page.evaluate(({ sets, removes }) => (globalThis as TestRuntime).reviewDatabase.writeReviewRecords(sets, removes), { sets, removes });
  const importLegacy = (legacy: Record<string, unknown>) => page.evaluate(({ prefix, legacy }) => (globalThis as TestRuntime).reviewDatabase.importLegacyReviewRecords(prefix, legacy), { prefix, legacy });

  it("atomically records fingerprints for only imported keys and preserves existing decisions", async () => {
    const existing = `${prefix}confirmed:existing`, pending = `${prefix}body:pending`, old = `${prefix}confirmed:old`;
    await write({ [existing]: 99 });
    await importLegacy({ [existing]: 42, [pending]: { id: "pending", message: "retain pending review" }, [old]: 0, unrelated: "keep out" });
    expect(await migrated()).toBe(true);
    expect(await read()).toEqual({ [existing]: 99, [pending]: { id: "pending", message: "retain pending review" }, [old]: 0 });
    const plan = await cleanup();
    expect(Object.keys(plan).sort()).toEqual([pending, old].sort());
    expect(Object.values(plan).every(value => /^[a-f0-9]{64}$/.test(value))).toBe(true);
    const expected = await page.evaluate(() => (globalThis as TestRuntime).reviewDatabase.fingerprintReviewValue({ id: "pending", message: "retain pending review" }));
    expect(plan[pending]).toBe(expected);
    await page.evaluate(prefix => (globalThis as TestRuntime).reviewDatabase.completeReviewMigrationCleanup(prefix), prefix);
    expect(await cleanup()).toEqual({});
    expect(await migrated()).toBe(true);
  });

  it("rolls back imported records and cleanup metadata together if import fails", async () => {
    await write({ [`${prefix}confirmed:existing`]: 55 });
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.add;
      (globalThis as TestRuntime).failAdds = true;
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name === "records" && (globalThis as TestRuntime).failAdds) throw new Error("import disk failure");
        return original.apply(this, args);
      };
    });
    const legacy = { [`${prefix}body:pending`]: { id: "pending" }, [`${prefix}confirmed:another`]: 7 };
    await expect(importLegacy(legacy)).rejects.toThrow("import disk failure");
    expect(await migrated()).toBe(false);
    expect(await cleanup()).toEqual({});
    expect(await read()).toEqual({ [`${prefix}confirmed:existing`]: 55 });
    await page.evaluate(() => { (globalThis as TestRuntime).failAdds = false; });
    await importLegacy(legacy);
    expect(await migrated()).toBe(true);
    expect(Object.keys(await cleanup())).toHaveLength(2);
  });

  it("treats legacy boolean markers as completed and does not re-import downgraded writes", async () => {
    expect(await migrated()).toBe(false);
    await write({ [`${prefix}confirmed:existing`]: 99 });
    await page.evaluate(prefix => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("mattermostDeck.mentionReview", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("metadata", "readwrite");
        transaction.objectStore("metadata").put(true, prefix);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    }), prefix);
    expect(await migrated()).toBe(true);
    expect(await cleanup()).toEqual({});
    await importLegacy({ [`${prefix}confirmed:existing`]: 42, [`${prefix}body:downgraded`]: { id: "downgraded" } });
    expect(await read()).toEqual({ [`${prefix}confirmed:existing`]: 99 });
  });

  it("does not resurrect removed records when migration is repeated after restart", async () => {
    const key = `${prefix}confirmed:removed`;
    await importLegacy({ [key]: 42 });
    await write({}, [key]);
    await page.addScriptTag({ content: bundle });
    await importLegacy({ [key]: 42 });
    expect(await read()).toEqual({});
    expect(await migrated()).toBe(true);
  });

  it("keeps account scopes separate without pruning old confirmations or pending bodies", async () => {
    const values = {
      [`${prefix}confirmed:old`]: 0,
      [`${prefix}body:old-pending`]: { id: "old-pending", create_at: 0, message: "must remain until review" },
      [`${otherPrefix}confirmed:other`]: 1,
    };
    await write(values);
    expect(await read()).toEqual({
      [`${prefix}confirmed:old`]: 0,
      [`${prefix}body:old-pending`]: { id: "old-pending", create_at: 0, message: "must remain until review" },
    });
    await importLegacy({});
    await page.evaluate(prefix => (globalThis as TestRuntime).reviewDatabase.completeReviewMigrationCleanup(prefix), prefix);
    expect(await read()).toEqual({
      [`${prefix}confirmed:old`]: 0,
      [`${prefix}body:old-pending`]: { id: "old-pending", create_at: 0, message: "must remain until review" },
    });
    expect(await page.evaluate(prefix => (globalThis as TestRuntime).reviewDatabase.readReviewRecords(prefix), otherPrefix)).toEqual({ [`${otherPrefix}confirmed:other`]: 1 });
  });
});
