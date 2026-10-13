import { chromium, expect, test } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// A simulated host SPA isolates extension behavior from Mattermost's router.
// The separate real-server navigation suites cover Mattermost integration.
test("SPA routes and Deck display switches preserve the document and Deck root", async () => {
  const user = { id: "u".repeat(26), username: "tester", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town square", team_id: team.id, type: "O" };
  const post = { id: "p".repeat(26), user_id: user.id, channel_id: channel.id, create_at: Date.now(), message: "Navigation fixture" };
  const reply = { id: "r".repeat(26), user_id: user.id, channel_id: channel.id, root_id: post.id, create_at: Date.now() + 1, message: "Reply navigation fixture" };
  const server = createServer((req, res) => {
    const route = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!route.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end(`<html><body class="app__body"><div id="root"><div id="SidebarContainer"></div><main class="app__content"><h1>Workspace</h1></main></div></body></html>`);
      return;
    }
    const api = route.replace("/api/v4", "");
    let value: unknown = [];
    if (api === "/users/me") value = user;
    else if (api === "/system/ping") value = { status: "OK" };
    else if (api === "/users/ids") value = [user];
    else if (api === "/users/me/teams") value = [team, { ...team, id: "x".repeat(26), name: "otherteam" }];
    else if (api.startsWith("/config/client")) value = { CollapsedThreads: "disabled" };
    else if (api.endsWith("/channels/members")) value = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0 }];
    else if (api.endsWith("/channels")) value = [channel];
    else if (api.includes("/channels/name/") || api === `/channels/${channel.id}`) value = channel;
    else if (api.endsWith("/posts") || api.includes("/posts/flagged")) value = { order: [post.id, reply.id], posts: { [post.id]: post, [reply.id]: reply } };
    else if (api === "/posts/ids") value = [post, reply];
    else if (api.endsWith(`/members/${user.id}`)) value = { user_id: user.id, channel_id: channel.id, last_viewed_at: 0 };
    else if (api.includes("/threads")) value = { total: 0, threads: [] };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-navigation-stability-"));
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium", headless: true, viewport: { width: 1600, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const columns = [{ id: "watch", type: "channelWatch", channelId: channel.id, teamId: team.id }, { id: "favorites", type: "favorites" }];
    await worker.evaluate(async ({ origin, columns }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin,
      "mattermostDeck.language.v1": "en",
      "mattermostDeck.pollingIntervalSeconds.v1": "300",
      "mattermostDeck.postClickAction.v1": "navigate",
      "mattermostDeck.layout.v1": columns,
      "mattermostDeck.savedViews.v1": [{ id: "saved", name: "Saved two rows", columns, layoutMode: "twoRows", rowSplit: 0.5 }],
    }), { origin, columns });
    const page = await context.newPage();
    await page.goto(`${origin}/testteam/channels/town-square`);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached();
    const inDeck = (selector: string, click = false, label = false) => worker.evaluate(async ({ origin, selector, click, label }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      if (!tab?.id) throw new Error("Fixture tab not found");
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selector, click, label) => {
        const host = document.getElementById("mattermost-deck-root");
        const shadow = host && (chrome as unknown as { dom: { openOrClosedShadowRoot(element: Element): ShadowRoot } }).dom.openOrClosedShadowRoot(host);
        const element = label ? Array.from(shadow?.querySelectorAll("button") ?? []).find(button => button.textContent?.trim() === selector || button.firstElementChild?.textContent === selector) : shadow?.querySelector(selector);
        if (click) (element as HTMLElement | undefined)?.click();
        return { present: Boolean(element), text: element?.textContent };
      }, args: [selector, click, label] });
      return result.result;
    }, { origin, selector, click, label });
    await expect.poll(async () => (await inDeck('[data-pane-id="watch"]'))?.present).toBe(true);
    const token = await page.evaluate(() => {
      const marker = crypto.randomUUID();
      (window as unknown as { documentMarker: string }).documentMarker = marker;
      document.getElementById("mattermost-deck-root")!.dataset.stabilityMarker = marker;
      return marker;
    });
    let documentRequests = 0;
    page.on("request", request => {
      if (request.resourceType() === "document" && request.frame() === page.mainFrame()) documentRequests++;
    });
    const stable = async () => {
      await expect.poll(() => page.evaluate(() => ({
        document: (window as unknown as { documentMarker?: string }).documentMarker,
        root: document.getElementById("mattermost-deck-root")?.dataset.stabilityMarker,
      }))).toEqual({ document: token, root: token });
      expect(documentRequests).toBe(0);
    };
    // Simulate the host's route changes, including quick consecutive transitions.
    for (const route of ["/testteam/channels/off-topic", "/otherteam/channels/town-square", "/testteam/threads", "/testteam/messages/@tester", "/testteam/pl/" + post.id, "/testteam/channels/town-square"]) {
      await page.evaluate(route => {
        history.pushState({}, "", route);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, route);
      // Allow the content script's route settle timer to finish.
      await page.waitForTimeout(650);
      await stable();
    }
    await expect.poll(async () => (await inDeck('[data-pane-id="watch"] .deck-card--post:not(.deck-card--reply)[role="button"]'))?.present).toBe(true);
    await inDeck('[data-pane-id="watch"] .deck-card--post:not(.deck-card--reply)[role="button"]', true);
    await expect(page).toHaveURL(new RegExp("/testteam/channels/town-square/" + post.id + "$"));
    await page.waitForTimeout(650);
    await stable();
    await expect.poll(async () => (await inDeck('[data-pane-id="watch"] .deck-card--reply[role="button"]'))?.present).toBe(true);
    await inDeck('[data-pane-id="watch"] .deck-card--reply[role="button"]', true);
    await expect(page).toHaveURL(new RegExp("/testteam/pl/" + reply.id + "$"));
    await page.waitForTimeout(650);
    await stable();
    for (const label of ["Two rows", "Single row", "Saved two rows"]) {
      if (!(await inDeck(label, false, true))?.present) {
        await inDeck('[aria-controls="mattermost-deck-views-menu"]', true);
      }
      await expect.poll(async () => (await inDeck(label, false, true))?.present).toBe(true);
      await inDeck(label, true, true);
      await expect.poll(async () => (await inDeck(".deck-columns--two-rows"))?.present).toBe(label !== "Single row");
      await stable();
    }
    for (let i = 0; i < 2; i++) {
      await inDeck(".deck-drawer-toggle", true);
      await stable();
    }
    await worker.evaluate(async () => chrome.storage.local.set({ "mattermostDeck.theme.v1": "dark", "mattermostDeck.compactMode.v1": "true" }));
    await page.waitForTimeout(650);
    await stable();
    await page.evaluate(() => {
      const modal = document.createElement("div");
      modal.id = "fixture-modal";
      modal.setAttribute("role", "dialog");
      modal.textContent = "Host modal";
      document.body.append(modal);
    });
    await page.waitForTimeout(650);
    await stable();
    await page.evaluate(() => document.getElementById("fixture-modal")?.remove());
    await page.waitForTimeout(650);
    await stable();
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (path.dirname(profileDir) === os.tmpdir() && path.basename(profileDir).startsWith("deck-navigation-stability-")) {
      await fs.rm(profileDir, { recursive: true, force: true });
    }
  }
});

