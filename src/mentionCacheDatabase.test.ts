import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import {
  MENTION_CACHE_HARD_TTL_MS,
  MENTION_CACHE_MAX_BYTES,
  MENTION_CACHE_MAX_ENTRIES,
} from "./mentionCacheProtocol";
import type { MentionCacheStorageRequest } from "./mentionCacheDatabase";

// Use the browser's real IndexedDB transactions rather than a partial in-memory
// substitute. Playwright and esbuild are already development dependencies.
const BASE_TIME = 1_800_000_000_000;
const LEGACY_KEY = "mattermostDeck.mentionFeedCache.v1";
const DATABASE_NAME = "mattermostDeck.mentionCache";
type TestRuntime = typeof globalThis & {
  cacheDatabase: typeof import("./mentionCacheDatabase");
  testNow: number;
  testLegacy: Record<string, unknown>;
  failPut: boolean;
  failRemove: boolean;
  bodyGets: number;
  bodyPuts: number;
  legacyRemoves: number;
};

function key(index: number, server = "https://chat.example", user = "user") {
  return JSON.stringify([server, user, `team-${index}`]);
}

function snapshot(index: number, savedAt = BASE_TIME, message = `message-${index}`) {
  return {
    version: 1, serverScope: "https://chat.example", userId: "user", scopeTeamId: `team-${index}`,
    savedAt, teamIds: [`team-${index}`], mentionSignature: "@user", fingerprint: `fingerprint-${message.length}-${message.slice(0, 16)}`,
    posts: [{ id: `post-${index}`, channel_id: "channel", user_id: "author", create_at: savedAt, message }],
    readState: { channelLastViewedAt: {}, threadLastViewedAt: {}, activeChannelIds: null },
  };
}

