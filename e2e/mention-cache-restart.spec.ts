import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const MINUTES = 60_000;

interface MentionCacheFixture {
  save: (message: string, persist: boolean, scope?: string) => Promise<void>;
  load: (persist: boolean, offsetMs?: number, scope?: string) => Promise<string[] | null>;
  clear: () => Promise<void>;
  storedKeys: () => Promise<{ local: string[]; session: string[] }>;
}

declare global {
  interface Window {
    mentionCacheFixture: MentionCacheFixture;
  }
}

// Exercise real extension-owned IndexedDB and session storage across a browser
// restart. Content clients reach the database through the service worker.
test("the mention cache survives a browser restart only when persistence is enabled", async () => {
  test.setTimeout(120_000);
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "deck-mention-cache-restart-"),
  );
  const extension = path.join(directory, "extension");
  const profile = path.join(directory, "profile");
  await fs.mkdir(extension);
  await fs.writeFile(
    path.join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Mention cache restart test",
      version: "1.0.0",
      permissions: ["storage"],
      background: { service_worker: "background.js" },
    }),
  );
  await build({
    stdin: {
      contents: `import { handleMentionCacheStorageRequest } from "./src/mentionCacheDatabase";
        import { handleMentionCacheSessionRequest } from "./src/mentionCacheSession";
        import { MENTION_CACHE_STORAGE_MESSAGE } from "./src/mentionCacheProtocol";
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          if (message?.type !== MENTION_CACHE_STORAGE_MESSAGE) return;
          (message.persist === false ? handleMentionCacheSessionRequest(message) : handleMentionCacheStorageRequest(message)).then(
            result => sendResponse({success:true,...result}),
            error => sendResponse({success:false,error:String(error)}));
          return true;
        });`,
      resolveDir: process.cwd(),
    },
    outfile: path.join(extension, "background.js"),
    bundle: true,
    format: "iife",
  });
  await fs.writeFile(
    path.join(extension, "test.html"),
    '<script type="module" src="test.js"></script>',
  );
  await build({
    entryPoints: ["e2e/fixtures/mentionCache.ts"],
    outfile: path.join(extension, "test.js"),
    bundle: true,
    format: "esm",
    define: { "process.env.NODE_ENV": '"production"' },
  });

  const launch = () =>
    chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });

  const openFixture = async (context: BrowserContext) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/test.html`);
    await expect(page.locator("output")).toHaveText("Ready");
    return page;
  };

  let context = await launch();
  try {
    const page = await openFixture(context);

    await page.evaluate(async () => {
      await window.mentionCacheFixture.save("persisted", true);
      await window.mentionCacheFixture.save("ephemeral", false);
      for (let index = 0; index < 20; index++) {
        await window.mentionCacheFixture.save(`scope-${index}`, true, `team-${index}`);
      }
    });

    expect(
      await page.evaluate(() => window.mentionCacheFixture.load(true)),
    ).toEqual(["persisted"]);
    expect(
      await page.evaluate(() => window.mentionCacheFixture.load(false)),
    ).toEqual(["ephemeral"]);

    // Inside one browser session the short display window still applies to the
    // session copy; the persisted copy exists to be shown later, so it holds.
    expect(
      await page.evaluate(
        (offset) => window.mentionCacheFixture.load(true, offset),
        20 * MINUTES,
      ),
    ).toEqual(["persisted"]);
    expect(
      await page.evaluate(
        (offset) => window.mentionCacheFixture.load(false, offset),
        20 * MINUTES,
      ),
    ).toBeNull();

    await context.close();
    context = await launch();
    const restarted = await openFixture(context);

    expect(
      await restarted.evaluate(() => window.mentionCacheFixture.load(true)),
    ).toEqual(["persisted"]);
    expect(
      await restarted.evaluate(() => window.mentionCacheFixture.load(false)),
    ).toBeNull();
    expect(
      await restarted.evaluate(() => window.mentionCacheFixture.storedKeys()),
    ).toEqual({
      local: [],
      session: [],
    });

    for (let index = 0; index < 20; index++) {
      expect(await restarted.evaluate(index => window.mentionCacheFixture.load(true, 0, `team-${index}`), index)).toEqual([`scope-${index}`]);
    }

    // Turning the setting off has to take the copy on disk with it.
    await restarted.evaluate(() => window.mentionCacheFixture.clear());

    expect(
      await restarted.evaluate(() => window.mentionCacheFixture.load(true)),
    ).toBeNull();
    expect(
      await restarted.evaluate(() => window.mentionCacheFixture.storedKeys()),
    ).toEqual({ local: [], session: [] });
  } finally {
    await context.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
