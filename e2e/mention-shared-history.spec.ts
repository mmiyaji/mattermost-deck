import { chromium, expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

type MentionState = {
  postStatus: string;
  postIds: string[];
  visiblePostIds: string[];
  mentionCount: number;
  mentionLoadActive: boolean;
};

async function debugRequest<T>(page: Page, action: string, payload: Record<string, unknown> = {}): Promise<T | null> {
  return page.evaluate(({ action, payload }) => new Promise<T | null>((resolve) => {
    const id = `shared-history-${Math.random().toString(36).slice(2)}`;
    const finish = (result: T | null) => {
      clearTimeout(timer);
      window.removeEventListener("mattermost-deck-debug-response", listener);
      resolve(result);
    };
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; result?: T }>).detail;
      if (detail?.id === id) finish(detail.result ?? null);
    };
    const timer = setTimeout(() => finish(null), 2000);
    window.addEventListener("mattermost-deck-debug-response", listener);
    window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", { detail: { id, action, payload } }));
  }), { action, payload });
}

test("an unread-only feed owner retains read history for all-mentions and review siblings", async () => {
  const user = { id: "u".repeat(26), username: "historyuser", notify_props: { mention_keys: "historyuser", channel: "true" } };
  const author = { id: "a".repeat(26), username: "author", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const post = { id: "p".repeat(26), user_id: author.id, channel_id: channel.id, create_at: 100, message: "@historyuser Read history fixture" };
  const membership = { user_id: user.id, channel_id: channel.id, last_viewed_at: 200, mention_count: 0, msg_count: 1 };
  const unread = { team_id: team.id, msg_count: 0, mention_count: 0, thread_count: 0, thread_mention_count: 0 };
  let searchRequests = 0;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith("/api/")) {
      response.setHeader("Content-Type", "text/html");
      response.end('<html><body class="app__body"><div id="root"><div id="SidebarContainer">Test workspace</div><main class="app__content"><h1 class="channel-header">Read mention history</h1></main></div></body></html>');
      return;
    }
    const route = pathname.replace("/api/v4", "");
    let payload: unknown = [];
    if (route === "/system/ping") payload = { status: "OK" };
    else if (route === "/users/me") payload = user;
    else if (route === "/users/ids") payload = [user, author];
    else if (route === "/users/me/teams") payload = [team];
    else if (route === `/teams/name/${team.name}`) payload = team;
    else if (route.startsWith("/config/client")) payload = { CollapsedThreads: "disabled" };
    else if (route.endsWith("/teams/unread")) payload = [unread];
    else if (route.endsWith("/channels/members")) payload = [membership];
    else if (route.endsWith("/channels")) payload = [channel];
    else if (route.includes("/channels/name/") || route === `/channels/${channel.id}`) payload = channel;
    else if (route.endsWith("/posts/search")) {
      searchRequests += 1;
      payload = { order: [post.id], posts: { [post.id]: post } };
    }
    // The old mention is outside the recent-channel window. Only a history
    // search should discover it, so unread-only recent scans cannot mask the bug.
    else if (route.endsWith("/posts")) payload = { order: [], posts: {} };
    else if (route.endsWith(`/members/${user.id}`)) payload = membership;
    else if (route.includes("/threads")) payload = { total: 0, total_unread_threads: 0, total_unread_mentions: 0, threads: [] };
    else if (route.endsWith("/unread")) payload = unread;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profileDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-shared-mention-history-"));
  const extensionPath = path.resolve("./dist");
  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium", headless: true, viewport: { width: 1600, height: 1000 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await waitForInstalledOptions(context, worker);
    await worker.evaluate(({ origin, teamId }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin,
      "mattermostDeck.language.v1": "en",
      "mattermostDeck.theme.v1": "light",
      "mattermostDeck.layout.v1": [{ id: "unread-owner", type: "mentions", teamId, unreadOnly: true }],
    }), { origin, teamId: team.id });
    const page = await context.newPage();
    await page.addInitScript(() => window.localStorage.setItem("mattermostDeck.debugLogs", "1"));
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${origin}/testteam/channels/town-square`);
    const columnState = (id: string) => debugRequest<MentionState>(page, "getColumnState", { id });
    const expectUnreadOwnerEmpty = () => expect.poll(() => columnState("unread-owner"), { timeout: 15_000 })
      .toMatchObject({ postStatus: "ready", visiblePostIds: [], mentionCount: 0, mentionLoadActive: false });
    await expectUnreadOwnerEmpty();
    expect((await columnState("unread-owner"))?.postIds).toEqual([]);
    expect(searchRequests).toBe(0);

    const allMentionsId = await debugRequest<string>(page, "addColumn", {
      type: "mentions", defaults: { teamId: team.id, unreadOnly: false },
    });
    expect(allMentionsId).toBeTruthy();
    await expect.poll(() => columnState(allMentionsId!), { timeout: 15_000 })
      .toMatchObject({ postStatus: "ready", visiblePostIds: [post.id], mentionLoadActive: false });
    await expectUnreadOwnerEmpty();
    expect(searchRequests).toBeGreaterThan(0);

    await debugRequest(page, "removeColumn", { id: allMentionsId });
    await expect.poll(() => columnState(allMentionsId!)).toBeNull();
    // The shared feed may retain read posts gathered for the removed sibling;
    // the owner's unread presentation must still remain empty.
    await expectUnreadOwnerEmpty();

    const reviewId = await debugRequest<string>(page, "addColumn", {
      type: "mentions", defaults: { teamId: team.id, unreadOnly: true, mentionReview: true },
    });
    expect(reviewId).toBeTruthy();
    await expect.poll(() => columnState(reviewId!), { timeout: 15_000 })
      .toMatchObject({ postStatus: "ready", visiblePostIds: [post.id], mentionLoadActive: false });
    await expectUnreadOwnerEmpty();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(profileDirectory, { recursive: true, force: true });
  }
});
