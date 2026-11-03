import { test, expect, chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("websocket edits and deletions reconcile shared mentions, review history and persistent cache", async () => {
  const user = { id: "u".repeat(26), username: "realtimeuser", notify_props: { mention_keys: "realtimeuser", channel: "true" } };
  const author = { id: "a".repeat(26), username: "author" };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const original = { id: "p".repeat(26), user_id: author.id, channel_id: channel.id, create_at: Date.now(), update_at: Date.now(), message: "@realtimeuser Original realtime mention" };
  let posts = [original];
  let searches = 0;
  let holdSearch = false;
  let releaseSearch: (() => void) | undefined;
  const server = createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://localhost").pathname.replace("/api/v4", "");
    if (!req.url?.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><body class="app__body"><div id="root"><div id="SidebarContainer">Workspace</div><main class="app__content"><h1 class="channel-header">Town Square</h1></main></div></body></html>');
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const list = { order: posts.map(post => post.id), posts: Object.fromEntries(posts.map(post => [post.id, post])) };
    let data: unknown = [];
    if (p === "/users/me") data = user;
    else if (p === "/users/ids") data = [user, author];
    else if (p === "/users/me/teams") data = [team];
    else if (p.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: posts.length, mention_count: posts.length }];
    else if (p.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (p.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: posts.length }];
    else if (p.endsWith("/channels")) data = [channel];
    else if (p.includes("/channels/name/") || p === `/channels/${channel.id}`) data = channel;
    else if (p.endsWith("/posts/search")) {
      searches++;
      if (holdSearch) {
        releaseSearch = () => res.end(JSON.stringify(list));
        return;
      }
      data = list;
    }
    else if (p.endsWith("/posts")) data = list;
    else if (p.startsWith("/posts/")) {
      const post = posts.find(post => p === `/posts/${post.id}`);
      if (post) data = post;
      else { res.statusCode = 404; data = { id: "api.post.get.app_error", message: "Post not found" }; }
    }
    else if (p.endsWith(`/members/${user.id}`)) data = { user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: posts.length };
    else if (p.includes("/threads")) data = { total: 0, threads: [] };
    else if (p.endsWith("/unread")) data = { team_id: team.id, msg_count: posts.length, mention_count: posts.length };
    res.end(JSON.stringify(data));
  });
  // Extension isolated-world sockets bypass Playwright routeWebSocket interception.
  // Reuse Playwright's bundled ws implementation without adding a package.
  const { wsServer: WebSocketServer } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle");
  const websocketServer = new WebSocketServer({ server, path: "/api/v4/websocket" });
  let socket: { send(data: string): void } | undefined;
  let authenticated = false;
  websocketServer.on("connection", (ws: any) => {
    socket = ws;
    ws.on("message", (raw: Buffer) => {
      const message = JSON.parse(String(raw));
      ws.send(JSON.stringify({ status: "OK", seq_reply: message.seq }));
      if (message.action === "authentication_challenge") {
        ws.send(JSON.stringify({ event: "hello", broadcast: { user_id: user.id } }));
        authenticated = true;
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-mention-realtime-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1600, height: 900 },
    args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
  });
  try {
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await waitForInstalledOptions(context, sw);
    await sw.evaluate(({ origin }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en",
      "mattermostDeck.wsPat.v1": "fixture-pat", "mattermostDeck.persistPat.v1": "true",
      "mattermostDeck.pollingIntervalSeconds.v1": 300,
      "mattermostDeck.layout.v1": [{ id: "mentions", type: "mentions" }],
    }), { origin });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const inspect = (selector: string, click = false) => sw.evaluate(async ({ origin, selector, click }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      if (!tab?.id) return null;
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selector, click) => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
        const element = root?.querySelector(selector) as HTMLElement | null;
        if (click) element?.click();
        return element ? { text: element.textContent, expanded: element.getAttribute("aria-expanded") } : null;
      }, args: [selector, click] });
      return result.result;
    }, { origin, selector, click });
    const normal = '[data-deck-column-id="mentions"]';
    const review = '[data-deck-mention-review="true"]';
    const controls = async (pane: string) => {
      const toggle = `${pane} .deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)`;
      if ((await inspect(toggle))?.expanded !== "true") await inspect(toggle, true);
    };
    const cache = () => sw.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("mattermostDeck.mentionCache");
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<any[]>((resolve, reject) => {
          const request = db.transaction("snapshots").objectStore("snapshots").getAll();
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    });
    await page.goto(`${origin}/testteam/channels/town-square`);
    await expect.poll(async () => (await inspect(`${normal} .deck-card--post`))?.text, { timeout: 15_000 }).toContain("Original realtime mention");
    await expect.poll(() => authenticated, { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => JSON.stringify(await cache())).toContain(original.id);
    await controls(normal);
    await inspect(`${normal} [data-deck-create-review]`, true);
    await expect.poll(async () => (await inspect(`${review} .deck-card--post`))?.text).toContain("Original realtime mention");
    await inspect(`${review} [data-deck-review-confirm="${original.id}"]`, true);
    await expect.poll(() => inspect(`${review} .deck-card--post`)).toBeNull();
    const baselineSearches = searches;
    const edited = { ...original, message: "@realtimeuser Edited realtime mention", update_at: original.update_at + 10, edit_at: original.update_at + 10 };
    posts = [edited];
    socket!.send(JSON.stringify({ event: "post_edited", data: { post: JSON.stringify(edited) }, broadcast: { channel_id: channel.id } }));
    await expect.poll(async () => (await inspect(`${normal} .deck-card--post`))?.text).toContain("Edited realtime mention");
    // Confirmation belongs to the post ID and must survive a content edit.
    expect(await inspect(`${review} .deck-card--post`)).toBeNull();
    await controls(review);
    await inspect(`${review} [data-deck-review-history]`, true);
    await expect.poll(async () => (await inspect(`${review} .deck-card--post`))?.text).toContain("Edited realtime mention");
    expect(await inspect(`${review} [data-deck-review-restore="${original.id}"]`)).not.toBeNull();
    expect(searches).toBe(baselineSearches);
    // A poll that began before deletion may still contain the old post.
    // Its delayed completion must not resurrect the websocket tombstone.
    holdSearch = true;
    await controls(normal);
    await inspect(`${normal} button[title="Refresh"]`, true);
    await expect.poll(() => Boolean(releaseSearch)).toBe(true);
    posts = [];
    socket!.send(JSON.stringify({ event: "post_deleted", data: { post: JSON.stringify({ ...edited, delete_at: Date.now() }) }, broadcast: { channel_id: channel.id } }));
    await expect.poll(() => inspect(`${normal} .deck-card--post`)).toBeNull();
    await expect.poll(() => inspect(`${review} .deck-card--post`)).toBeNull();
    await expect.poll(async () => JSON.stringify(await cache())).not.toContain(original.id);
    holdSearch = false;
    releaseSearch!();
    releaseSearch = undefined;
    await expect.poll(() => inspect(`${normal} .deck-column-loading-status`)).toBeNull();
    await expect.poll(async () => (await inspect(normal))?.text).not.toContain("Edited realtime mention");
    await controls(normal);
    await inspect(`${normal} button[title="Refresh"]`, true);
    await expect.poll(() => searches).toBeGreaterThan(baselineSearches);
    expect(await inspect(`${normal} .deck-card--post`)).toBeNull();
    expect(await inspect(`${review} .deck-card--post`)).toBeNull();
    await page.reload();
    await expect.poll(() => inspect(review)).not.toBeNull();
    await controls(review);
    await inspect(`${review} [data-deck-review-history]`, true);
    await expect.poll(() => inspect(`${review} .deck-card--post`)).toBeNull();
    expect(await inspect(`${normal} .deck-card--post`)).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    releaseSearch?.();
    await context.close();
    websocketServer.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(profile, { recursive: true, force: true });
  }
});
