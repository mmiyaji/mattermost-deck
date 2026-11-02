import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const METRICS = "test.reviewRecovery.metrics";
for (const invalidated of [false, true]) {
  test(`review read failure ${invalidated ? "requests a page reload" : "retries authoritative decisions"}`, async ({}, testInfo) => {
    const user = { id: "u".repeat(26), username: "reviewuser", notify_props: { mention_keys: "reviewuser" } };
    const author = { id: "a".repeat(26), username: "author" };
    const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
    const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
    const posts = ["p", "q"].map((id, index) => ({ id: id.repeat(26), user_id: author.id,
      channel_id: channel.id, create_at: Date.now() - index * 1000, message: `@reviewuser recovery ${index}` }));
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (!pathname.startsWith("/api/")) {
        response.setHeader("Content-Type", "text/html");
        response.end('<html><body class="app__body"><main id="root" class="app__content">Review recovery fixture</main></body></html>');
        return;
      }
      const route = pathname.replace("/api/v4", "");
      let value: unknown = [];
      if (route === "/users/me") value = user;
      else if (route === "/users/ids") value = [user, author];
      else if (route === "/users/me/teams") value = [team];
      else if (route.endsWith("/teams/unread")) value = [{ team_id: team.id, msg_count: 2, mention_count: 2 }];
      else if (route.startsWith("/config/client")) value = { CollapsedThreads: "disabled" };
      else if (route === "/system/ping") value = { status: "OK" };
      else if (route.endsWith("/channels/members")) value = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: 2 }];
      else if (route.endsWith("/channels")) value = [channel];
      else if (route.includes("/channels/")) value = channel;
      else if (route.endsWith("/posts/search")) value = { order: posts.map(post => post.id), posts: Object.fromEntries(posts.map(post => [post.id, post])) };
      else if (route.includes("/threads")) value = { total: 0, threads: [] };
      else if (route.endsWith("/unread")) value = { team_id: team.id, msg_count: 2, mention_count: 2 };
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const prefix = `mattermostDeck.mentionReview.v1:${encodeURIComponent(origin + "/")}:${user.id}:`;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-review-recovery-"));
    const extension = path.join(directory, "extension");
    let context: BrowserContext | undefined;
    const errors: string[] = [];
    try {
      await fs.cp(path.resolve("dist"), extension, { recursive: true });
      const manifestPath = path.join(extension, "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      manifest.content_scripts.unshift({ matches: ["http://127.0.0.1/*"], js: ["review-fault.js"], run_at: "document_start" });
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
      await fs.writeFile(path.join(extension, "review-fault.js"), `(() => {
        const prefix = ${JSON.stringify(prefix)}, metricsKey = ${JSON.stringify(METRICS)};
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        const get = chrome.storage.local.get.bind(chrome.storage.local), set = chrome.storage.local.set.bind(chrome.storage.local);
        let failed = false;
        chrome.runtime.sendMessage = async (...args) => {
          const request = args[0];
          if (request?.type === 'mattermost-deck:review-storage') {
            const metrics = (await get(metricsKey))[metricsKey] || { reads: 0, writes: 0 };
            if (request.operation === 'get') {
              metrics.reads++; metrics.prefixes = [...(metrics.prefixes || []), request.prefix]; await set({ [metricsKey]: metrics });
              if (request.prefix === prefix && !failed) { failed = true; throw new Error(${JSON.stringify(invalidated ? "Extension context invalidated." : "Could not establish connection. Receiving end does not exist.")}); }
            } else { metrics.writes++; await set({ [metricsKey]: metrics }); }
          }
          return await send(...args);
        };
      })();`);
      context = await chromium.launchPersistentContext(path.join(directory, "profile"), {
        channel: "chromium", headless: true, viewport: { width: 1600, height: 1000 },
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      await worker.evaluate(({ origin, prefix, posts }) => chrome.storage.local.set({
        "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light",
        "mattermostDeck.pollingIntervalSeconds.v1": 3600, "mattermostDeck.preferredRailWidth.v1": 900,
        "mattermostDeck.layout.v1": [{ id: "normal", type: "mentions" }, { id: "review", type: "mentions", mentionReview: true }],
        [`${prefix}post:*:${posts[0].id}`]: posts[0], [`${prefix}post:*:${posts[1].id}`]: posts[1],
        [`${prefix}confirmed:${posts[1].id}`]: 123,
      }), { origin, prefix, posts });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}/testteam/channels/town-square`);
      const inspect = (action = "state") => worker.evaluate(async ({ origin, action }) => {
        const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
        if (!tab?.id) return null;
        const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [action], func: action => {
          const host = document.getElementById("mattermost-deck-root");
          const root = host && (chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot | null;
          const pane = root?.querySelector('[data-deck-column-id="review"]');
          const alert = pane?.querySelector("[data-deck-review-error]");
          if (action === "retry") alert?.querySelector<HTMLButtonElement>("button")?.click();
          if (action === "confirm") pane?.querySelector<HTMLButtonElement>("[data-deck-review-confirm]")?.click();
          return { error: alert?.textContent ?? "", recovery: alert?.querySelector("button")?.textContent,
            enabledConfirm: pane?.querySelectorAll("[data-deck-review-confirm]:not(:disabled)").length ?? 0,
            posts: Array.from(pane?.querySelectorAll<HTMLElement>("[data-deck-post-id]") ?? []).map(post => post.dataset.deckPostId),
            badge: pane?.querySelector(".deck-badge")?.textContent?.trim(),
            normalCount: root?.querySelectorAll('[data-deck-column-id="normal"] [data-deck-post-id]').length ?? 0 };
        } }); return result.result;
      }, { origin, action });
      await expect.poll(async () => (await inspect())?.error, { timeout: 20000 }).toContain("Could not load or save review state").catch(async error => {
        console.log("recovery diagnostics", await inspect(), await worker.evaluate(() => chrome.storage.local.get(null)), errors);
        throw error;
      });
      await expect.poll(async () => (await inspect())?.normalCount).toBe(2);
      expect((await inspect())?.recovery).toBe(invalidated ? "Reload page" : "Retry");
      expect((await inspect())?.enabledConfirm).toBe(0);
      expect((await inspect())?.badge).toBe("—");
      const before = await worker.evaluate(async ({ metrics, prefix, confirmed }) => {
        const values = await chrome.storage.local.get([metrics, `${prefix}confirmed:${confirmed}`]);
        return { metrics: values[metrics], decision: values[`${prefix}confirmed:${confirmed}`] };
      }, { metrics: METRICS, prefix, confirmed: posts[1].id });
      expect(before.metrics.writes).toBe(0);
      expect(before.decision).toBe(123);
      if (!invalidated) {
        await inspect("retry");
        await expect.poll(async () => (await inspect())?.error).toBe("");
        await expect.poll(async () => (await inspect())?.posts).toEqual([posts[0].id]);
        expect((await inspect())?.badge).toBe("1");
        expect((await inspect())?.enabledConfirm).toBe(1);
        await inspect("confirm");
        await expect.poll(async () => (await inspect())?.badge).toBe("0");
        const decisions = await worker.evaluate(async keys => new Promise<unknown[]>((resolve, reject) => {
          const open = indexedDB.open("mattermostDeck.mentionReview", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result, transaction = database.transaction("records");
            const reads = keys.map(key => transaction.objectStore("records").get(key));
            transaction.oncomplete = () => { resolve(reads.map(read => read.result)); database.close(); };
            transaction.onabort = () => { reject(transaction.error); database.close(); };
          };
        }), posts.map(post => `${prefix}confirmed:${post.id}`));
        expect(typeof decisions[0]).toBe("number"); expect(decisions[1]).toBe(123);
      }
      expect(errors).toEqual([]);
      await fs.writeFile(testInfo.outputPath("review-recovery-state.json"), JSON.stringify({ invalidated, before, after: await inspect(), errors }, null, 2));
    } finally {
      await context?.close(); await new Promise<void>(resolve => server.close(() => resolve()));
      const relative = path.relative(os.tmpdir(), directory);
      if (relative.startsWith("deck-review-recovery-") && !relative.includes(path.sep)) await fs.rm(directory, { recursive: true, force: true });
    }
  });
}
