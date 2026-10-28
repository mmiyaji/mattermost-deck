import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

for (const scenario of ["search failure", "cancellation"] as const) {
  test(`channel scans retry after ${scenario} before the feed is published`, async () => {
    const user = { id: "u".repeat(26), username: "scanuser", notify_props: { mention_keys: "scanuser", channel: "true" } };
    const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
    const teams = scenario === "cancellation" ? [team, { ...team, id: "v".repeat(26), name: "second" }, { ...team, id: "w".repeat(26), name: "third" }] : [team];
    const current = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
    const post = { id: "p".repeat(26), user_id: "a".repeat(26), channel_id: "r".repeat(26), create_at: Date.now(), message: "@all Scan recovery fixture" };
    const remote = { ...current, id: post.channel_id, name: "remote", display_name: "Remote", last_post_at: post.create_at };
    let scans = 0, searches = 0;
    let lastScanAt = 0;
    const requests: string[] = [];
    let releaseSearch: (() => void) | undefined;
    const firstSearch = new Promise<void>(resolve => { releaseSearch = resolve; });
    const server = createServer(async (req, res) => {
      const p = new URL(req.url ?? "/", "http://localhost").pathname.replace("/api/v4", "");
      requests.push(p);
      if (!req.url?.startsWith("/api/")) {
        res.setHeader("Content-Type", "text/html");
        res.end('<html><body class="app__body"><div id="root"><div id="SidebarContainer">Workspace</div><main class="app__content"><h1 class="channel-header">Town Square</h1></main></div></body></html>');
        return;
      }
      res.setHeader("Content-Type", "application/json");
      let data: unknown = [];
      if (p === "/system/ping") data = { status: "OK" };
      else if (p === "/users/me") data = user;
      else if (p === "/users/ids") data = [user, { id: post.user_id, username: "author" }];
      else if (p === "/users/me/teams") data = teams;
      else if (p.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: 1, mention_count: 1 }];
      else if (p.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
      else if (p.endsWith("/channels/members")) data = p.includes(team.id) ? [{ channel_id: remote.id, user_id: user.id, last_viewed_at: 0, mention_count: 1 }] : [];
      else if (p.endsWith("/channels") || p === "/channels/ids") data = [current, remote];
      else if (p.includes("/channels/name/") || p === `/channels/${current.id}`) data = current;
      else if (p === `/channels/${remote.id}`) data = remote;
      else if (p.endsWith("/posts/search")) {
        searches++;
        if (scenario === "search failure" && searches === 1) {
          res.statusCode = 500; res.end(JSON.stringify({ message: "Search temporarily unavailable" })); return;
        }
        if (scenario === "cancellation" && searches === 3) {
          await firstSearch;
        }
        data = { order: [], posts: {} };
      }
      else if (p === `/channels/${remote.id}/posts`) { scans++; lastScanAt = Date.now(); data = { order: [post.id], posts: { [post.id]: post } }; }
      else if (p.includes("/threads")) data = { total: 0, threads: [] };
      else if (p.endsWith("/unread")) data = { team_id: team.id, msg_count: 1, mention_count: 1 };
      res.end(JSON.stringify(data));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-scan-recovery-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, viewport: { width: 1600, height: 900 },
      args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
    });
    try {
      const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      await sw.evaluate(({ origin }) => chrome.storage.local.set({
        "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en",
        "mattermostDeck.pollingIntervalSeconds.v1": 3600,
        "mattermostDeck.layout.v1": [{ id: "mentions", type: "mentions" }],
      }), { origin });
      const page = await context.newPage();
      await page.goto(`${origin}/testteam/channels/town-square`);
      const inspect = (selector: string, click = false) => sw.evaluate(async ({ origin, selector, click }) => {
        const tab = (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin));
        if (!tab?.id) throw new Error("Fixture tab missing");
        const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selector, click) => {
          const host = document.getElementById("mattermost-deck-root");
          const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
          const el = root?.querySelector(selector) as HTMLElement | null;
          if (click) el?.click();
          return el?.textContent ?? null;
        }, args: [selector, click] });
        return result.result;
      }, { origin, selector, click });
      const pane = '[data-deck-column-id="mentions"]';
      await expect.poll(() => scans, { timeout: 15_000 }).toBe(1).catch(async error => {
        console.log("Scan recovery diagnostic", requests, await inspect(".deck-shell"));
        throw error;
      });
      if (scenario === "cancellation") {
        // The first two teams have completed; the third team's search is held.
        await expect.poll(() => searches).toBe(3);
        await inspect(`${pane} .deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)`, true);
        await inspect(`${pane} button[title="Pause polling"]`, true);
        await expect.poll(() => inspect(`${pane} button[title="Resume polling"]`)).not.toBeNull();
      }
      releaseSearch!();
      if (scenario === "search failure") {
        await expect.poll(() => inspect(`${pane} [role="alert"]`)).not.toBeNull();
        await inspect(`${pane} .deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)`, true);
        await inspect(`${pane} button[title="Pause polling"]`, true);
        await expect.poll(() => inspect(`${pane} button[title="Resume polling"]`)).not.toBeNull();
      }
      // Resume starts a new poll without invalidating the scan cache, unlike Refresh.
      // Let the independent 1-second GET burst cache expire, so this measures
      // the scan-signature cache rather than a cached channel API response.
      await expect.poll(() => Date.now() - lastScanAt).toBeGreaterThan(1100);
      await inspect(`${pane} button[title="Resume polling"]`, true);
      await expect.poll(() => searches).toBe(teams.length * 2);
      await expect.poll(() => scans).toBe(2);
      await expect.poll(() => inspect(`${pane} .deck-card--post`)).toContain("Scan recovery fixture");
      // A successful run still enables the optimization for subsequent polls.
      await expect.poll(() => inspect(`${pane} [role="progressbar"]`)).toBeNull();
      await inspect(`${pane} button[title="Pause polling"]`, true);
      await expect.poll(() => inspect(`${pane} button[title="Resume polling"]`)).not.toBeNull();
      await expect.poll(() => Date.now() - lastScanAt).toBeGreaterThan(1100);
      await inspect(`${pane} button[title="Resume polling"]`, true);
      await expect.poll(() => searches).toBe(teams.length * 3);
      expect(scans).toBe(2);
    } finally {
      releaseSearch!();
      await context.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      const relative = path.relative(os.tmpdir(), profile);
      if (relative.startsWith("deck-scan-recovery-") && !relative.includes(path.sep)) await fs.rm(profile, { recursive: true, force: true });
    }
  });
}
