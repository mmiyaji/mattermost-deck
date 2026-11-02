import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("post lists show bounded initial bodies and offscreen summaries before visibility callbacks", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const user = { id: "u".repeat(26), username: "tester", notify_props: { mention_keys: "tester", channel: "true" } };
  const author = { id: "a".repeat(26), username: "author" };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const now = Date.now();
  const posts = Array.from({ length: 500 }, (_, index) => ({ id: `p${String(index).padStart(25, "0")}`,
    user_id: author.id, channel_id: channel.id, create_at: now - index * 60_000,
    message: `@tester Initial row ${index}\n\n${index % 3 === 0 ? "**Variable height** text and a [link](https://example.test).\n\n".repeat(8) : "A short message."}` }));
  const server = createServer((request, response) => {
    const route = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!route.startsWith("/api/v4/")) {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><body class="app__body"><main id="root" class="app__content">Initial post rendering fixture</main></body></html>');
      return;
    }
    const api = route.slice("/api/v4".length);
    let value: unknown = [];
    if (api === "/users/me") value = user;
    else if (api === "/users/ids") value = [user, author];
    else if (api === "/users/me/teams") value = [team];
    else if (api.startsWith("/config/client")) value = { CollapsedThreads: "disabled" };
    else if (api === "/system/ping") value = { status: "OK" };
    else if (api.endsWith("/teams/unread")) value = [{ team_id: team.id, msg_count: 500, mention_count: 500 }];
    else if (api.endsWith("/channels/members")) value = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0 }];
    else if (api.endsWith("/channels")) value = [channel];
    else if (api.includes("/channels/")) value = channel;
    else if (api.endsWith("/posts/search")) value = { order: posts.map(post => post.id), posts: Object.fromEntries(posts.map(post => [post.id, post])) };
    else if (api.includes("/threads")) value = { total: 0, threads: [] };
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-post-initial-"));
  const extension = path.join(directory, "extension");
  let context: BrowserContext | undefined;
  try {
    await fs.cp(path.resolve("dist"), extension, { recursive: true });
    const manifestPath = path.join(extension, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.content_scripts.unshift({ matches: ["http://127.0.0.1/*"], js: ["hold-post-visibility.js"], run_at: "document_start" });
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await fs.writeFile(path.join(extension, "hold-post-visibility.js"), `
      (() => {
        const Native = IntersectionObserver;
        const held = new Map();
        let released = false, blocked = 0, delivered = 0;
        class HeldPostVisibility extends Native {
          constructor(callback, options) {
            const intercept = options?.rootMargin === '320px 0px';
            const pending = new Map();
            super((entries, observer) => {
              if (intercept && !released) {
                blocked++;
                for (const entry of entries) pending.set(entry.target, entry);
              } else {
                if (intercept) delivered++;
                callback(entries, observer);
              }
            }, options);
            if (intercept) held.set(this, { callback, pending });
          }
          disconnect() { held.delete(this); super.disconnect(); }
        }
        globalThis.IntersectionObserver = HeldPostVisibility;
        globalThis.__deckPostVisibilityGate = {
          stats: () => ({ blocked, delivered, released, pools: held.size }),
          release: () => {
            released = true;
            for (const [observer, { callback, pending }] of held) {
              if (pending.size) { delivered++; callback([...pending.values()], observer); pending.clear(); }
            }
          }
        };
      })();
    `);
    for (const mode of [
      { name: "expanded-normal", compact: false, reversed: false },
      { name: "expanded-reversed", compact: false, reversed: true },
      { name: "compact-reversed", compact: true, reversed: true },
    ]) {
      context = await chromium.launchPersistentContext(path.join(directory, mode.name), {
        channel: "chromium", headless: true, viewport: { width: 1500, height: 1000 },
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      await worker.evaluate(async ({ origin, posts, userId, mode }) => {
        const prefix = `mattermostDeck.mentionReview.v1:${encodeURIComponent(origin + "/")}:${encodeURIComponent(userId)}:post:*:`;
        await chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light",
          "mattermostDeck.pollingIntervalSeconds.v1": 3600, "mattermostDeck.preferredRailWidth.v1": 900,
          "mattermostDeck.virtualPostListExperiment.v1": false,
          "mattermostDeck.compactMode.v1": mode.compact ? "true" : "false",
          "mattermostDeck.reversedPostOrder.v1": mode.reversed ? "true" : "false",
          "mattermostDeck.layout.v1": [{ id: "initial-review", type: "mentions", mentionReview: true }],
          ...Object.fromEntries(posts.map(post => [prefix + post.id, post])),
        });
      }, { origin, posts, userId: user.id, mode });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}/testteam/channels/town-square`);
      const inspect = (action: "state" | "release" | "start" | "end" = "state") => worker.evaluate(async ({ origin, action }) => {
        const tab = (await chrome.tabs.query({})).find(value => value.url?.startsWith(origin));
        const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, args: [action], func: action => {
          const gate = (globalThis as any).__deckPostVisibilityGate;
          const host = document.getElementById("mattermost-deck-root");
          const root = host && (chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot | null;
          const pane = root?.querySelector('[data-pane-id="initial-review"]');
          const viewport = pane?.querySelector<HTMLElement>(".deck-list-viewport");
          if (action === "release") gate?.release();
          if (viewport && action === "start") viewport.scrollTop = 0;
          if (viewport && action === "end") viewport.scrollTop = viewport.scrollHeight;
          const rows = Array.from(viewport?.querySelectorAll<HTMLElement>("[data-deck-post-id]") ?? []);
          const details = rows.map(row => ({ id: row.dataset.deckPostId!, rendered: row.dataset.deckPostRendered,
            initial: row.dataset.deckPostInitialVisible }));
          const unrendered = rows.filter(row => row.dataset.deckPostRendered === "false");
          const summaries = unrendered.map(row => {
            const placeholder = row.querySelector<HTMLElement>(".deck-post-placeholder");
            return { text: placeholder?.textContent?.trim(), plain: placeholder?.childElementCount === 0,
              oneLine: placeholder && getComputedStyle(placeholder).whiteSpace === "nowrap",
              heavy: Boolean(row.querySelector("img,a,mark,.deck-mention-actions,.deck-favorite-button")) };
          });
          return { gate: gate?.stats(), count: rows.length, details, summaries,
            full: rows.filter(row => row.dataset.deckPostRendered === "true").length,
            seeded: rows.filter(row => row.dataset.deckPostInitialVisible === "true").length,
            virtuoso: Boolean(viewport?.querySelector(".deck-virtual-list")) };
        } }); return result.result;
      }, { origin, action });
      await expect.poll(async () => (await inspect())?.count, { timeout: 30_000 }).toBe(500);
      await expect.poll(async () => (await inspect())?.gate.blocked).toBeGreaterThan(0);
      const initial = await inspect();
      expect(initial.gate.delivered).toBe(0);
      expect(initial.gate.released).toBe(false);
      expect(initial.virtuoso).toBe(false);
      expect(initial.full).toBeGreaterThan(0);
      expect(initial.full).toBeLessThanOrEqual(mode.compact ? 80 : 24);
      expect(initial.seeded).toBeGreaterThan(0);
      expect(initial.seeded).toBeLessThanOrEqual(mode.compact ? 80 : 24);
      expect(initial.seeded).toBe(initial.full);
      expect(initial.details.every(row => row.initial === "true" || row.initial === "false")).toBe(true);
      expect(initial.details.find(row => row.id === posts[0].id)?.rendered).toBe("true");
      expect(initial.details[mode.reversed ? initial.details.length - 1 : 0].id).toBe(posts[0].id);
      expect(initial.details.find(row => row.id === posts[499].id)?.rendered).toBe("false");
      expect(initial.summaries).toHaveLength(500 - initial.full);
      expect(initial.summaries.every(summary => summary.text?.includes("Initial row") && summary.plain && summary.oneLine && !summary.heavy)).toBe(true);
      expect(initial.details.map(row => row.id).sort()).toEqual(posts.map(post => post.id).sort());
      await fs.writeFile(testInfo.outputPath(`${mode.name}-initial.json`), JSON.stringify(initial, null, 2));
      console.log("initial post rendering without visibility callbacks", { mode: mode.name, full: initial.full, summaries: initial.summaries.length });
      await inspect("release");
      await expect.poll(async () => (await inspect()).gate.delivered).toBeGreaterThan(0);
      await inspect(mode.reversed ? "start" : "end");
      await expect.poll(async () => (await inspect()).details.find(row => row.id === posts[499].id)?.rendered).toBe("true");
      await inspect(mode.reversed ? "end" : "start");
      await expect.poll(async () => (await inspect()).details.find(row => row.id === posts[0].id)?.rendered).toBe("true");
      expect((await inspect()).details.map(row => row.id).sort()).toEqual(posts.map(post => post.id).sort());
      expect(errors).toEqual([]);
      await context.close(); context = undefined;
    }
  } finally {
    await context?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (path.resolve(directory).startsWith(path.join(os.tmpdir(), "deck-post-initial-"))) await fs.rm(directory, { recursive: true, force: true });
  }
});
