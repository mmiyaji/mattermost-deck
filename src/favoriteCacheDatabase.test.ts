import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { FAVORITE_CACHE_MAX_BYTES, type FavoriteCacheStorageRequest } from "./favoriteCacheProtocol";
import { FAVORITES_CACHE_TTL_MS, favoriteStorageKey } from "./ui/favorites";

const NOW = 1_800_000_000_000;
const scope = JSON.stringify(["https://chat.example/", "user"]);
const member = (id = "post", revision = "member-1") => ({ id, revision, addedAt: NOW - 1000 });
const body = (id = "post", revision = "member-1", version = 100, requestStartedAt = NOW) => ({
  id, revision, checkedAt: NOW, requestStartedAt,
  post: { id, user_id: "author", channel_id: "channel", message: `version-${version}`, create_at: 1, update_at: version },
});
type Runtime = typeof globalThis & { favoriteDatabase: typeof import("./favoriteCacheDatabase");
  stored: Record<string, unknown>; now: number; failPut: boolean };

describe("extension-origin favorite body cache", () => {
  let browser: Browser, context: BrowserContext, page: Page, bundle: string;
  beforeAll(async () => {
    bundle = (await build({ entryPoints: ["src/favoriteCacheDatabase.ts"], bundle: true, write: false, format: "iife", globalName: "favoriteDatabase", platform: "browser" })).outputFiles[0]!.text;
    browser = await chromium.launch({ headless: true });
  }, 30_000);
  afterAll(async () => { await browser?.close(); });
  beforeEach(async () => {
    context = await browser.newContext(); page = await context.newPage();
    await page.route("https://favorite-cache.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Favorite cache test</title>" }));
    await page.goto("https://favorite-cache.test/");
    await page.evaluate(now => {
      const runtime = globalThis as Runtime;
      runtime.now = now; runtime.stored = {}; runtime.failPut = false; Date.now = () => runtime.now;
      Object.defineProperty(globalThis, "chrome", { configurable: true, value: { storage: {
        local: { get: async (key: string) => ({ [key]: runtime.stored[key] }) }, session: { set: async () => undefined },
      } } });
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "bodies" && runtime.failPut) throw new Error("disk unavailable");
        return put.apply(this, args);
      };
    }, NOW);
    await page.addScriptTag({ content: bundle });
    await memberships(scope, [member()]);
  });
  afterEach(async () => { await context?.close(); });
  const request = (message: FavoriteCacheStorageRequest) => page.evaluate(message => (globalThis as Runtime).favoriteDatabase.handleFavoriteCacheStorageRequest(message), message);
  async function memberships(scope: string, members: ReturnType<typeof member>[]) {
    const [server, user] = JSON.parse(scope) as string[];
    await page.evaluate(({ key, members }) => { (globalThis as Runtime).stored[key] = members; }, { key: favoriteStorageKey(server, user), members });
  }
  const get = (members = [member()], cacheScope = scope) => request({ operation: "get", scope: cacheScope, members });

  it("separates account scopes and never stores cached bodies in local membership", async () => {
    await request({ operation: "put", scope, entries: [body()] });
    expect((await get()).entries?.[0].post?.message).toBe("version-100");
    expect((await get([member()], JSON.stringify(["https://chat.example/", "other"]))).entries).toEqual([]);
    expect(await page.evaluate(() => Object.values((globalThis as Runtime).stored))).toEqual([[member()]]);
  });

  it("prevents late versions and older requests from replacing newer cached results", async () => {
    await request({ operation: "put", scope, entries: [body("post", "member-1", 200, NOW - 100)] });
    await request({ operation: "put", scope, entries: [body("post", "member-1", 100, NOW)] });
    expect((await get()).entries?.[0].post?.update_at).toBe(200);
    await request({ operation: "put", scope, entries: [{ ...body(), post: null, requestStartedAt: NOW - 200 }] });
    expect((await get()).entries?.[0].post?.update_at).toBe(200);
  });

  it("keeps deletion tombstones and cannot resurrect a delayed body or erase membership", async () => {
    await request({ operation: "put", scope, entries: [body()] });
    await request({ operation: "invalidate", scope, ids: ["post"] });
    await request({ operation: "put", scope, entries: [body("post", "member-1", 500)] });
    expect((await get()).entries?.[0]).toMatchObject({ id: "post", post: null, deleted: true });
    expect(await page.evaluate(() => Object.values((globalThis as Runtime).stored))).toEqual([[member()]]);
    // A fresh module/connection still reads the durable deletion marker.
    await page.addScriptTag({ content: bundle });
    expect((await get()).entries?.[0].deleted).toBe(true);
  });

  it("honors membership revisions for a remove and re-add during a request", async () => {
    await memberships(scope, [member("post", "readded")]);
    await request({ operation: "put", scope, entries: [body()] });
    expect((await get([member("post", "readded")])).entries).toEqual([]);
    await request({ operation: "put", scope, entries: [body("post", "readded", 200)] });
    await request({ operation: "remove", scope, ids: ["post"], members: [member()] });
    expect((await get([member("post", "readded")])).entries?.[0].post?.update_at).toBe(200);
  });

  it("serializes concurrent writes and prunes expired bodies without changing membership", async () => {
    const members = Array.from({ length: 20 }, (_, index) => member(`post-${index}`));
    await memberships(scope, members);
    await Promise.all(members.map(value => request({ operation: "put", scope, entries: [body(value.id)] })));
    expect((await get(members)).entries).toHaveLength(20);
    await page.evaluate(now => { (globalThis as Runtime).now = now; }, NOW + FAVORITES_CACHE_TTL_MS + 1);
    expect((await get(members)).entries).toEqual([]);
    expect(await page.evaluate(() => Object.values((globalThis as Runtime).stored))).toEqual([members]);
  });

  it("bounds global UTF-8 body bytes across accounts instead of evicting favorite membership", async () => {
    const scopes = Array.from({ length: 4 }, (_, index) => JSON.stringify(["https://chat.example/", `user-${index}`]));
    const members = Array.from({ length: 100 }, (_, index) => member(`post-${index}`));
    for (const cacheScope of scopes) {
      await memberships(cacheScope, members);
      await request({ operation: "put", scope: cacheScope, entries: members.map(value => ({ ...body(value.id), post: { ...body(value.id).post, message: "あ".repeat(16_000) } })) });
    }
    const metadata = await page.evaluate(() => new Promise<Array<{ bytes: number }>>((resolve, reject) => {
      const open = indexedDB.open("mattermostDeck.favoriteBodies", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result, transaction = database.transaction("metadata", "readonly"), read = transaction.objectStore("metadata").getAll();
        transaction.oncomplete = () => { database.close(); resolve(read.result); };
      };
    }));
    expect(metadata.length).toBeLessThan(400);
    expect(metadata.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThanOrEqual(FAVORITE_CACHE_MAX_BYTES);
    expect(await page.evaluate(() => Object.values((globalThis as Runtime).stored).map(value => (value as unknown[]).length))).toEqual([1, 100, 100, 100, 100]);
  });

  it("recovers its queue after an aborted transaction and preserves local data", async () => {
    await page.evaluate(() => { (globalThis as Runtime).failPut = true; });
    await expect(request({ operation: "put", scope, entries: [body()] })).rejects.toThrow("disk unavailable");
    expect(await page.evaluate(() => Object.values((globalThis as Runtime).stored))).toEqual([[member()]]);
    await page.evaluate(() => { (globalThis as Runtime).failPut = false; });
    await request({ operation: "put", scope, entries: [body()] });
    expect((await get()).entries).toHaveLength(1);
  });
});
