import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("permission clear rejects an in-flight reused mention scan and forces a fresh search", async () => {
  test.setTimeout(90_000);
  const user = { id: "u".repeat(26), username: "tester", notify_props: { mention_keys: "tester", channel: "true" } };
  const author = { id: "a".repeat(26), username: "author" };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), team_id: team.id, name: "town-square", display_name: "Town Square", type: "O" };
  const post = { id: "p".repeat(26), channel_id: channel.id, user_id: author.id, create_at: Date.now(), message: "@tester Private pre-clear body" };
  let holdLookup = false, denySearch = false, searches = 0;
  let releaseLookup: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    if (!req.url?.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><body class="app__body"><main id="root" class="app__content">Privacy fixture</main></body></html>');
      return;
    }
    const route = new URL(req.url, "http://localhost").pathname.replace("/api/v4", "");
    let data: unknown = [];
    if (route === "/users/me") data = user;
    else if (route === "/users/ids") data = [user, author];
    else if (route === "/users/me/teams") data = [team];
    else if (route.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (route === "/system/ping") data = { status: "OK" };
    else if (route.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: 1, mention_count: 1 }];
    else if (route.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: 0 }];
    else if (route.endsWith("/channels")) data = [channel];
    else if (route.startsWith("/channels/")) data = channel;
    else if (route.endsWith("/posts/search")) {
      searches++;
      if (denySearch) { res.statusCode = 403; data = { message: "Access revoked" }; }
      else data = { order: [post.id], posts: { [post.id]: post } };
    } else if (route === "/posts/ids") {
      if (holdLookup) {
        holdLookup = false;
        await new Promise<void>(resolve => { releaseLookup = resolve; });
      }
      // Deliberately finish an old successful response after access is revoked.
      data = [post];
    } else if (route.includes("/threads")) data = { total: 0, total_unread_threads: 0, threads: [] };
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-privacy-race-"));
  const extension = path.resolve(process.env.MM_DECK_EXTENSION_PATH ?? "dist");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1500, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const options = await waitForInstalledOptions(context, worker);
    await worker.evaluate(async origin => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en",
      "mattermostDeck.pollingIntervalSeconds.v1": "15",
      "mattermostDeck.layout.v1": [{ id: "normal", type: "mentions" }],
    }), origin);
    const page = await context.newPage();
    const rows = () => worker.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: () => {
        const host = document.getElementById("mattermost-deck-root");
        if (!host) return [];
        const root = (chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot;
        return [...root.querySelectorAll(".deck-column--mentions [data-deck-post-id]")].map(row => row.textContent);
      } });
      return JSON.stringify(result.result);
    }, origin);
    await page.goto(`${origin}/testteam/channels/town-square`);
    await page.bringToFront();
    await expect.poll(rows, { timeout: 15_000 }).toContain("Private pre-clear body");
    // Stable unread counters make the next poll reuse the completed team scan.
    holdLookup = true;
    await expect.poll(() => !!releaseLookup, { timeout: 35_000 }).toBe(true);
    const searchesBeforeClear = searches;
    denySearch = true;
    const cleared = await options.evaluate(async ({ origin, userId }) => chrome.runtime.sendMessage({
      type: "mattermost-deck:body-cache-privacy", operation: "clear", reason: "permission",
      scope: { serverScope: `${origin}/`, userId },
    }), { origin, userId: user.id });
    expect(cleared.success).toBe(true);
    await expect.poll(rows).not.toContain("Private pre-clear body");
    releaseLookup!(); releaseLookup = undefined;
    // Sample throughout the old completion and the following poll. A single
    // immediate assertion could pass before the stale continuation publishes.
    for (let sample = 0; sample < 20; sample++) {
      expect(await rows()).not.toContain("Private pre-clear body");
      await page.waitForTimeout(100);
    }
    await expect.poll(() => searches, { timeout: 30_000 }).toBeGreaterThan(searchesBeforeClear);
    expect(await rows()).not.toContain("Private pre-clear body");
    const cached = await options.evaluate(async ({ origin, userId }) => chrome.runtime.sendMessage({
      type: "mattermost-deck:mention-cache-storage", operation: "get", persist: true,
      key: JSON.stringify([`${origin}/`, userId, "all"]),
    }), { origin, userId: user.id });
    expect(cached.snapshot).toBeUndefined();
  } finally {
    releaseLookup?.();
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(profile, { recursive: true, force: true });
  }
});

