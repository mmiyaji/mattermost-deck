import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("mention headers retain counts and controls at narrow widths", async () => {
  const user = { id: "u".repeat(26), username: "reviewuser", notify_props: { mention_keys: "reviewuser", channel: "true" } };
  const author = { id: "a".repeat(26), username: "author", first_name: "Long Author Name", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const post = { id: "p".repeat(26), user_id: author.id, channel_id: channel.id, create_at: Date.now(), message: "@reviewuser Review fixture" };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><body class="app__body"><div id="root"><div id="SidebarContainer">Test workspace</div><main class="app__content"><h1 class="channel-header">Town Square</h1></main></div></body></html>');
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const p = url.pathname.replace("/api/v4", "");
    let data: unknown = [];
    if (p === "/system/ping") data = { status: "OK" };
    else if (p === "/users/me") data = user;
    else if (p === "/users/ids") data = [user, author];
    else if (p === "/users/me/teams") data = [team];
    else if (p.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: 1, mention_count: 1 }];
    else if (p.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (p.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: 1 }];
    else if (p.endsWith(`/members/${user.id}`)) data = { user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: 1 };
    else if (p.endsWith("/channels")) data = [channel];
    else if (p.includes("/channels/name/") || p === `/channels/${channel.id}`) data = channel;
    else if (p.endsWith("/posts/search") || p.endsWith("/posts")) data = { order: [post.id], posts: { [post.id]: post } };
    else if (p.includes("/threads")) data = { total: 0, threads: [] };
    res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-mention-header-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1600, height: 900 },
    args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
  });
  try {
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await sw.evaluate(({ origin }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light",
      "mattermostDeck.pollingIntervalSeconds.v1": 3600,
      "mattermostDeck.layout.v1": [
        { id: "mentions", type: "mentions", width: 280, customTitle: "A deliberately long mention pane title" },
        { id: "review", type: "mentions", mentionReview: true, width: 320, customTitle: "A deliberately long review pane title" },
      ],
    }), { origin });
    const page = await context.newPage();
    await page.goto(`${origin}/testteam/channels/town-square`);
    const inspect = (selector: string, action = "read") => sw.evaluate(async ({ origin, selector, action }) => {
      const tab = (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin));
      if (!tab?.id) return null;
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selector, action) => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
        const el = root?.querySelector(selector) as HTMLElement | null;
        if (el && action === "open") (el as HTMLDetailsElement).open = true;
        if (el && action === "click") el.click();
        if (el && action === "hover") el.closest(".deck-column")?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, composed: true }));
        if (el && action === "focus") el.focus();
        const rect = el?.getBoundingClientRect();
        return el ? { text: el.textContent?.trim(), aria: el.getAttribute("aria-label"), open: (el as HTMLDetailsElement).open,
          left: rect!.left, top: rect!.top, right: rect!.right, bottom: rect!.bottom, height: rect!.height, width: rect!.width,
          visible: el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
          style: getComputedStyle(el).opacity } : null;
      }, args: [selector, action] });
      return result.result;
    }, { origin, selector, action });
    const clickAt = async (selector: string) => {
      const target = await inspect(selector);
      if (!target || target.width <= 0 || target.height <= 0) throw new Error(`Expected visible control: ${selector}`);
      await page.mouse.click(target.left + target.width / 2, target.top + target.height / 2);
    };
    const pane = '[data-deck-column-id="mentions"]';
    const review = '[data-deck-column-id="review"]';
    await expect.poll(() => inspect(`${pane} .deck-card--post`)).not.toBeNull();
    await expect.poll(async () => (await inspect(`${review} .deck-badge`))?.aria).toBe("Pending: 1");
    const header = await inspect(`${pane} .deck-column-header`);
    const badge = await inspect(`${pane} .deck-badge`);
    const actions = await inspect(`${pane} .deck-column-actions`);
    expect(badge?.aria).toContain("unread mention");
    expect(badge!.right).toBeLessThanOrEqual(actions!.left);
    const postBefore = await inspect(`${pane} .deck-card--post`);
    const authorBefore = await inspect(`${pane} .deck-card-author`);
    await page.mouse.move(header!.left + 8, header!.top + 8);
    await expect.poll(async () => (await inspect(`${pane} .deck-column-actions`))?.style).toBe("1");
    const postAfter = await inspect(`${pane} .deck-card--post`);
    expect(postAfter!.top).toBe(postBefore!.top);
    expect(postAfter!.height).toBe(postBefore!.height);
    const authorAfter = await inspect(`${pane} .deck-card-author`);
    expect(authorAfter!.left).toBe(authorBefore!.left);
    expect(authorAfter!.right).toBe(authorBefore!.right);
    expect(await inspect(`${pane} .deck-column-actions button`)).not.toBeNull();
    await inspect(`${pane} .deck-column-actions button`, "focus");
    await expect.poll(async () => (await inspect(`${pane} .deck-column-actions`))?.style).toBe("1");
    await expect.poll(async () => (await inspect(`${pane} .deck-badge`))?.aria).toContain("unread mention");

    const controls = `${pane} .deck-column-header .deck-column-actions button[aria-expanded]:not(.deck-pane-search-toggle)`;
    await clickAt(controls);
    const exclusion = await inspect(`${pane} [data-deck-exclusion-controls]`);
    const tabGroup = await inspect(`${pane} .deck-review-mode-disclosure`);
    const about = await inspect(`${pane} .deck-mention-scope-disclosure`);
    const reviewToggle = `${review} .deck-column-header .deck-column-actions button[aria-expanded]:not(.deck-pane-search-toggle)`;
    const reviewHeader = await inspect(`${review} .deck-column-header`);
    await page.mouse.move(reviewHeader!.left + 8, reviewHeader!.top + 8);
    await clickAt(reviewToggle);
    const reviewGroup = await inspect(`${review} .deck-review-mode-disclosure`);
    expect(exclusion?.open).toBe(false);
    expect(tabGroup?.open).toBe(false);
    expect(about?.open).toBe(false);
    expect(reviewGroup?.open).toBe(false);
    await clickAt(`${pane} [data-deck-exclusion-controls] > summary`);
    expect((await inspect(`${pane} [data-deck-exclusion-user-search]`))?.visible).toBe(true);
    await clickAt(`${review} .deck-review-mode-disclosure > summary`);
    expect((await inspect(`${review} [data-deck-review-history]`))?.visible).toBe(true);
    expect((await inspect(`${review} [data-deck-exit-review]`))?.visible).toBe(true);
    const posts = await inspect(`${pane} .deck-post-list`);
    expect(posts!.height).toBeGreaterThan(100);
    expect((await inspect(`${review} .deck-post-list`))!.height).toBeGreaterThan(100);
    expect(badge!.right).toBeLessThanOrEqual(actions!.left);
    expect((await inspect(`${review} .deck-badge`))!.right).toBeLessThanOrEqual((await inspect(`${review} .deck-column-actions`))!.left);
    expect(header!.height).toBeGreaterThan(0);
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(profile, { recursive: true, force: true });
  }
});
