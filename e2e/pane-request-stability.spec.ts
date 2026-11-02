import { test, expect, chromium, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function debug(page: Page, action: string, payload: object = {}): Promise<any> {
  return page.evaluate(({ action, payload }) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener("mattermost-deck-debug-response", listener); reject(new Error(action)); }, 5000);
    const listener = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail.id === id) { clearTimeout(timer); window.removeEventListener("mattermost-deck-debug-response", listener); resolve(detail.result); } };
    window.addEventListener("mattermost-deck-debug-response", listener);
    window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", { detail: { id, action, payload } }));
  }), { action, payload });
}

test("navigation and unrelated deletions do not refetch fixed panes; held responses cannot restore deleted posts", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const user = { id: "u".repeat(26), username: "tester", notify_props: {} };
  const author = { id: "a".repeat(26), username: "author" };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const other = { ...channel, id: "b".repeat(26), name: "off-topic" };
  const dm = { ...channel, id: "d".repeat(26), name: `${user.id}__${author.id}`, team_id: "", type: "D" };
  const makePost = (id: string, channelId: string) => ({ id: id.repeat(26), channel_id: channelId, user_id: author.id, message: `tag ${id}`, create_at: Date.now() });
  const p = makePost("p", channel.id), keep = makePost("k", channel.id), direct = makePost("j", dm.id);
  const otherPost = makePost("o", other.id);
  const deleted = new Set<string>();
  const counts = { watch: 0, other: 0, dm: 0, search: 0, saved: 0 };
  let directoryRequests = 0;
  const sockets = new Set<Duplex>();
  let holdWatch = false, releaseWatch = () => {};
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) { res.setHeader("Content-Type", "text/html"); res.end('<html><body class="app__body"><div id="root"><main class="app__content"><h1>Workspace</h1></main></div></body></html>'); return; }
    const pathname = url.pathname.replace("/api/v4", "");
    let data: unknown = [];
    const list = (posts: typeof p[]) => { const active = posts.filter(post => !deleted.has(post.id)); return { order: active.map(post => post.id), posts: Object.fromEntries(active.map(post => [post.id, post])) }; };
    if (pathname === "/users/me") data = user;
    else if (pathname === "/users/ids") data = [user, author];
    else if (pathname === "/users/me/teams") data = [team];
    else if (pathname === "/users/me/channels") { directoryRequests++; data = [dm]; }
    else if (pathname === "/system/ping") data = { status: "OK" };
    else if (pathname.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (pathname.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: 2, mention_count: 0 }];
    else if (pathname.endsWith("/channels/members")) data = [channel, dm].map(ch => ({ channel_id: ch.id, user_id: user.id, last_viewed_at: 0 }));
    else if (pathname.endsWith("/channels")) { directoryRequests++; data = [channel, other]; }
    else if (pathname.includes("/channels/name/")) data = pathname.endsWith("off-topic") ? other : channel;
    else if (pathname === `/channels/${channel.id}/posts`) { counts.watch++; data = list([p, keep]); if (holdWatch) await new Promise<void>(resolve => { releaseWatch = resolve; }); }
    else if (pathname === `/channels/${dm.id}/posts`) { counts.dm++; data = list([direct]); }
    else if (pathname === `/channels/${other.id}/posts`) { counts.other++; data = list([otherPost]); }
    else if (pathname.endsWith("/posts/search")) { counts.search++; data = list([p, keep, direct]); }
    else if (pathname.endsWith("/posts/flagged")) { counts.saved++; data = list([p, direct]); }
    else if (pathname.startsWith("/channels/")) data = pathname.includes(dm.id) ? dm : channel;
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data));
  });
  const send = (socket: Duplex, message: object) => {
    const bytes = Buffer.from(JSON.stringify(message));
    const header = bytes.length < 126 ? Buffer.from([0x81, bytes.length]) : Buffer.from([0x81, 126, bytes.length >> 8, bytes.length & 255]);
    socket.write(Buffer.concat([header, bytes]));
  };
  server.on("upgrade", (req, socket) => {
    sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket));
    const accept = createHash("sha1").update(String(req.headers["sec-websocket-key"]) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    send(socket, { event: "hello", broadcast: { user_id: user.id } });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-request-stability-"));
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 2200, height: 900 },
    args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`] });
  const checkpoints: unknown[] = [];
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(({ origin, team, channel, dm }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.pollingIntervalSeconds.v1": 3600,
      "mattermostDeck.postClickAction.v1": "navigate", "mattermostDeck.wsPat.v1": "fixture", "mattermostDeck.persistPat.v1": "true",
      "mattermostDeck.preferredRailWidth.v1": 1300,
      "mattermostDeck.layout.v1": [
        { id: "watch", type: "channelWatch", teamId: team.id, channelId: channel.id },
        { id: "dm", type: "dmWatch", channelId: dm.id },
        { id: "search", type: "keywordWatch", teamId: team.id, query: "tag" },
        { id: "saved", type: "saved" },
      ],
    }), { origin, team, channel, dm });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("mattermostDeck.debugLogs", "1"));
    await page.goto(`${origin}/testteam/channels/town-square`);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 30_000 });
    const inspect = () => worker.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: () => {
        const host = document.getElementById("mattermost-deck-root")!;
        const root = (chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot;
        return Object.fromEntries(["watch", "dm", "search", "saved"].map(id => {
          const pane = root.querySelector(`[data-pane-id="${id}"]`);
          return [id, { ids: Array.from(pane?.querySelectorAll<HTMLElement>("[data-deck-post-id]") ?? [], row => row.dataset.deckPostId),
            marker: (pane as HTMLElement)?.dataset.stabilityMarker }];
        }));
      } }); return result.result as Record<string, { ids: string[]; marker?: string }>;
    }, origin);
    await expect.poll(async () => { const panes = await inspect(); return [panes.watch, panes.dm, panes.search, panes.saved].map(pane => pane.ids.length); }, { timeout: 30_000 }).toEqual([2, 1, 3, 2]);
    await expect.poll(() => sockets.size).toBe(1);
    await worker.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: () => {
        const root = (chrome as any).dom.openOrClosedShadowRoot(document.getElementById("mattermost-deck-root"));
        for (const pane of root.querySelectorAll("[data-pane-id]")) pane.dataset.stabilityMarker = pane.dataset.paneId;
      } });
    }, origin);
    let baseline = { ...counts };
    for (const route of ["off-topic", "town-square"]) {
      await page.evaluate(route => { history.pushState({}, "", `/testteam/channels/${route}`); window.dispatchEvent(new PopStateEvent("popstate")); }, route);
      await page.waitForTimeout(700);
      expect(counts).toEqual(baseline);
    }
    await debug(page, "updateColumn", { id: "watch", patch: { customTitle: "Renamed", width: 360 } });
    await debug(page, "moveColumn", { id: "watch", direction: "right" });
    await page.waitForTimeout(1100);
    expect(counts).toEqual(baseline);
    expect(Object.values(await inspect()).map(pane => pane.marker).sort()).toEqual(["dm", "saved", "search", "watch"]);
    checkpoints.push({ label: "routes and pane presentation", counts: { ...counts } });
    const directoryBaseline = directoryRequests;
    await debug(page, "updateColumn", { id: "watch", patch: { channelId: other.id } });
    await expect.poll(async () => (await inspect()).watch.ids).toEqual([otherPost.id]);
    expect(counts).toEqual({ ...baseline, other: 1 });
    expect(directoryRequests, "target selection must reuse the unchanged directory").toBe(directoryBaseline);
    await debug(page, "updateColumn", { id: "watch", patch: { channelId: channel.id } });
    await expect.poll(async () => (await inspect()).watch.ids.slice().sort()).toEqual([p.id, keep.id].sort());
    expect(directoryRequests).toBe(directoryBaseline);
    baseline = { ...counts };
    checkpoints.push({ label: "target changes reload only target posts", counts: { ...counts }, directoryRequests });
    const remove = (id: string) => { deleted.add(id); for (const socket of sockets) send(socket, { event: "post_deleted", data: { post: JSON.stringify({ id }) }, broadcast: { channel_id: channel.id } }); };
    remove("x".repeat(26));
    await page.waitForTimeout(1200);
    expect(counts, "unrelated deletion must not refetch any pane").toEqual(baseline);
    remove(p.id);
    await expect.poll(async () => { const panes = await inspect(); return [panes.watch.ids.includes(p.id), panes.search.ids.includes(p.id), panes.saved.ids.includes(p.id), panes.dm.ids.includes(direct.id)]; }).toEqual([false, false, false, true]);
    expect(counts).toEqual(baseline);
    checkpoints.push({ label: "deletions applied locally", counts: { ...counts } });
    holdWatch = true;
    await worker.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: () => {
        const root = (chrome as any).dom.openOrClosedShadowRoot(document.getElementById("mattermost-deck-root"));
        const pane = root.querySelector('[data-pane-id="watch"]');
        pane.querySelector('.deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)')?.click();
      } });
    }, origin);
    await expect.poll(() => worker.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: () => {
        const root = (chrome as any).dom.openOrClosedShadowRoot(document.getElementById("mattermost-deck-root"));
        const button = root.querySelector('[data-pane-id="watch"] button[title="Refresh"]') as HTMLButtonElement | null;
        if (!button || button.disabled) return false;
        button.click();
        return true;
      } }); return result.result;
    }, origin)).toBe(true);
    await expect.poll(() => counts.watch).toBe(baseline.watch + 1);
    remove(keep.id);
    await expect.poll(async () => (await inspect()).watch.ids.includes(keep.id)).toBe(false);
    holdWatch = false; releaseWatch();
    await page.waitForTimeout(1200);
    expect((await inspect()).watch.ids).toEqual([]);
    expect(counts).toEqual({ ...baseline, watch: baseline.watch + 1 });
    checkpoints.push({ label: "manual refresh retained; stale response filtered", counts: { ...counts } });
  } finally {
    releaseWatch();
    await fs.writeFile(testInfo.outputPath("pane-request-counts.json"), JSON.stringify({ counts, directoryRequests, checkpoints }, null, 2));
    await context.close(); for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(profile, { recursive: true, force: true });
  }
});