test("post navigation keeps the deployment prefix for channel and reply routes", async () => {
  const user = { id: "u".repeat(26), username: "tester", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town square", team_id: team.id, type: "O" };
  const post = { id: "p".repeat(26), user_id: user.id, channel_id: channel.id, create_at: Date.now(), message: "Navigation fixture" };
  const reply = { id: "r".repeat(26), user_id: user.id, channel_id: channel.id, root_id: post.id, create_at: Date.now() + 1, message: "Reply navigation fixture" };
  const basePath = "/company/mattermost";
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const route = pathname.startsWith(basePath) ? pathname.slice(basePath.length) || "/" : pathname;
    if (!route.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end(`<html><body class="app__body"><div id="root"><div id="SidebarContainer"></div><main class="app__content"><h1>Workspace</h1></main></div></body></html>`);
      return;
    }
    const api = route.replace("/api/v4", "");
    let value: unknown = [];
    if (api === "/users/me") value = user;
    else if (api === "/system/ping") value = { status: "OK" };
    else if (api === "/users/ids") value = [user];
    else if (api === "/users/me/teams") value = [team, { ...team, id: "x".repeat(26), name: "otherteam" }];
    else if (api.startsWith("/config/client")) value = { CollapsedThreads: "disabled" };
    else if (api.endsWith("/channels/members")) value = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0 }];
    else if (api.endsWith("/channels")) value = [channel];
    else if (api.includes("/channels/name/") || api === `/channels/${channel.id}`) value = channel;
    else if (api.endsWith("/posts") || api.includes("/posts/flagged")) value = { order: [post.id, reply.id], posts: { [post.id]: post, [reply.id]: reply } };
    else if (api === "/posts/ids") value = [post, reply];
    else if (api.endsWith(`/members/${user.id}`)) value = { user_id: user.id, channel_id: channel.id, last_viewed_at: 0 };
    else if (api.includes("/threads")) value = { total: 0, threads: [] };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-navigation-subpath-"));
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium", headless: true, viewport: { width: 1600, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const columns = [{ id: "watch", type: "channelWatch", channelId: channel.id, teamId: team.id }];
    await worker.evaluate(async ({ serverUrl, columns }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": serverUrl,
      "mattermostDeck.language.v1": "en",
      "mattermostDeck.postClickAction.v1": "navigate",
      "mattermostDeck.pollingIntervalSeconds.v1": "300",
      "mattermostDeck.layout.v1": columns,
    }), { serverUrl: origin + basePath, columns });
    const page = await context.newPage();
    await page.goto(`${origin}${basePath}/testteam/channels/town-square`);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached();
    const inDeck = (selector: string, click = false) => worker.evaluate(async ({ origin, selector, click }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      if (!tab?.id) throw new Error("Fixture tab not found");
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selector, click) => {
        const host = document.getElementById("mattermost-deck-root");
        const shadow = host && (chrome as unknown as { dom: { openOrClosedShadowRoot(element: Element): ShadowRoot } }).dom.openOrClosedShadowRoot(host);
        const element = shadow?.querySelector(selector) as HTMLElement | null | undefined;
        if (click) element?.click();
        return Boolean(element);
      }, args: [selector, click] });
      return result.result;
    }, { origin, selector, click });
    await expect.poll(async () => inDeck('[data-pane-id="watch"] .deck-card--post:not(.deck-card--reply)[role="button"]')).toBe(true);
    const marker = await page.evaluate(() => {
      const value = crypto.randomUUID();
      (window as unknown as { documentMarker: string }).documentMarker = value;
      document.getElementById("mattermost-deck-root")!.dataset.stabilityMarker = value;
      return value;
    });
    let documentRequests = 0;
    page.on("request", request => {
      if (request.resourceType() === "document" && request.frame() === page.mainFrame()) documentRequests++;
    });
    const assertStable = async (expectedPath: string) => {
      await expect(page).toHaveURL(`${origin}${expectedPath}`);
      await page.waitForTimeout(650);
      expect(await page.evaluate(() => (window as unknown as { documentMarker?: string }).documentMarker)).toBe(marker);
      expect(await page.locator("#mattermost-deck-root").getAttribute("data-stability-marker")).toBe(marker);
      expect(documentRequests).toBe(0);
    };
    await inDeck('[data-pane-id="watch"] .deck-card--post:not(.deck-card--reply)[role="button"]', true);
    await assertStable(`${basePath}/testteam/channels/town-square/${post.id}`);
    await expect.poll(async () => inDeck('[data-pane-id="watch"] .deck-card--reply[role="button"]')).toBe(true);
    await inDeck('[data-pane-id="watch"] .deck-card--reply[role="button"]', true);
    await assertStable(`${basePath}/testteam/pl/${reply.id}`);
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (path.dirname(profileDir) === os.tmpdir() && path.basename(profileDir).startsWith("deck-navigation-subpath-")) {
      await fs.rm(profileDir, { recursive: true, force: true });
    }
  }
});
