import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("built Deck displays and operates the favorites pane with a fixture server", async ({}, testInfo) => {
  const user = { id: "u".repeat(26), username: "favoriteuser", first_name: "Favorite", last_name: "User", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  let post = { id: "p".repeat(26), user_id: user.id, channel_id: channel.id, create_at: Date.now(), message: "Favorite UI fixture" };
  let deleted = false;
  let favoritesRequests = 0;
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
    else if (p === "/users/ids") data = [user];
    else if (p === "/users/me/teams") data = [team];
    else if (p.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (p.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0 }];
    else if (p.endsWith("/channels")) data = [channel];
    else if (p.includes("/channels/name/") || p === `/channels/${channel.id}`) data = channel;
    else if (p.endsWith("/posts") || p.includes("/posts/flagged")) data = { order: deleted ? [] : [post.id], posts: deleted ? {} : { [post.id]: post } };
    else if (p === "/posts/ids") { favoritesRequests++; data = deleted ? [] : [post]; }
    else if (p.endsWith(`/members/${user.id}`)) data = { user_id: user.id, channel_id: channel.id, last_viewed_at: 0 };
    else if (p.includes("/threads")) data = { total: 0, threads: [] };
    res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-favorites-ui-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1600, height: 900 },
    args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
  });
  try {
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await sw.evaluate(({ origin, channel, team }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light", "mattermostDeck.postClickAction.v1": "navigate",
      "mattermostDeck.layout.v1": [{ id: "watch", type: "channelWatch", channelId: channel.id, teamId: team.id }, { id: "favorites", type: "favorites" }],
    }), { origin, channel, team });
    const page = await context.newPage();
    await page.goto(`${origin}/testteam/channels/town-square`);
    const inspect = (selector: string, click: boolean | "focus" = false) => sw.evaluate(async ({ origin, selector, click }) => {
      const tab = (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin));
      if (!tab?.id) return null;
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selector, click) => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
        const el = root?.querySelector(selector) as HTMLElement | null;
        if (click === "focus") el?.focus();
        else if (click) el?.click();
        return el ? { text: el.textContent, pressed: el.getAttribute("aria-pressed"), width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left } : null;
      }, args: [selector, click] });
      return result.result;
    }, { origin, selector, click });
    const favoritePane = ".deck-column--favorites";
    await expect.poll(async () => (await inspect(favoritePane))?.text, { timeout: 20_000 }).toContain("Use ☆");
    await expect.poll(async () => (await inspect('.deck-column--channel .deck-card--post'))?.text, { timeout: 20_000 }).toContain(post.message);
    const oldUrl = page.url();
    await inspect('.deck-column--channel .deck-favorite-button', "focus");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await inspect(`${favoritePane} .deck-card--post`))?.text).toContain(post.message);
    expect(page.url()).toBe(oldUrl);
    expect(favoritesRequests).toBe(0);
    await page.reload();
    await expect.poll(async () => (await inspect(`${favoritePane} .deck-card--post`))?.text).toContain(post.message);
    expect(favoritesRequests).toBe(0);
    post = { ...post, message: "Favorite UI fixture edited" };
    await inspect(`${favoritePane} [aria-label="Refresh"]`, true);
    await expect.poll(async () => (await inspect(`${favoritePane} .deck-card--post`))?.text).toContain("edited");
    expect(favoritesRequests).toBe(1);
    const author = await inspect(`${favoritePane} .deck-card-author`);
    const star = await inspect(`${favoritePane} .deck-favorite-button`);
    expect(author!.right).toBeLessThan(star!.left);
    await page.screenshot({ path: testInfo.outputPath("favorites-pane.png"), fullPage: true });
    await inspect(`${favoritePane} .deck-card--post`, true);
    await expect(page).toHaveURL(`${origin}/testteam/pl/${post.id}`);
    deleted = true;
    await inspect(`${favoritePane} [aria-label="Refresh"]`, true);
    await expect.poll(async () => (await inspect(`${favoritePane} .deck-favorites-unavailable`))?.text).toContain("unavailable");
    await inspect(`${favoritePane} .deck-favorites-unavailable button`, true);
    await expect.poll(async () => (await inspect(favoritePane))?.text).toContain("Use ☆");
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(profile, { recursive: true, force: true });
  }
});