test("permission clear rejects deferred websocket metadata and implicit mention bodies", async () => {
  test.setTimeout(90_000);
  const user = { id: "u".repeat(26), username: "tester", notify_props: { mention_keys: "tester", channel: "true", comments: "root" } };
  const author = { id: "a".repeat(26), username: "author" };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), team_id: team.id, name: "town-square", display_name: "Town Square", type: "O" };
  const rootPost = { id: "r".repeat(26), user_id: user.id, channel_id: channel.id, create_at: 1, message: "My thread" };
  let releaseMetadata: (() => void) | undefined, releaseRoot: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    if (!req.url?.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><body class="app__body"><main id="root" class="app__content">Websocket privacy fixture</main></body></html>');
      return;
    }
    const route = new URL(req.url, "http://localhost").pathname.replace("/api/v4", "");
    let data: unknown = [];
    if (route === "/users/me") data = user;
    else if (route === "/users/ids") data = [user, author];
    else if (route === "/users/me/teams") data = [team];
    else if (route.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (route.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: 0, mention_count: 0 }];
    else if (route.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: 0 }];
    else if (route === `/channels/${"m".repeat(26)}`) {
      await new Promise<void>(resolve => { releaseMetadata = resolve; });
      data = { ...channel, id: "m".repeat(26) };
    } else if (route.endsWith("/channels")) data = [channel];
    else if (route.startsWith("/channels/")) data = channel;
    else if (route === "/posts/ids") {
      await new Promise<void>(resolve => { releaseRoot = resolve; });
      data = [rootPost];
    } else if (route.endsWith("/posts/search")) data = { order: [], posts: {} };
    else if (route.includes("/threads")) data = { total: 0, total_unread_threads: 0, threads: [] };
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data));
  });
  const { wsServer: WebSocketServer } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle");
  const websocketServer = new WebSocketServer({ server, path: "/api/v4/websocket" });
  let socket: { send(value: string): void } | undefined, authenticated = false;
  websocketServer.on("connection", (ws: any) => {
    socket = ws;
    ws.on("message", (raw: Buffer) => {
      const message = JSON.parse(String(raw));
      ws.send(JSON.stringify({ status: "OK", seq_reply: message.seq }));
      if (message.action === "authentication_challenge") {
        authenticated = true;
        ws.send(JSON.stringify({ event: "hello", broadcast: { user_id: user.id } }));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-ws-privacy-race-"));
  const extension = path.resolve(process.env.MM_DECK_EXTENSION_PATH ?? "dist");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const options = await waitForInstalledOptions(context, worker);
    await worker.evaluate(async origin => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en",
      "mattermostDeck.wsPat.v1": "fixture-pat", "mattermostDeck.persistPat.v1": "true",
      "mattermostDeck.pollingIntervalSeconds.v1": 300,
      "mattermostDeck.layout.v1": [{ id: "normal", type: "mentions" }],
    }), origin);
    const page = await context.newPage();
    const rows = () => worker.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: () => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot;
        return [...(root?.querySelectorAll(".deck-column--mentions [data-deck-post-id]") ?? [])].map(row => row.textContent);
      } });
      return JSON.stringify(result.result);
    }, origin);
    const clear = async () => {
      const result = await options.evaluate(async ({ origin, userId }) => chrome.runtime.sendMessage({
        type: "mattermost-deck:body-cache-privacy", operation: "clear", reason: "permission",
        scope: { serverScope: `${origin}/`, userId },
      }), { origin, userId: user.id });
      expect(result.success).toBe(true);
    };
    const staysCleared = async () => {
      for (let sample = 0; sample < 20; sample++) {
        expect(await rows()).not.toContain("Private deferred");
        await page.waitForTimeout(100);
      }
    };
    await page.goto(`${origin}/testteam/channels/town-square`);
    await page.bringToFront();
    await expect.poll(() => authenticated, { timeout: 15_000 }).toBe(true);
    const metadataPost = { id: "p".repeat(26), user_id: author.id, channel_id: "m".repeat(26), create_at: Date.now(), message: "@tester Private deferred metadata" };
    socket!.send(JSON.stringify({ event: "posted", data: { post: JSON.stringify(metadataPost) }, broadcast: { channel_id: metadataPost.channel_id } }));
    await expect.poll(() => !!releaseMetadata, { timeout: 15_000 }).toBe(true);
    await clear();
    await expect.poll(rows).not.toContain("Private deferred");
    releaseMetadata!(); releaseMetadata = undefined;
    await staysCleared();
    const reply = { id: "q".repeat(26), user_id: author.id, channel_id: channel.id, root_id: rootPost.id, create_at: Date.now(), message: "Private deferred implicit reply" };
    socket!.send(JSON.stringify({ event: "posted", data: { post: JSON.stringify(reply), channel_type: "O", team_id: team.id }, broadcast: { channel_id: channel.id } }));
    await expect.poll(() => !!releaseRoot, { timeout: 15_000 }).toBe(true);
    await clear();
    releaseRoot!(); releaseRoot = undefined;
    await staysCleared();
  } finally {
    releaseMetadata?.(); releaseRoot?.();
    await context.close();
    websocketServer.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(profile, { recursive: true, force: true });
  }
});
