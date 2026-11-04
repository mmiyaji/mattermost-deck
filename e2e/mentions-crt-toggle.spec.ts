import { test, expect, chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("turning CRT off immediately ignores retained realtime thread markers", async () => {
  const user = { id: "u".repeat(26), username: "crtuser", notify_props: { mention_keys: "crtuser", comments: "any" } };
  const author = { id: "a".repeat(26), username: "author" };
  const team = { id: "t".repeat(26), name: "crtteam", display_name: "CRT team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const root = { id: "r".repeat(26), user_id: author.id, channel_id: channel.id, create_at: 100, update_at: 100, message: "Thread root", reply_count: 1 };
  const reply = { id: "p".repeat(26), user_id: author.id, channel_id: channel.id, root_id: root.id, create_at: 300, update_at: 300, message: "@crtuser unread reply" };
  let crtOn = true;
  let holdSearch = false;
  let releaseSearch: (() => void) | undefined;
  let searches = 0;
  let preferenceReads = 0;
  const posts = [reply];
  const thread = { id: root.id, reply_count: 1, last_reply_at: 300, last_viewed_at: 200, unread_replies: 1, unread_mentions: 1, post: root };
  const list = { order: posts.map(post => post.id), posts: Object.fromEntries(posts.map(post => [post.id, post])) };
  const server = createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://localhost").pathname.replace("/api/v4", "");
    if (!req.url?.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><body class="app__body"><div id="root"><div id="SidebarContainer">Workspace</div><main class="app__content"><h1 class="channel-header">Town Square</h1></main></div></body></html>');
      return;
    }
    res.setHeader("Content-Type", "application/json");
    let data: unknown = [];
    if (p === "/users/me") data = user;
    else if (p === "/users/ids") data = [user, author];
    else if (p === "/users/me/teams") data = [team];
    else if (p.endsWith("/preferences")) { preferenceReads++; data = [{ user_id: user.id, category: "display_settings", name: "collapsed_reply_threads", value: crtOn ? "on" : "off" }]; }
    else if (p.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: 1, mention_count: 1, mention_count_root: 0, thread_count: 1, thread_mention_count: 1 }];
    else if (p.startsWith("/config/client")) data = { CollapsedThreads: "default_on" };
    else if (p.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 500, mention_count: 1 }];
    else if (p.endsWith("/channels")) data = [channel];
    else if (p.includes("/channels/name/") || p === `/channels/${channel.id}`) data = channel;
    else if (p.endsWith("/threads")) data = { total: 1, threads: [thread] };
    else if (p.endsWith("/posts/search")) {
      searches++;
      if (holdSearch) { releaseSearch = () => res.end(JSON.stringify(list)); return; }
      data = list;
    }
    else if (p.endsWith("/members/me")) data = { user_id: user.id, channel_id: channel.id, last_viewed_at: 500, mention_count: 1 };
    else if (p.endsWith("/members/" + user.id)) data = { user_id: user.id, channel_id: channel.id, last_viewed_at: 500, mention_count: 1 };
    else if (p.includes("/posts/") && p.endsWith("/thread")) data = list;
    else if (p.endsWith("/posts")) data = list;
    else if (p.endsWith("/unread")) data = { team_id: team.id, msg_count: 1, mention_count: 1 };
    res.end(JSON.stringify(data));
  });
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
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-mentions-crt-toggle-"));
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
      "mattermostDeck.layout.v1": [{ id: "mentions", type: "mentions", unreadOnly: true }],
    }), { origin });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("mattermostDeck.debugLogs", "1"));
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const inspect = (selector: string) => sw.evaluate(async ({ origin, selector }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      if (!tab?.id) return null;
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selector => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
        return root?.querySelector(selector)?.textContent ?? null;
      }, args: [selector] });
      return result.result;
    }, { origin, selector });
    const clickInShadow = (selector: string) => sw.evaluate(async ({ origin, selector }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      if (!tab?.id) return false;
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selector => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
        const element = root?.querySelector(selector) as HTMLElement | null;
        element?.click();
        return Boolean(element);
      }, args: [selector] });
      return result.result;
    }, { origin, selector });
    const debugColumn = () => page.evaluate(() => new Promise<{
      threadLastViewedAt?: Record<string, number>;
      mentionCount?: number;
      visiblePostIds?: string[];
    } | null>((resolve) => {
      const id = `crt-toggle-${Math.random().toString(36).slice(2)}`;
      const handler = (event: Event) => {
        const detail = (event as CustomEvent<{ id?: string; result?: unknown }>).detail;
        if (detail?.id !== id) return;
        window.removeEventListener("mattermost-deck-debug-response", handler as EventListener);
        resolve(detail.result as { threadLastViewedAt?: Record<string, number>; mentionCount?: number; visiblePostIds?: string[] } | null);
      };
      window.addEventListener("mattermost-deck-debug-response", handler as EventListener);
      window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", { detail: { id, action: "getColumnState", payload: { id: "mentions" } } }));
    }));
    await page.goto(`${origin}/crtteam/channels/town-square`);
    const card = '[data-deck-column-id="mentions"] .deck-card--post';
    await expect.poll(() => authenticated).toBe(true);
    await expect.poll(() => inspect(card), { timeout: 15_000 }).toContain("unread reply");
    await expect.poll(() => searches).toBeGreaterThan(0);
    const baselineSearches = searches;
    const baselinePreferenceReads = preferenceReads;
    const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);

    socket!.send(JSON.stringify({ event: "thread_read_changed", data: { thread_id: root.id, last_viewed_at: 250 }, broadcast: { user_id: user.id } }));
    await expect.poll(() => inspect(card), { timeout: 10_000 }).toContain("unread reply");
    await expect.poll(async () => (await debugColumn())?.threadLastViewedAt?.[root.id]).toBe(250);
    const headerToggle = '[data-deck-column-id="mentions"] .deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)';
    if (await inspect(headerToggle) !== "true") await clickInShadow(headerToggle);
    holdSearch = true;
    await clickInShadow('[data-deck-column-id="mentions"] button[title="Refresh"]');
    await expect.poll(() => Boolean(releaseSearch), { timeout: 10_000 }).toBe(true);
    crtOn = false;
    socket!.send(JSON.stringify({
      event: "preferences_changed",
      data: { preferences: JSON.stringify([{ user_id: user.id, category: "display_settings", name: "collapsed_reply_threads", value: "off" }]) },
      broadcast: { user_id: user.id },
    }));
    await expect.poll(() => inspect(card), { timeout: 10_000 }).toBeNull();
    await expect.poll(async () => (await debugColumn())?.threadLastViewedAt).toEqual({});
    await expect.poll(async () => (await debugColumn())?.mentionCount).toBe(0);
    await expect.poll(() => inspect('[data-deck-column-id="mentions"]'), { timeout: 10_000 }).not.toBeNull();
    await expect.poll(() => preferenceReads).toBeGreaterThan(baselinePreferenceReads);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentTimeOrigin);
    expect(searches).toBeGreaterThanOrEqual(baselineSearches);
    expect(errors).toEqual([]);
  } finally {
    releaseSearch?.();
    await context.close();
    websocketServer.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(profile, { recursive: true, force: true });
  }
});
