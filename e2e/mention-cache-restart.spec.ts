import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const MINUTES = 60_000;

interface MentionCacheFixture {
  save: (message: string, persist: boolean) => Promise<void>;
  load: (persist: boolean, offsetMs?: number) => Promise<string[] | null>;
  clear: () => Promise<void>;
  storedKeys: () => Promise<{ local: string[]; session: string[] }>;
}

declare global {
  interface Window {
    mentionCacheFixture: MentionCacheFixture;
  }
}

// The opt-in setting is only worth anything if Chrome itself keeps the two
// storage areas apart the way the module assumes: session storage emptied with
// the browser session, local storage carried into the next one. Exercise the
// real areas rather than a stub, across an actual browser restart.
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
  await fs.writeFile(
    path.join(extension, "background.js"),
    "chrome.runtime.onInstalled.addListener(() => {});",
  );
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
      local: ["mattermostDeck.mentionFeedCache.v1"],
      session: [],
    });

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
