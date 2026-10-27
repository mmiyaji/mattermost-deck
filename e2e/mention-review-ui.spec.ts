import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("review mentions share collection, persist confirmation and survive source removal", async ({}, testInfo) => {
  const user = { id: "u".repeat(26), username: "reviewuser", notify_props: { mention_keys: "reviewuser", channel: "true" } };
  const author = { id: "a".repeat(26), username: "author", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const post = { id: "p".repeat(26), user_id: author.id, channel_id: channel.id, create_at: Date.now(), message: "@reviewuser Review fixture" };
  let posts = [post];
  let searchRequests = 0;
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><body class="app__body"><div id="root"><div id="SidebarContainer">Test workspace</div><main class="app__content"><h1 class="channel-header">Town Square</h1></main></div></body></html>');
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const p = url.pathname.replace("/api/v4", "");
    requests.push(p);
    let data: unknown = [];
    if (p === "/system/ping") data = { status: "OK" };
    else if (p === "/users/me") data = user;
    else if (p === "/users/ids") data = [user, author];
    else if (p === "/users/me/teams") data = [team];
    else if (p.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: posts.length, mention_count: posts.length }];
    else if (p.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (p.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: posts.length }];
    else if (p.endsWith("/channels")) data = [channel];
    else if (p.includes("/channels/name/") || p === `/channels/${channel.id}`) data = channel;
    else if (p.endsWith("/posts/search")) { searchRequests++; data = { order: posts.map(x => x.id), posts: Object.fromEntries(posts.map(x => [x.id, x])) }; }
    else if (p.endsWith("/posts")) data = { order: posts.map(x => x.id), posts: Object.fromEntries(posts.map(x => [x.id, x])) };
    else if (p.endsWith(`/members/${user.id}`)) data = { user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: posts.length };
    else if (p.includes("/threads")) data = { total: 0, threads: [] };
    else if (p.endsWith("/unread")) data = { team_id: team.id, msg_count: posts.length, mention_count: posts.length };
    res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-mention-review-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1600, height: 900 },
    args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
  });
  try {
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await sw.evaluate(({ origin }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light",
      "mattermostDeck.pollingIntervalSeconds.v1": 3600,
      "mattermostDeck.layout.v1": [{ id: "mentions", type: "mentions" }],
    }), { origin });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`${origin}/testteam/channels/town-square`);
    const inspect = (selector: string, click = false) => sw.evaluate(async ({ origin, selector, click }) => {
      const tab = (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin));
      if (!tab?.id) return null;
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selector, click) => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
        const el = root?.querySelector(selector) as HTMLElement | null;
        if (click) { el?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true })); el?.focus(); el?.click(); }
        const rect = el?.getBoundingClientRect();
        return el ? { text: el.textContent, expanded: el.getAttribute("aria-expanded"), count: root!.querySelectorAll(selector).length,
          left: rect!.left, top: rect!.top, right: rect!.right,
          order: [...root!.querySelectorAll(".deck-pane-frame")].map((pane: Element) => (pane as HTMLElement).dataset.paneId) } : null;
      }, args: [selector, click] });
      return result.result;
    }, { origin, selector, click });
    const source = '[data-deck-column-id="mentions"]';
    const review = '[data-deck-mention-review="true"]';
    const toggle = `${source} .deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)`;
    const controlsToggle = (pane: string) => `${pane} .deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)`;
    const openControls = async (pane: string) => {
      const selector = controlsToggle(pane);
      if ((await inspect(selector))?.expanded !== "true") await inspect(selector, true);
    };
    const toggleHistory = async (pane: string) => {
      await openControls(pane);
      await inspect(`${pane} [data-deck-review-history]`, true);
    };
    await expect.poll(async () => (await inspect(`${source} .deck-card--post`))?.text, { timeout: 15_000, message: "Initial mention collection" }).toContain("Review fixture").catch(async error => {
      console.log("Review fixture diagnostic", await inspect(".deck-shell"), await inspect(source), searchRequests, requests);
      throw error;
    });
    await inspect(toggle, true);
    const baseline = searchRequests;
    await inspect(`${source} [data-deck-review-info="duplicate"]`, true);
    await expect.poll(async () => (await inspect(`${source} [data-deck-review-help]`))?.text).toContain("original");
    await page.screenshot({ path: testInfo.outputPath("mention-review-info.png"), fullPage: true });
    await inspect(`${source} [data-deck-review-info="duplicate"]`, true);
    await expect.poll(() => inspect(`${source} [data-deck-review-help]`)).toBeNull();
    await inspect(`${source} [data-deck-review-info="duplicate"]`, true);
    await page.keyboard.press("Escape");
    await expect.poll(() => inspect(`${source} [data-deck-review-help]`)).toBeNull();
    await inspect(`${source} [data-deck-review-info="convert"]`, true);
    await expect.poll(async () => (await inspect(`${source} [data-deck-review-help]`))?.text).toContain("current");
    await inspect(`${source} .deck-column-heading`, true);
    await expect.poll(() => inspect(`${source} [data-deck-review-help]`)).toBeNull();
    await inspect(`${source} [data-deck-convert-review]`, true);
    await expect.poll(() => inspect(`${source}[data-deck-mention-review="true"]`)).not.toBeNull();
    expect((await inspect(review))?.count).toBe(1);
    expect(searchRequests).toBe(baseline);
    await expect.poll(async () => (await inspect(`${source} .deck-card--post`))?.text).toContain("Review fixture");
    if ((await inspect(toggle))?.expanded === "true") await inspect(toggle, true);
    expect(await inspect(`${source} .deck-review-note`)).toBeNull();
    expect(await inspect(`${source} [data-deck-review-history]`)).toBeNull();
    await page.screenshot({ path: testInfo.outputPath("mention-review-collapsed.png"), fullPage: true });
    await inspect(`${source} [data-deck-review-confirm="${post.id}"]`, true);
    await expect.poll(() => inspect(`${source} .deck-card--post`)).toBeNull();
    await inspect(toggle, true);
    expect(await inspect(`${source} .deck-review-note`)).not.toBeNull();
    expect(await inspect(`${source} [data-deck-review-history]`)).not.toBeNull();
    await inspect(`${source} [data-deck-exit-review]`, true);
    await expect.poll(() => inspect(review)).toBeNull();
    expect((await inspect(`${source} .deck-card--post`))?.text).toContain("Review fixture");
    if ((await inspect(toggle))?.expanded !== "true") await inspect(toggle, true);
    await inspect(`${source} [data-deck-convert-review]`, true);
    await expect.poll(() => inspect(`${source}[data-deck-mention-review="true"]`)).not.toBeNull();
    await toggleHistory(source);
    await expect.poll(async () => (await inspect(`${source} .deck-card--post`))?.text).toContain("Review fixture");
    await inspect(`${source} [data-deck-review-restore="${post.id}"]`, true);
    if ((await inspect(toggle))?.expanded !== "true") await inspect(toggle, true);
    await inspect(`${source} [data-deck-exit-review]`, true);
    if ((await inspect(toggle))?.expanded !== "true") await inspect(toggle, true);
    await inspect(`${source} [data-deck-create-review]`, true);
    await expect.poll(async () => (await inspect(`${review} .deck-card--post`))?.text).toContain("Review fixture");
    expect(searchRequests).toBe(baseline);
    await inspect(`${source} [data-deck-create-review]`, true);
    await expect.poll(async () => (await inspect(`${review} .deck-card--post`))?.count).toBe(2);
    expect(searchRequests).toBe(baseline);
    await expect.poll(() => inspect('.deck-pane-frame[style*="translate"]')).toBeNull();
    const beforeDrag = (await inspect(source))!.order;
    const fromTitle = (await inspect(`${source} .deck-column-heading h2`))!;
    const targetPane = (await inspect(review))!;
    const requestsBeforeDrag = searchRequests;
    await page.mouse.move(fromTitle.left + 35, fromTitle.top + 8);
    await page.mouse.down();
    await page.mouse.move(targetPane.right - 30, targetPane.top + 30, { steps: 12 });
    await expect.poll(() => inspect(".deck-drag-ghost")).not.toBeNull();
    await page.mouse.up();
    await expect.poll(async () => (await inspect(source))!.order).not.toEqual(beforeDrag);
    // Give any unintended polling restart time to issue its first request.
    await page.waitForTimeout(500);
    expect(searchRequests).toBe(requestsBeforeDrag);
    expect((await inspect(`${source} .deck-card--post`))?.text).toContain("Review fixture");
    const routeBefore = page.url();
    await inspect(`${review} [data-deck-review-confirm="${post.id}"]`, true);
    await expect.poll(() => inspect(`${review} .deck-card--post`)).toBeNull();
    expect(page.url()).toBe(routeBefore);
    expect((await inspect(`${source} .deck-card--post`))?.text).toContain("Review fixture");
    expect((await inspect(`${review} .deck-review-feedback`))?.text).toContain("Marked as confirmed");
    await inspect(`${review} [data-deck-review-undo]`, true);
    await expect.poll(async () => (await inspect(`${review} .deck-card--post`))?.text).toContain("Review fixture");
    expect(await inspect(`${review} .deck-review-feedback`)).toBeNull();
    await inspect(`${review} [data-deck-review-confirm="${post.id}"]`, true);
    await expect.poll(() => inspect(`${review} .deck-card--post`)).toBeNull();
    await expect.poll(() => inspect(`${review} [data-deck-review-undo]`)).not.toBeNull();
    await page.screenshot({ path: testInfo.outputPath("mention-review-undo.png"), fullPage: true });
    await expect.poll(() => inspect(`${review} .deck-review-feedback`), { timeout: 8_000 }).toBeNull();
    expect(await inspect(`${review} .deck-card--post`)).toBeNull();
    // Neither queue retention nor confirmation depends on search/cache results.
    posts = [];
    await page.reload();
    await expect.poll(() => inspect(review)).not.toBeNull();
    expect(await inspect(`${review} [data-deck-review-history]`)).toBeNull();
    await toggleHistory(review);
    await expect.poll(async () => (await inspect(`${review} .deck-card--post`))?.text).toContain("Review fixture");
    await inspect(`${review} [data-deck-review-restore="${post.id}"]`, true);
    await toggleHistory(review);
    await expect.poll(async () => (await inspect(`${review} .deck-card--post`))?.text).toContain("Review fixture");
    await openControls(source);
    await inspect(`${source} button[title="Remove pane"]`, true);
    // The elected collection owner can disappear while the review pane remains.
    await expect.poll(() => inspect(source)).toBeNull();
    posts = [{ ...post, id: "q".repeat(26), message: "@all New mention after source removal", create_at: Date.now() + 1 }, post];
    await openControls(review);
    await inspect(`${review} button[title="Refresh"]`, true);
    await expect.poll(async () => (await inspect(review))?.text).toContain("New mention after source removal");
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("mention-review.png"), fullPage: true });
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(profile, { recursive: true, force: true });
  }
});
