import { test, expect, chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

for (const phase of ["ready", "initial loading", "refreshing", "reconnecting"] as const) {
test(`opening a reply during ${phase} preserves every mention pane`, async () => {
  const user = { id: "u".repeat(26), username: "reviewuser", notify_props: { mention_keys: "reviewuser", channel: "true" } };
  const author = { id: "a".repeat(26), username: "author", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const post = { root_id: "z".repeat(26), id: "p".repeat(26), user_id: author.id, channel_id: channel.id, create_at: Date.now(), message: "@reviewuser Review fixture" };
  const posts = [post];
  let searchRequests = 0;
  let connections = 0;
  let disconnect: (() => void) | undefined;
  const sockets = new Set<Duplex>();
  const requests: string[] = [];
  let holdSearch = phase === "initial loading";
  let releaseSearch: (() => void) | undefined;
  const searchGate = new Promise<void>(resolve => { releaseSearch = resolve; });
  const server = createServer(async (req, res) => {
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
    else if (p.endsWith("/posts/search")) { searchRequests++; if (holdSearch) await searchGate; data = { order: posts.map(x => x.id), posts: Object.fromEntries(posts.map(x => [x.id, x])) }; }
    else if (p.endsWith("/posts")) data = { order: posts.map(x => x.id), posts: Object.fromEntries(posts.map(x => [x.id, x])) };
    else if (p.endsWith(`/members/${user.id}`)) data = { user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: posts.length };
    else if (p.includes("/threads")) data = { total: 0, threads: [] };
    else if (p.endsWith("/unread")) data = { team_id: team.id, msg_count: posts.length, mention_count: posts.length };
    res.end(JSON.stringify(data));
  });
  // A real local transport also reaches sockets created in extension isolated worlds.
  server.on('upgrade', (request, socket) => {
    connections++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    disconnect = () => socket.destroy();
    const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const hello = Buffer.from(JSON.stringify({ event: 'hello', broadcast: { user_id: user.id } }));
    socket.write(Buffer.concat([Buffer.from([0x81, hello.length]), hello]));
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
    await sw.evaluate(({ origin, post, userId, phase }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light",
      "mattermostDeck.pollingIntervalSeconds.v1": 3600,
      "mattermostDeck.allowedRouteKinds.v1": "channels",
      "mattermostDeck.postClickAction.v1": "navigate",
      "mattermostDeck.wsPat.v1": phase === "reconnecting" ? "fixture-token" : "",
      "mattermostDeck.persistPat.v1": "true",
      [`mattermostDeck.mentionReview.v1:${encodeURIComponent(origin + "/")}:${encodeURIComponent(userId)}:post:*:${post.id}`]: post,
      "mattermostDeck.layout.v1": [{ id: "mentions", type: "mentions" }, { id: "review", type: "mentions", mentionReview: true }],
    }), { origin, post, userId: user.id, phase });
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
    const source = phase === 'initial loading' ? '[data-deck-column-id="review"]' : '[data-deck-column-id="mentions"]';
    await expect.poll(async () => (await inspect(`${source} .deck-card--post`))?.text, { timeout: 15_000, message: "Initial mention collection" }).toContain("Review fixture").catch(async error => {
      console.log("Review fixture diagnostic", await inspect(".deck-shell"), await inspect(source), searchRequests, requests);
      throw error;
    });

    if (phase === 'reconnecting') {
      await expect.poll(() => connections).toBe(1);
      await expect.poll(() => inspect('[data-deck-column-id="mentions"] [role="progressbar"]')).toBeNull();
      holdSearch = true;
      disconnect!();
      await expect.poll(() => connections, { timeout: 15000 }).toBe(2);
    }
    if (phase === 'refreshing') {
      await expect.poll(() => inspect('[data-deck-column-id="mentions"] [role="progressbar"]')).toBeNull();
      holdSearch = true;
      await inspect('[data-deck-column-id="mentions"] .deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)', true);
      await inspect('[data-deck-column-id="mentions"] button[title="Refresh"]', true);
    }
    if (phase !== 'ready') {
      // A reconnect and a manual refresh each reconcile the feed on their own
      // debounce, and a held search can be followed by another before the first
      // responds. Wait for the count to settle rather than expecting an exact
      // number: the window measured below only has to start from a quiet count.
      await expect.poll(async () => {
        const seen = searchRequests;
        await new Promise(resolve => setTimeout(resolve, 500));
        return seen > 0 && searchRequests === seen;
      }, { timeout: 30_000, message: "Feed reconciliation settles" }).toBe(true);
      await expect.poll(() => inspect('[data-deck-column-id="mentions"] [role="progressbar"]')).not.toBeNull();
    } else {
      await expect.poll(() => inspect(`${source} [role="progressbar"]`)).toBeNull();
    }
    const feedRequests = () => requests.filter(p => p === "/users/me" || p.includes("/posts/search") || p.includes("/threads"));
    const baseline = searchRequests;
    const baselineFeedRequests = feedRequests();
    const baselineAccountRequests = requests.filter(p => p === "/users/me" || p === "/users/me/teams");
    await page.evaluate(() => { document.getElementById("mattermost-deck-root")!.dataset.navigationMarker = "preserved"; });
    // A native permalink can stay visible while Mattermost resolves its channel.
    await inspect(source + ' .deck-card--post', true);
    await expect(page).toHaveURL(new RegExp('/testteam/pl/' + post.id));
    await page.waitForTimeout(1000); // Exceed the content runtime's 500ms route cleanup grace.
    await page.evaluate(postId => {
      window.history.pushState({}, '', '/testteam/channels/town-square/' + postId);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, post.id);
    await expect.poll(async () => page.locator('#mattermost-deck-root').getAttribute('data-navigation-marker')).toBe('preserved');
    await expect.poll(async () => (await inspect(source + ' .deck-card--post'))?.text).toContain('Review fixture');
    await expect.poll(async () => (await inspect('[data-deck-column-id="review"] .deck-card--post'))?.text).toContain('Review fixture');
    // Measured with the feed request still held, so only the click and the
    // navigation can have added one. Releasing the gate first would let the
    // reconnect's own reconciliation finish and schedule more work inside the
    // window, which says nothing about whether the click refetched the feed.
    expect(searchRequests).toBe(baseline);
    if (phase === "ready") expect(feedRequests()).toEqual(baselineFeedRequests);
    if (phase !== 'reconnecting') {
      expect(requests.filter(p => p === "/users/me" || p === "/users/me/teams")).toEqual(baselineAccountRequests);
    } else {
      expect(connections).toBe(2);
    }
    holdSearch = false; releaseSearch!();
    expect(pageErrors).toEqual([]);
  } finally {
    releaseSearch!();
    await context.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const relative = path.relative(os.tmpdir(), profile);
    if (relative.startsWith('deck-mention-review-') && !relative.includes(path.sep)) await fs.rm(profile, { recursive: true, force: true });
  }
});

}