describe("extension-origin mention cache database", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let bundle: string;

  beforeAll(async () => {
    const compiled = await build({ entryPoints: ["src/mentionCacheDatabase.ts"], bundle: true, write: false, format: "iife", globalName: "cacheDatabase", platform: "browser" });
    bundle = compiled.outputFiles[0]!.text;
    browser = await chromium.launch({ headless: true });
  }, 30_000);
  afterAll(async () => { await browser?.close(); });
  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.route("https://cache.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Cache database test</title>" }));
    await page.goto("https://cache.test/");
    await page.evaluate(({ now }) => {
      const runtime = globalThis as TestRuntime;
      runtime.testNow = now;
      runtime.testLegacy = {};
      runtime.failPut = false;
      runtime.failRemove = false;
      runtime.bodyGets = 0;
      runtime.bodyPuts = 0;
      runtime.legacyRemoves = 0;
      Date.now = () => runtime.testNow;
      Object.defineProperty(globalThis, "chrome", { configurable: true, value: { storage: { local: {
        get: async (key: string) => ({ [key]: runtime.testLegacy[key] }),
        remove: async (key: string) => {
          runtime.legacyRemoves += 1;
          if (runtime.failRemove) throw new Error("legacy cleanup failed");
          delete runtime.testLegacy[key];
        },
      } } } });
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        if (this.name === "snapshots") runtime.bodyGets += 1;
        return get.apply(this, args);
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "snapshots") {
          runtime.bodyPuts += 1;
          if (runtime.failPut) throw new Error("disk unavailable");
        }
        return put.apply(this, args);
      };
    }, { now: BASE_TIME });
    await page.addScriptTag({ content: bundle });
  });
  afterEach(async () => { await context?.close(); });

  async function request(message: MentionCacheStorageRequest) {
    return page.evaluate(message => (globalThis as TestRuntime).cacheDatabase.handleMentionCacheStorageRequest(message), message);
  }

  async function setTime(now: number) {
    await page.evaluate(now => { (globalThis as TestRuntime).testNow = now; }, now);
  }

  async function legacy(entries: Record<string, unknown>) {
    await page.evaluate(({ entries, legacyKey }) => { (globalThis as TestRuntime).testLegacy[legacyKey] = { version: 1, entries }; }, { entries, legacyKey: LEGACY_KEY });
  }

  async function metadata() {
    return page.evaluate(databaseName => new Promise<Array<{ key: string; bytes: number; savedAt: number; lastAccessAt: number }>>((resolve, reject) => {
      const open = indexedDB.open(databaseName, 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("metadata", "readonly");
        const read = transaction.objectStore("metadata").getAll();
        transaction.oncomplete = () => { db.close(); resolve(read.result); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    }), DATABASE_NAME);
  }

  it("retains more than four independent server, user and team scopes", async () => {
    for (let index = 0; index < 8; index++) await request({ operation: "put", key: key(index), snapshot: snapshot(index) });
    const alternate = { ...snapshot(0), serverScope: "https://other.example", userId: "other-user", scopeTeamId: null };
    const alternateKey = JSON.stringify([alternate.serverScope, alternate.userId, "all"]);
    await request({ operation: "put", key: alternateKey, snapshot: alternate });
    for (let index = 0; index < 8; index++) expect((await request({ operation: "get", key: key(index) })).snapshot).toEqual(snapshot(index));
    expect((await request({ operation: "get", key: alternateKey })).snapshot).toEqual(alternate);
    expect(await metadata()).toHaveLength(9);
  });

  it("evicts the least recently accessed scope at the 64-scope cap", async () => {
    for (let index = 0; index < MENTION_CACHE_MAX_ENTRIES; index++) {
      await setTime(BASE_TIME + index * 1000);
      await request({ operation: "put", key: key(index), snapshot: snapshot(index, BASE_TIME + index * 1000) });
    }
    await setTime(BASE_TIME + 65_000);
    await request({ operation: "get", key: key(0) });
    await setTime(BASE_TIME + 66_000);
    await request({ operation: "put", key: key(64), snapshot: snapshot(64, BASE_TIME + 66_000) });
    expect(await metadata()).toHaveLength(64);
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeDefined();
    expect((await request({ operation: "get", key: key(1) })).snapshot).toBeUndefined();
  });

  it("enforces the global UTF-8 byte budget without reading cached bodies during writes", async () => {
    for (let index = 0; index < 36; index++) {
      await setTime(BASE_TIME + index * 1000);
      // Japanese text exercises bytes rather than JavaScript string length.
      await request({ operation: "put", key: key(index), snapshot: snapshot(index, BASE_TIME + index * 1000, "あ".repeat(160_000)) });
    }
    const entries = await metadata();
    expect(entries.length).toBeLessThan(36);
    expect(entries.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThanOrEqual(MENTION_CACHE_MAX_BYTES);
    expect(await page.evaluate(() => (globalThis as TestRuntime).bodyGets)).toBe(0);
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeUndefined();
    expect((await request({ operation: "get", key: key(35) })).snapshot).toBeDefined();
  });

  it("deduplicates unchanged bodies for one minute and preserves newer snapshots", async () => {
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    await setTime(BASE_TIME + 1000);
    await request({ operation: "put", key: key(0), snapshot: snapshot(0, BASE_TIME + 1000) });
    expect(await page.evaluate(() => (globalThis as TestRuntime).bodyPuts)).toBe(1);
    await request({ operation: "put", key: key(0), snapshot: snapshot(0, BASE_TIME - 1000, "older") });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toEqual(snapshot(0));
    await setTime(BASE_TIME + 61_000);
    await request({ operation: "put", key: key(0), snapshot: snapshot(0, BASE_TIME + 61_000) });
    expect(await page.evaluate(() => (globalThis as TestRuntime).bodyPuts)).toBe(2);
  });

  it("expires snapshots at 24 hours without extending TTL when they are read", async () => {
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    await setTime(BASE_TIME + MENTION_CACHE_HARD_TTL_MS - 1);
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeDefined();
    await setTime(BASE_TIME + MENTION_CACHE_HARD_TTL_MS + 1);
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeUndefined();
    expect(await metadata()).toHaveLength(0);
  });

  it("ignores an untrusted far-future request clock", async () => {
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    expect((await request({ operation: "get", key: key(0), now: Number.MAX_SAFE_INTEGER })).snapshot).toBeDefined();
  });

  it("rejects arbitrary keys, ownership, schema, timestamps and oversized UTF-8 snapshots", async () => {
    for (const invalidKey of ["arbitrary", "[]", '["a","b",null]', '["a", "b", "c"]']) {
      await expect(request({ operation: "get", key: invalidKey })).rejects.toThrow("Invalid mention cache key");
    }
    for (const invalid of [
      { ...snapshot(0), userId: "other-user" }, { ...snapshot(0), scopeTeamId: "other-team" },
      { ...snapshot(0), version: 2 }, { ...snapshot(0), savedAt: -1 },
      { ...snapshot(0), savedAt: BASE_TIME + 300_001 }, { ...snapshot(0), savedAt: BASE_TIME - MENTION_CACHE_HARD_TTL_MS - 1 },
      { ...snapshot(0), posts: {} }, { ...snapshot(0), readState: {} },
      { ...snapshot(0), arbitraryData: "not a snapshot field" },
    ]) await expect(request({ operation: "put", key: key(0), snapshot: invalid })).rejects.toThrow("Invalid mention cache");
    await expect(request({ operation: "put", key: key(0), snapshot: snapshot(0, BASE_TIME, "あ".repeat(180_000)) })).rejects.toThrow("size limit");
    expect(await page.evaluate(() => (globalThis as TestRuntime).legacyRemoves)).toBe(0);
  });

  it("commits migration before deleting legacy data and leaves it intact on a failed transaction", async () => {
    await legacy({ [key(0)]: snapshot(0), [key(1)]: snapshot(1) });
    await page.evaluate(() => { (globalThis as TestRuntime).failPut = true; });
    await expect(request({ operation: "get", key: key(0) })).rejects.toThrow("disk unavailable");
    expect(await page.evaluate(legacyKey => (globalThis as TestRuntime).testLegacy[legacyKey], LEGACY_KEY)).toBeDefined();
    expect(await metadata()).toHaveLength(0);
    await page.evaluate(() => { (globalThis as TestRuntime).failPut = false; });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toEqual(snapshot(0));
    expect(await page.evaluate(legacyKey => (globalThis as TestRuntime).testLegacy[legacyKey], LEGACY_KEY)).toBeUndefined();
    expect((await request({ operation: "get", key: key(1) })).snapshot).toEqual(snapshot(1));
  });

  it("preserves newer destination data and prunes malformed or expired legacy entries", async () => {
    const newer = snapshot(0, BASE_TIME, "newer database data");
    await page.evaluate(({ databaseName, key, snapshot }) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(databaseName, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("snapshots");
        open.result.createObjectStore("metadata", { keyPath: "key" });
        open.result.createObjectStore("state");
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction(["snapshots", "metadata"], "readwrite");
        transaction.objectStore("snapshots").put(snapshot, key);
        transaction.objectStore("metadata").put({ key, savedAt: snapshot.savedAt, lastAccessAt: snapshot.savedAt, fingerprint: snapshot.fingerprint, bytes: new TextEncoder().encode(JSON.stringify(snapshot)).byteLength });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    }), { databaseName: DATABASE_NAME, key: key(0), snapshot: newer });
    await legacy({ [key(0)]: snapshot(0, BASE_TIME - 1000), [key(1)]: snapshot(1), [key(2)]: snapshot(2, BASE_TIME - MENTION_CACHE_HARD_TTL_MS - 1), nonsense: snapshot(3) });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toEqual(newer);
    expect(await metadata()).toHaveLength(2);
  });

  it("enforces scope and snapshot bounds while migrating a legacy registry", async () => {
    const entries: Record<string, unknown> = {};
    for (let index = 0; index < 70; index++) entries[key(index)] = snapshot(index, BASE_TIME - 70_000 + index * 1000);
    entries[key(70)] = snapshot(70, BASE_TIME, "あ".repeat(180_000));
    await legacy(entries);
    expect((await request({ operation: "get", key: key(69) })).snapshot).toBeDefined();
    expect(await metadata()).toHaveLength(64);
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeUndefined();
    expect((await request({ operation: "get", key: key(70) })).snapshot).toBeUndefined();
  });

  it("migrates before a scoped removal and does not resurrect removed legacy data", async () => {
    await legacy({ [key(0)]: snapshot(0), [key(1)]: snapshot(1) });
    await request({ operation: "remove", key: key(0) });
    await page.addScriptTag({ content: bundle });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeUndefined();
    expect((await request({ operation: "get", key: key(1) })).snapshot).toEqual(snapshot(1));
  });

  it("clears legacy and IDB data without resurrection even when legacy cleanup fails", async () => {
    await legacy({ [key(0)]: snapshot(0) });
    await page.evaluate(() => { (globalThis as TestRuntime).failRemove = true; });
    await expect(request({ operation: "clear" })).rejects.toThrow("legacy cleanup failed");
    await page.evaluate(() => { (globalThis as TestRuntime).failRemove = false; });
    await page.addScriptTag({ content: bundle });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeUndefined();
    expect(await page.evaluate(legacyKey => (globalThis as TestRuntime).testLegacy[legacyKey], LEGACY_KEY)).toBeUndefined();
    await request({ operation: "put", key: key(1), snapshot: snapshot(1) });
    await request({ operation: "clear" });
    expect(await metadata()).toHaveLength(0);
  });

  it("clears all teams of one account while retaining other servers and users during migration", async () => {
    const otherServer = { ...snapshot(0), serverScope: "https://other.example" };
    const otherUser = { ...snapshot(0), userId: "another-user" };
    const allTeams = { ...snapshot(0), scopeTeamId: null };
    const accountKey = JSON.stringify([allTeams.serverScope, allTeams.userId, "all"]);
    const otherServerKey = key(0, otherServer.serverScope);
    const otherUserKey = key(0, otherUser.serverScope, otherUser.userId);
    await legacy({ [key(0)]: snapshot(0), [key(1)]: snapshot(1), [accountKey]: allTeams,
      [otherServerKey]: otherServer, [otherUserKey]: otherUser });
    await request({ operation: "clear", key: accountKey });
    for (const clearedKey of [key(0), key(1), accountKey]) {
      expect((await request({ operation: "get", key: clearedKey })).snapshot).toBeUndefined();
    }
    expect((await request({ operation: "get", key: otherServerKey })).snapshot).toEqual(otherServer);
    expect((await request({ operation: "get", key: otherUserKey })).snapshot).toEqual(otherUser);
    // A delayed write from another content context cannot undo the opt-out.
    await page.addScriptTag({ content: bundle });
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeUndefined();
    await setTime(BASE_TIME + 1);
    const fresh = snapshot(0, BASE_TIME + 1, "fresh after opt-in");
    await request({ operation: "put", key: key(0), snapshot: fresh });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toEqual(fresh);
  });

  it("keeps a scoped removal effective against stale writes after a background restart", async () => {
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    await setTime(BASE_TIME + 1000);
    await request({ operation: "remove", key: key(0) });
    await page.addScriptTag({ content: bundle });
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeUndefined();
    await request({ operation: "put", key: key(1), snapshot: snapshot(1) });
    expect((await request({ operation: "get", key: key(1) })).snapshot).toEqual(snapshot(1));
    await setTime(BASE_TIME + 1001);
    const fresh = snapshot(0, BASE_TIME + 1001, "fresh after invalidation");
    await request({ operation: "put", key: key(0), snapshot: fresh });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toEqual(fresh);
  });

  it("keeps explicit clear-all effective against stale writes for every account", async () => {
    const other = { ...snapshot(0), userId: "another-user" };
    const otherKey = key(0, other.serverScope, other.userId);
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    await request({ operation: "put", key: otherKey, snapshot: other });
    await setTime(BASE_TIME + 1);
    await request({ operation: "clear" });
    await page.addScriptTag({ content: bundle });
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    await request({ operation: "put", key: otherKey, snapshot: other });
    expect(await metadata()).toHaveLength(0);
    await setTime(BASE_TIME + 2);
    const fresh = { ...other, savedAt: BASE_TIME + 2 };
    await request({ operation: "put", key: otherKey, snapshot: fresh });
    expect((await request({ operation: "get", key: otherKey })).snapshot).toEqual(fresh);
  });

  it("prunes invalidation watermarks after every snapshot they protect has expired", async () => {
    await request({ operation: "remove", key: key(0) });
    await request({ operation: "clear", key: key(0) });
    await request({ operation: "clear" });
    await setTime(BASE_TIME + MENTION_CACHE_HARD_TTL_MS + 1);
    await request({ operation: "get", key: key(0) });
    const stateKeys = await page.evaluate(databaseName => new Promise<IDBValidKey[]>((resolve, reject) => {
      const open = indexedDB.open(databaseName, 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("state", "readonly");
        const read = transaction.objectStore("state").getAllKeys();
        transaction.oncomplete = () => { db.close(); resolve(read.result); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    }), DATABASE_NAME);
    expect(stateKeys).toEqual(["legacy-migrated"]);
  });

  it("leaves confirmation and pending-review storage untouched when display snapshots are cleared", async () => {
    const reviewValues = { "confirmed:post": 1234, "body:pending": { id: "pending", message: "keep pending review" } };
    await page.evaluate(values => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("mattermostDeck.mentionReview", 1);
      open.onupgradeneeded = () => { open.result.createObjectStore("records"); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("records", "readwrite");
        for (const [key, value] of Object.entries(values)) transaction.objectStore("records").put(value, key);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    }), reviewValues);
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    await request({ operation: "remove", key: key(0) });
    await request({ operation: "clear", key: key(0) });
    await request({ operation: "clear" });
    const retained = await page.evaluate(() => new Promise<Record<string, unknown>>((resolve, reject) => {
      const open = indexedDB.open("mattermostDeck.mentionReview", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("records", "readonly");
        const records: Record<string, unknown> = {};
        const read = transaction.objectStore("records").openCursor();
        read.onsuccess = () => { const cursor = read.result; if (cursor) { records[String(cursor.key)] = cursor.value; cursor.continue(); } };
        transaction.oncomplete = () => { db.close(); resolve(records); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    }));
    expect(retained).toEqual(reviewValues);
  });

  it("serializes concurrent writes without losing independent scopes", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => request({ operation: "put", key: key(index), snapshot: snapshot(index) })));
    expect(await metadata()).toHaveLength(20);
    for (let index = 0; index < 20; index++) expect((await request({ operation: "get", key: key(index) })).snapshot).toEqual(snapshot(index));
  });

  it("rejects unavailable IndexedDB and retries a later working open", async () => {
    await page.evaluate(() => {
      const runtime = globalThis as typeof globalThis & { originalIndexedDB: IDBFactory };
      runtime.originalIndexedDB = indexedDB;
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    });
    await expect(request({ operation: "get", key: key(0) })).rejects.toThrow();
    expect(await page.evaluate(() => (globalThis as TestRuntime).legacyRemoves)).toBe(0);
    await page.evaluate(() => Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: (globalThis as typeof globalThis & { originalIndexedDB: IDBFactory }).originalIndexedDB }));
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toEqual(snapshot(0));
  });

  it("closes on versionchange and reopens after database deletion", async () => {
    await request({ operation: "put", key: key(0), snapshot: snapshot(0) });
    await page.evaluate(databaseName => new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
    }), DATABASE_NAME);
    await request({ operation: "put", key: key(1), snapshot: snapshot(1) });
    expect((await request({ operation: "get", key: key(0) })).snapshot).toBeUndefined();
    expect((await request({ operation: "get", key: key(1) })).snapshot).toEqual(snapshot(1));
  });
});
