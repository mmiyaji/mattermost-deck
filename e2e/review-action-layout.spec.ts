import { chromium, expect, test } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("review actions overlay the card without moving content in either renderer", async ({}, testInfo) => {
  const user = { id: "u".repeat(26), username: "tester", notify_props: { mention_keys: "tester" } };
  const author = { id: "a".repeat(26), username: "author" };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test Team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const posts = Array.from({ length: 3 }, (_, i) => ({ id: `p${String(i).padStart(25, "0")}`, channel_id: channel.id, user_id: author.id, create_at: Date.now() - i * 3600000, message: "@tester Review layout fixture. A message that wraps across several lines so changing the action controls must not move its text." }));
  const server = createServer((req, res) => {
    const route = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!route.startsWith("/api/")) { res.setHeader("Content-Type", "text/html"); res.end('<html><body class="app__body"><main id="root" class="app__content">Layout fixture</main></body></html>'); return; }
    const p = route.replace("/api/v4", ""); let data: unknown = [];
    if (p === "/users/me") data = user;
    else if (p === "/users/ids") data = [user, author];
    else if (p === "/users/me/teams") data = [team];
    else if (p.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (p === "/system/ping") data = { status: "OK" };
    else if (p.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: 3, mention_count: 3 }];
    else if (p.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0 }];
    else if (p.endsWith("/channels")) data = [channel];
    else if (p.includes("/channels/")) data = channel;
    else if (p.endsWith("/posts/search")) data = { order: posts.map(p => p.id), posts: Object.fromEntries(posts.map(p => [p.id, p])) };
    else if (p.includes("/threads")) data = { total: 0, total_unread_threads: 0, threads: [] };
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-review-actions-"));
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1500, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(({ origin, posts, userId }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light", "mattermostDeck.preferredRailWidth.v1": 900,
      "mattermostDeck.pollingIntervalSeconds.v1": 3600, "mattermostDeck.postClickAction.v1": "navigate",
      "mattermostDeck.layout.v1": [{ id: "normal", type: "mentions", unreadOnly: false }, { id: "review", type: "mentions", mentionReview: true }],
      ...Object.fromEntries(posts.map(post => [`mattermostDeck.mentionReview.v1:${encodeURIComponent(origin + "/")}:${encodeURIComponent(userId)}:post:*:${post.id}`, post])),
    }), { origin, posts, userId: user.id });
    const page = await context.newPage();
    await page.goto(`${origin}/testteam/channels/town-square`);
    const inspect = (focus = false) => worker.evaluate(async ({ origin, focus }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: focus => {
        const host = document.getElementById("mattermost-deck-root");
        if (!host) return null;
        const root = (chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot | null;
        if (!root) return null;
        const panes = ["normal", "review"].map(id => root.querySelector(`[data-pane-id="${id}"]`));
        const control = panes[1]?.querySelector<HTMLButtonElement>("[data-deck-review-confirm]");
        if (focus) control?.focus();
        const cards = panes.map(pane => {
          const card = pane?.querySelector<HTMLElement>(".deck-card--post"); const rect = card?.getBoundingClientRect();
          const body = card?.querySelector("p")?.getBoundingClientRect();
          return rect ? { height: rect.height, bodyOffset: body ? body.top - rect.top : null, bodyWidth: body?.width } : null;
        });
        const action = control?.getBoundingClientRect(); const card = panes[1]?.querySelector(".deck-card--post")?.getBoundingClientRect();
        return { cards, button: action ? { x: action.x + action.width / 2, y: action.y + action.height / 2 } : null,
          hover: card ? { x: card.x + 25, y: card.y + 35 } : null,
          opacity: control ? getComputedStyle(control.closest(".deck-mention-actions")!).opacity : null,
          inMeta: !!control?.closest(".deck-card-meta"), counts: panes.map(pane => pane?.querySelectorAll("[data-deck-post-id]").length ?? 0),
          virtual: !!panes[1]?.querySelector(".deck-virtual-list") };
      }, args: [focus] }); return result.result as any;
    }, { origin, focus });
    await expect.poll(async () => (await inspect())?.counts, { timeout: 30000 }).toEqual([3, 3]);
    for (const virtual of [false, true]) {
      await worker.evaluate(virtual => chrome.storage.local.set({ "mattermostDeck.virtualPostListExperiment.v1": virtual }), virtual);
      await expect.poll(async () => (await inspect())?.virtual).toBe(virtual);
      await page.mouse.move(10, 10);
      await page.waitForTimeout(300);
      const before = await inspect();
      expect(before.inMeta).toBe(false);
      expect(before.opacity).toBe("0");
      expect(before.cards[1]).toEqual(before.cards[0]);
      await page.mouse.move(before.hover.x, before.hover.y);
      await expect.poll(async () => (await inspect())?.opacity).toBe("1");
      expect((await inspect()).cards).toEqual(before.cards);
      await page.mouse.move(10, 10);
      const focused = await inspect(true);
      expect(focused.opacity).toBe("1");
      expect(focused.cards).toEqual(before.cards);
      await page.screenshot({ path: testInfo.outputPath(`review-actions-${virtual ? "virtuoso" : "legacy"}.png`) });
      await worker.evaluate(async origin => {
        const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
        await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: () => {
          const root = (chrome as any).dom.openOrClosedShadowRoot(document.getElementById("mattermost-deck-root"));
          root.activeElement?.blur();
        } });
      }, origin);
    }
    const target = await inspect();
    await page.mouse.move(target.hover.x, target.hover.y);
    await page.mouse.click(target.button.x, target.button.y);
    await expect.poll(async () => (await inspect())?.counts).toEqual([3, 2]);
    expect(page.url()).toBe(`${origin}/testteam/channels/town-square`);
  } finally {
    await context.close(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(profile, { recursive: true, force: true });
  }
});
