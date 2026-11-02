import { chromium, expect, test } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("compare identical review feeds and scrolling with legacy and Virtuoso renderers", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const user = { id: "u".repeat(26), username: "tester", notify_props: { mention_keys: "tester", channel: "true" } };
  const author = { id: "a".repeat(26), username: "author" };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const now = Date.now();
  const posts = Array.from({ length: 500 }, (_, i) => ({ id: `p${String(i).padStart(25, "0")}`, user_id: author.id, channel_id: channel.id, create_at: now - i * 60000, message: `@tester Scroll comparison ${i}\n\n` + (i % 3 === 0 ? "**Variable height** text with a [link](https://example.com).\n\n".repeat(8) : "A short message.") }));
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith("/api/")) { res.setHeader("Content-Type", "text/html"); res.end('<html><body class="app__body"><main id="root" class="app__content">Scroll fixture</main></body></html>'); return; }
    const p = pathname.replace("/api/v4", "");
    let data: unknown = [];
    if (p === "/users/me") data = user;
    else if (p === "/users/ids") data = [user, author];
    else if (p === "/users/me/teams") data = [team];
    else if (p.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (p === "/system/ping") data = { status: "OK" };
    else if (p.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: 500, mention_count: 500 }];
    else if (p.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0 }];
    else if (p.endsWith("/channels")) data = [channel];
    else if (p.includes("/channels/")) data = channel;
    else if (p.endsWith("/posts/search")) data = { order: posts.map(post => post.id), posts: Object.fromEntries(posts.map(post => [post.id, post])) };
    else if (p.includes("/threads")) data = { total: 0, total_unread_threads: 0, threads: [] };
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const measurements: any[] = [];
  try {
    // Alternate order to reduce warm-machine / browser order bias.
    for (const virtual of process.env.MM_DECK_SCROLL_SMOKE === "1" ? [true] : [false, true, true, false]) {
      const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-scroll-comparison-"));
      const extension = path.resolve("dist");
      const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1800, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
      try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
        await worker.evaluate(async ({ origin, posts, userId, virtual }) => {
          const prefix = `mattermostDeck.mentionReview.v1:${encodeURIComponent(origin + "/")}:${encodeURIComponent(userId)}:post:*:`;
          await chrome.storage.local.set({
            "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.pollingIntervalSeconds.v1": 3600,
            "mattermostDeck.preferredRailWidth.v1": 1500, "mattermostDeck.virtualPostListExperiment.v1": virtual,
            "mattermostDeck.layout.v1": Array.from({ length: 4 }, (_, i) => ({ id: `review${i}`, type: "mentions", mentionReview: true })),
            ...Object.fromEntries(posts.map(post => [prefix + post.id, post])),
          });
        }, { origin, posts, userId: user.id, virtual });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`${origin}/testteam/channels/town-square`);
        await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 30000 });
        const inside = async (action: string) => worker.evaluate(async ({ origin, action }) => {
          const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
          const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: async action => {
            const root = (chrome as any).dom.openOrClosedShadowRoot(document.getElementById("mattermost-deck-root")) as ShadowRoot;
            const pane = root.querySelector('[data-pane-id="review0"]') as HTMLElement;
            const viewport = pane?.querySelector(".deck-list-viewport") as HTMLElement;
            if (!viewport) return null;
            const rows = () => Array.from(viewport.querySelectorAll<HTMLElement>("[data-deck-post-id]"));
            if (action === "inspect") {
              const bounds = viewport.getBoundingClientRect();
              const anchor = rows().find(row => { const r = row.getBoundingClientRect(); return r.top >= bounds.top && r.bottom <= bounds.bottom; });
              return { count: rows().length, ids: rows().map(r => r.dataset.deckPostId), rendered: rows().filter(r => r.dataset.deckPostRendered === "true").length, virtual: !!viewport.querySelector(".deck-virtual-list"), nodes: root.querySelectorAll("*").length, text: pane.textContent, top: viewport.scrollTop, height: viewport.scrollHeight, distanceToBottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
                badge: pane.querySelector(".deck-badge")?.textContent?.trim(), anchor: anchor ? { id: anchor.dataset.deckPostId, offset: anchor.getBoundingClientRect().top - bounds.top } : null };
            }
            if (action === "end") { viewport.scrollTop = viewport.scrollHeight; return true; }
            if (action === "start") { viewport.scrollTop = 0; return true; }
            if (action === "confirm") { const button = pane.querySelector<HTMLButtonElement>("[data-deck-review-confirm]"); const id = button?.dataset.deckReviewConfirm; button?.click(); return id; }
            if (action === "middle") { viewport.scrollTop = 6000; return true; }
            if (action === "resize") { pane.style.width = "520px"; return true; }
            if (action === "scroll") {
              const intervals: number[] = [];
              let previous = performance.now();
              for (let i = 0; i < 240; i++) {
                await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                const now = performance.now(); intervals.push(now - previous); previous = now;
                viewport.scrollTop += i < 120 ? 70 : -70;
              }
              intervals.sort((a, b) => a - b);
              return { frames: intervals.length, p95FrameMs: intervals[Math.ceil(intervals.length * .95) - 1], maxFrameMs: intervals.at(-1), over33ms: intervals.filter(x => x > 33.4).length };
            }
            return null;
          }, args: [action] }); return result.result as any;
        }, { origin, action });
        const writeReview = (sets: Record<string, unknown>) => worker.evaluate(async ({ origin, userId, sets }) => {
          const prefix = `mattermostDeck.mentionReview.v1:${encodeURIComponent(origin + "/")}:${encodeURIComponent(userId)}:`;
          const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
          const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: async (prefix, sets) => {
            return await chrome.runtime.sendMessage({ type: "mattermost-deck:review-storage", prefix, operation: "write", sets });
          }, args: [prefix, Object.fromEntries(Object.entries(sets).map(([key, value]) => [prefix + key, value]))] });
          if (!result.result?.success) throw new Error(result.result?.error ?? "Review write failed");
        }, { origin, userId: user.id, sets });
        await expect.poll(async () => (await inside("inspect"))?.text, { timeout: 30000 }).toContain("Scroll comparison 0");
        await expect.poll(async () => (await inside("inspect"))?.virtual).toBe(virtual);
        await page.waitForTimeout(1000);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Performance.enable");
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const before = await cdp.send("Performance.getMetrics");
        const frames = await inside("scroll");
        const after = await cdp.send("Performance.getMetrics");
        const delta = (name: string) => after.metrics.find(m => m.name === name)!.value - before.metrics.find(m => m.name === name)!.value;
        const state = await inside("inspect");
        const record = { mode: virtual ? "virtuoso" : "legacy", ...frames, taskMs: delta("TaskDuration") * 1000, layoutMs: delta("LayoutDuration") * 1000, styleMs: delta("RecalcStyleDuration") * 1000, layouts: delta("LayoutCount"), nodes: state.nodes, rowsInPane: state.count, renderedInPane: state.rendered };
        measurements.push(record);
        console.log("SCROLL_COMPARISON", JSON.stringify(record));
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await inside("end");
        await expect.poll(async () => (await inside("inspect"))?.text, { timeout: 10000 }).toContain("Scroll comparison 499");
        await inside("start");
        await expect.poll(async () => (await inside("inspect"))?.text).toContain("Scroll comparison 0");
        if (virtual) {
          expect(state.count).toBeLessThan(60);
          const id = await inside("confirm");
          await expect.poll(async () => (await inside("inspect"))?.ids).not.toContain(id);
          await expect.poll(async () => (await inside("inspect"))?.badge).toBe("499");
          await inside("middle");
          await page.waitForTimeout(500);
          const anchorBefore = (await inside("inspect")).anchor;
          await inside("resize");
          await page.waitForTimeout(700);
          const anchorAfter = (await inside("inspect")).anchor;
          console.log("RESIZE_ANCHOR", JSON.stringify({ anchorBefore, anchorAfter }));
          expect(anchorAfter?.id).toBe(anchorBefore?.id);
          // Confirm an older DOM row above the viewport, as another shared
          // review pane can do; the post currently being read must survive.
          await writeReview({ ["confirmed:" + posts[20].id]: Date.now() });
          await expect.poll(async () => (await inside("inspect"))?.badge).toBe("498");
          await page.waitForTimeout(400);
          const afterConfirm = (await inside("inspect")).anchor;
          console.log("CONFIRM_ANCHOR", JSON.stringify({ anchorAfter, afterConfirm }));
          expect(afterConfirm?.id).toBe(anchorAfter?.id);
          expect(Math.abs(afterConfirm.offset - anchorAfter.offset)).toBeLessThan(2);
          const newPost = { ...posts[0], id: "n".repeat(26), create_at: now + 60000, message: "@tester Newly arriving mention" };
          await writeReview({ ["post:*:" + newPost.id]: newPost });
          await expect.poll(async () => (await inside("inspect"))?.badge).toBe("499");
          await page.waitForTimeout(400);
          const afterPrepend = (await inside("inspect")).anchor;
          console.log("PREPEND_ANCHOR", JSON.stringify({ afterConfirm, afterPrepend }));
          expect(afterPrepend?.id).toBe(afterConfirm?.id);
          expect(Math.abs(afterPrepend.offset - afterConfirm.offset)).toBeLessThan(2);
          await worker.evaluate(async () => {
            const all = await chrome.storage.local.get(null);
            const key = "mattermostDeck.reversedPostOrder.v1";
            await chrome.storage.local.set(Object.fromEntries([key, ...Object.keys(all).filter(k => k.startsWith(key + ".profile."))].map(k => [k, "true"])));
          });
          await page.reload();
          await expect.poll(async () => (await inside("inspect"))?.text, { timeout: 30000 }).toContain("Newly arriving mention");
          await expect.poll(async () => (await inside("inspect"))?.distanceToBottom).toBeLessThan(3);

        }
        expect(errors).toEqual([]);
      } finally {
        await context.close(); await fs.rm(profile, { recursive: true, force: true });
      }
    }
  } finally {
    await fs.writeFile(testInfo.outputPath("scroll-comparison.json"), JSON.stringify({ cpuThrottle: 4, postsPerPane: 500, panes: 4, measurements }, null, 2));
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
