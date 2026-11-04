import { test, expect, chromium } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("favorite cache uses real extension storage, tab locks and account boundaries", async () => {
  test.setTimeout(90_000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-favorite-cache-"));
  const extension = path.join(directory, "extension");
  await fs.mkdir(extension);
  await fs.writeFile(path.join(extension, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Favorite cache test", version: "1.0.0", permissions: ["storage"],
    background: { service_worker: "background.js" },
  }));
  await build({ stdin: { contents: `
    import { handleFavoriteCacheStorageRequest } from './src/favoriteCacheDatabase';
    import { FAVORITE_CACHE_STORAGE_MESSAGE } from './src/favoriteCacheProtocol';
    import { FAVORITE_MEMBERSHIP_MESSAGE, handleFavoriteMembershipRequest } from './src/favoriteMembershipStorage';
    chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_AND_UNTRUSTED_CONTEXTS'});
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      const handler = message.type === FAVORITE_CACHE_STORAGE_MESSAGE ? handleFavoriteCacheStorageRequest
        : message.type === FAVORITE_MEMBERSHIP_MESSAGE ? handleFavoriteMembershipRequest : undefined;
      if (!handler) return;
      handler(message).then(result => respond({success:true,...result}), error => respond({success:false,error:String(error)}));
      return true;
    });
  `, resolveDir: process.cwd() }, outfile: path.join(extension, "background.js"), bundle: true, format: "iife", platform: "browser" });
  await fs.writeFile(path.join(extension, "test.html"), '<div id="root"></div><script type="module" src="test.js"></script>');
  await build({
    entryPoints: ["e2e/fixtures/favorites.tsx"], outfile: path.join(extension, "test.js"), bundle: true, format: "esm",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "server-boundary", setup(builder) {
      builder.onResolve({ filter: /mattermost\/api$/ }, () => ({ path: "test-api", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        export async function getPostsByIds(ids) {
          window.fixtureCalls = (window.fixtureCalls || 0) + 1;
          if (window.fixturePending) await new Promise(resolve => window.fixtureResolve = resolve);
          if (window.fixtureOffline) throw new Error('offline');
          return window.fixturePosts || [];
        }
      ` }));
    } }],
  });
  const context = await chromium.launchPersistentContext(path.join(directory, "profile"), {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const url = `chrome-extension://${new URL(sw.url()).host}/test.html`;
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.locator("output")).toHaveText("Ready");
    await page.getByRole("button", { name: "Add to favorites" }).click();
    await expect(page.getByTestId("entries")).toContainText("Cached favorite");
    await page.getByRole("button", { name: "Check cache", exact: true }).click();
    expect(await page.evaluate(() => (window as any).fixtureCalls ?? 0)).toBe(0);
    await page.reload();
    await expect(page.getByTestId("entries")).toContainText("Cached favorite");

    const second = await context.newPage();
    await second.goto(url);
    await expect(second.getByRole("button", { name: "Remove from favorites" })).toHaveAttribute("aria-pressed", "true");
    await second.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByTestId("entries")).toBeEmpty();
    await page.getByRole("button", { name: "Add to favorites" }).click();
    await expect(second.getByTestId("entries")).toContainText("Cached favorite");
    await page.getByRole("button", { name: "Switch account" }).click();
    await expect(page.locator("output")).toHaveText("Ready");
    await expect(page.getByTestId("entries")).toBeEmpty();
    await page.getByRole("button", { name: "Switch account" }).click();
    await expect(page.getByTestId("entries")).toContainText("Cached favorite");

    await page.evaluate(() => { (window as any).fixtureOffline = true; });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not save or refresh");
    await expect(page.getByTestId("entries")).toContainText("Cached favorite");
    await page.evaluate(() => {
      (window as any).fixtureOffline = false;
      (window as any).fixturePosts = [{ id: "post1", user_id: "author", channel_id: "channel", create_at: 1, message: "Edited favorite" }];
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByTestId("entries")).toContainText("Edited favorite");
    await expect(second.getByTestId("entries")).toContainText("Edited favorite");

    await page.evaluate(() => { (window as any).fixturePending = true; });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureResolve)).toBe("function");
    await second.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByTestId("entries")).toBeEmpty();
    await page.evaluate(() => { (window as any).fixtureResolve(); (window as any).fixturePending = false; });
    await page.reload();
    await expect(page.locator("output")).toHaveText("Ready");
    await expect(page.getByTestId("entries")).toBeEmpty();
    await page.getByRole("button", { name: "Add to favorites" }).click();
    await expect(page.getByTestId("entries")).toContainText("Cached favorite");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByTestId("entries")).toHaveText("Unavailable");
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByTestId("entries")).toBeEmpty();
    await page.getByRole("button", { name: "Add to favorites" }).click();
    await expect(page.getByTestId("entries")).toContainText("Cached favorite");
    await sw.evaluate(() => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("mattermostDeck.favoriteBodies", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result, transaction = database.transaction("metadata", "readwrite"), store = transaction.objectStore("metadata"), rows = store.getAll();
        rows.onsuccess = () => { for (const row of rows.result) store.put({ ...row, checkedAt: Date.now() - 8 * 24 * 60 * 60_000 }); };
        transaction.oncomplete = () => { database.close(); resolve(); };
      };
    }));
    await page.reload();
    await expect(page.getByTestId("entries")).toHaveText("Unavailable");
    const stored = await page.evaluate(async () => Object.values(await chrome.storage.local.get(null)).flat());
    expect(stored).toEqual(expect.arrayContaining([expect.objectContaining({ id: "post1" })]));
    expect(stored.filter((value: any) => value?.id === "post1").every((value: any) => !Object.hasOwn(value, "post") && !Object.hasOwn(value, "checkedAt"))).toBe(true);

    // A failed body migration must retain the old inline copy for retry, while
    // adding another favorite still writes its durable metadata successfully.
    const membershipKey = "mattermostDeck.favorites.v1:https%3A%2F%2Fexample.test%2Fteam%2F:userA";
    await sw.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      (globalThis as any).favoriteDiskUnavailable = true;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "bodies" && (globalThis as any).favoriteDiskUnavailable) throw new Error("favorite cache disk unavailable");
        return original.apply(this, args);
      };
    });
    await sw.evaluate(async key => chrome.storage.local.set({ [key]: [{
      id: "post1", revision: "legacy", addedAt: Date.now(), checkedAt: Date.now(),
      post: { id: "post1", user_id: "author", channel_id: "channel", create_at: 1, message: "Legacy pending migration" },
    }] }), membershipKey);
    await expect(page.getByTestId("entries")).toContainText("Legacy pending migration");
    await page.getByRole("button", { name: "Add another", exact: true }).click();
    await expect(page.getByTestId("entries")).toContainText("Another cached favorite");
    type StoredMembership = { id: string; post?: { message: string }; checkedAt?: number };
    const pendingMigration = await sw.evaluate(async key => (await chrome.storage.local.get(key))[key] as StoredMembership[], membershipKey);
    const legacyPending = pendingMigration.find(value => value.id === "post1");
    if (!legacyPending?.post) throw new Error("Expected the legacy favorite body to remain pending migration");
    expect(legacyPending.post.message).toBe("Legacy pending migration");
    expect(pendingMigration.find(value => value.id === "post2")).not.toHaveProperty("post");
    await sw.evaluate(() => { (globalThis as any).favoriteDiskUnavailable = false; });
    await page.reload();
    await expect(page.getByTestId("entries")).toContainText("Legacy pending migration");
    const migrated = await sw.evaluate(async key => (await chrome.storage.local.get(key))[key] as StoredMembership[], membershipKey);
    expect(migrated).toHaveLength(2);
    expect(migrated.every((value: any) => !Object.hasOwn(value, "post") && !Object.hasOwn(value, "checkedAt"))).toBe(true);
    await page.getByRole("button", { name: "Remove another", exact: true }).click();
    await expect(page.getByTestId("entries")).toHaveText("Legacy pending migration");

    // The provider receives deletion even without an App FavoritesColumn.
    // It clears the body immediately and a response already in flight cannot
    // recreate it locally, in IndexedDB, in another tab, or after reload.
    await page.evaluate(() => {
      (window as any).fixturePending = true;
      (window as any).fixturePosts = [{ id: "post1", user_id: "author", channel_id: "channel", create_at: 1, update_at: 200, message: "Late response after deletion" }];
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureResolve)).toBe("function");
    await page.getByRole("button", { name: "Delete known post", exact: true }).click();
    await expect(page.getByTestId("entries")).toHaveText("Unavailable");
    await page.evaluate(() => { (window as any).fixtureResolve(); (window as any).fixturePending = false; });
    await expect(second.getByTestId("entries")).toHaveText("Unavailable");
    await page.reload();
    await expect(page.getByTestId("entries")).toHaveText("Unavailable");
    expect((await sw.evaluate(async key => (await chrome.storage.local.get(key))[key] as StoredMembership[], membershipKey)).map(value => value.id)).toEqual(["post1"]);
    await sw.evaluate(() => { chrome.storage.local.set = async () => { throw new Error("quota exceeded"); }; });
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not save or refresh");
    await expect(page.getByTestId("entries")).toHaveText("Unavailable");
  } finally {
    await context.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
