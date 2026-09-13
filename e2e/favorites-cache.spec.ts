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
  await fs.writeFile(path.join(extension, "background.js"), "chrome.runtime.onInstalled.addListener(() => {});");
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
    await page.evaluate(async () => {
      const values = await chrome.storage.local.get(null);
      for (const [key, entries] of Object.entries(values)) {
        if (key.startsWith("mattermostDeck.favorites.v1:")) {
          await chrome.storage.local.set({ [key]: (entries as any[]).map(f => ({ ...f, checkedAt: Date.now() - 8 * 24 * 60 * 60_000 })) });
        }
      }
    });
    await page.reload();
    await expect(page.getByTestId("entries")).toHaveText("Unavailable");
    const stored = await page.evaluate(async () => Object.values(await chrome.storage.local.get(null)).flat());
    expect(stored).toEqual(expect.arrayContaining([expect.objectContaining({ id: "post1", post: null })]));
    await page.evaluate(() => { chrome.storage.local.set = async () => { throw new Error("quota exceeded"); }; });
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not save or refresh");
    await expect(page.getByTestId("entries")).toHaveText("Unavailable");
  } finally {
    await context.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
