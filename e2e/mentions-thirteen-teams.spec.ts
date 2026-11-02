import { test, expect, chromium, type Page, type BrowserContext, type Worker } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RESPONSIVE_PERFORMANCE_PRESET } from "../src/performanceSettings";

const origin = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
async function api(token: string, method: string, route: string, body?: unknown): Promise<any> {
  const res = await fetch(`${origin}/api/v4${route}`, { method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function loginToken(username: string, password: string): Promise<string> {
  const response = await fetch(`${origin}/api/v4/users/login`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login_id: username, password }) });
  if (!response.ok || !response.headers.get("Token")) throw new Error(`Fixture login: ${response.status}`);
  return response.headers.get("Token")!;
}
async function debug(page: Page, action: string, payload: object = {}): Promise<any> {
  return page.evaluate(({ action, payload }) => new Promise(resolve => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener("mattermost-deck-debug-response", listener); resolve(null); }, 5000);
    const listener = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("mattermost-deck-debug-response", listener);
      resolve(detail.result);
    };
    window.addEventListener("mattermost-deck-debug-response", listener);
    window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", { detail: { id, action, payload } }));
  }), { action, payload });
}

test("13 real teams and 78 unread threads preserve mention IDs and badges", async ({}, testInfo) => {
  test.setTimeout(600_000);
  if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Local Docker fixture only");
  const state = JSON.parse(await fs.readFile(process.env.MM95_STATE_FILE ?? "e2e/mm95-state.json", "utf8"));
  const admin = await loginToken(state.adminUser.username, state.adminUser.password);
  const suffix = Date.now().toString();
  const responsive = process.env.DECK_PERF_RESPONSIVE === "1";
  let restartFirstPaintMs: number | null = null;
  let restartCachedRows: number | null = null;
  const password = `DeckLoad-${suffix}!aA`;
  let user: any;
  let context: BrowserContext | undefined;
  let sw: Worker | undefined;
  let page: Page | undefined;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-thirteen-teams-"));
  const teams: any[] = [];
  const expected = new Set<string>();
  const pending = new Set<string>();
  const checkpoints: any[] = [];
  const requests: { path: string; status: number; phase: string }[] = [];
  const pageErrors: { message: string; stack: string }[] = [];
  let lastObserved: any = null;
  let phase = "setup";
  try {
    user = await api(admin, "POST", "/users", { username: `deckload${suffix}`, email: `deckload${suffix}@example.test`, password });
    const token = await loginToken(user.username, password);
    await api(token, "PUT", `/users/${user.id}/preferences`, [{ user_id: user.id, category: "display_settings", name: "collapsed_reply_threads", value: "on" }]);
    await api(token, "PUT", `/users/${user.id}/patch`, { notify_props: { ...user.notify_props, mention_keys: user.username, channel: "true", comments: "never" } });
    for (let i = 0; i < 13; i++) {
      const team = await api(admin, "POST", "/teams", { name: `load${suffix}${i}`, display_name: `Deck Load ${i}`, type: "O" });
      teams.push(team);
      await api(admin, "POST", `/teams/${team.id}/members`, { team_id: team.id, user_id: user.id });
      team.channel = await api(admin, "POST", "/channels", { team_id: team.id, name: "load-mentions", display_name: "Load mentions", type: "O" });
      await api(admin, "POST", `/channels/${team.channel.id}/members`, { user_id: user.id });
      team.roots = [];
      for (let j = 0; j < 6; j++) team.roots.push(await api(admin, "POST", "/posts", { channel_id: team.channel.id, message: `load-root-${i}-${j}` }));
      await api(token, "POST", "/posts", { channel_id: team.channel.id, message: `@${user.username} self-excluded-${i}` });
      for (const channel of await api(token, "GET", `/users/me/teams/${team.id}/channels`)) {
        await api(token, "POST", "/channels/members/me/view", { channel_id: channel.id, collapsed_threads_supported: true });
      }
      team.replies = [];
      for (const [j, root] of team.roots.entries()) {
        const reply = await api(admin, "POST", "/posts", { channel_id: team.channel.id, root_id: root.id, message: `@${user.username} load-reply-${i}-${j}` });
        team.replies.push(reply);
        expected.add(reply.id);
      }
      team.direct = [];
      for (const mention of [`@${user.username}`, "@all", "@here"]) {
        const post = await api(admin, "POST", "/posts", { channel_id: team.channel.id, message: `${mention} load-direct-${i}-${team.direct.length}` });
        team.direct.push(post);
        expected.add(post.id);
      }
    }
    expect((await api(token, "GET", "/users/me/teams")).length).toBe(13);
    for (const team of teams) {
      await api(token, "POST", `/users/${user.id}/posts/${team.direct[0].id}/set_unread`, { collapsed_threads_supported: true });
      const member = await api(token, "GET", `/channels/${team.channel.id}/members/${user.id}`);
      expect(member.last_viewed_at).toBeLessThan(Math.min(...team.direct.map((p: any) => p.create_at)));
    }
    await expect.poll(async () => {
      let threads = 0;
      for (const team of teams) threads += (await api(token, "GET", `/users/${user.id}/teams/${team.id}/threads?unread=true&per_page=200`)).threads.filter((t: any) => t.unread_mentions > 0).length;
      return threads;
    }, { timeout: 30_000 }).toBe(78);
    // The extension must be tested against searchable fixture data, rather
    // than racing the server's search/index visibility after the final POST.
    await expect.poll(async () => {
      const explicit = new Set(teams.flatMap(team => [...team.replies.map((p: any) => p.id), team.direct[0].id]));
      const found = new Set<string>();
      for (const team of teams) {
        const result = await api(token, "POST", `/teams/${team.id}/posts/search`, {
          terms: `@${user.username} @all @here`, is_or_search: true, per_page: 200,
        });
        for (const id of result.order ?? []) if (explicit.has(id)) found.add(id);
      }
      return found.size;
    }, { timeout: 30_000, message: "All explicit fixture mentions are searchable before browser measurement" }).toBe(91);
    for (const id of expected) pending.add(id);

    context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1600, height: 1000 },
      args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`] });
    sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await sw.evaluate(({ origin, token, accelerated, responsiveSettings }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.wsPat.v1": token, "mattermostDeck.persistPat.v1": "true",
      "mattermostDeck.language.v1": "en", "mattermostDeck.pollingIntervalSeconds.v1": "3600", "mattermostDeck.traceCapture.v1": true,
      ...(accelerated ? { "mattermostDeck.apiMinStartGapMs.v1": "0", "mattermostDeck.apiGlobalRequestsPerMinute.v1": "900",
        "mattermostDeck.apiGetRequestsPerMinute.v1": "600", "mattermostDeck.apiPostRequestsPerMinute.v1": "300",
        "mattermostDeck.mentionReconcileMinIntervalSeconds.v1": "1", "mattermostDeck.mentionFullScanIntervalSeconds.v1": "600" } : {}),
      ...(responsiveSettings ? {
        ...Object.fromEntries(Object.entries(responsiveSettings).map(([key, value]) => [`mattermostDeck.${key}.v1`, String(value)])),
        "mattermostDeck.persistMentionCache.v1": "true",
      } : {}),
      "mattermostDeck.layout.v1": [{ id: "normal", type: "mentions", unreadOnly: true },
        { id: "review", type: "mentions", mentionReview: true, unreadOnly: true }],
    }), { origin, token, accelerated: process.env.DECK_PERF_FAST === "1", responsiveSettings: responsive ? RESPONSIVE_PERFORMANCE_PRESET : null });
    page = await context.newPage();
    page.on("pageerror", e => pageErrors.push({ message: e.message, stack: e.stack ?? "" }));
    page.on("response", r => { if (r.url().includes("/api/v4/")) requests.push({ path: new URL(r.url()).pathname, status: r.status(), phase }); });
    await page.addInitScript(() => localStorage.setItem("mattermostDeck.debugLogs", "1"));
    await page.goto(`${origin}/landing#/login`);
    const loginId = page.locator('input[name="loginId"]');
    const browser = page.getByText("View in Browser");
    await Promise.race([loginId.waitFor({ state: "visible" }), browser.waitFor({ state: "visible" })]).catch(() => {});
    if (await browser.isVisible()) await browser.click();
    await loginId.fill(user.username);
    await page.locator('input[name="password-input"]').fill(password);
    phase = "initial";
    const started = Date.now();
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/channels|messages/);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 30_000 });

    const dom = async (action = "snapshot", postId = "") => sw!.evaluate(async ({ origin, action, postId }) => {
      const tab = (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin));
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, args: [action, postId], func: (action, postId) => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
        if (action === "confirm") {
          const button = root?.querySelector(`[data-deck-column-id="review"] [data-deck-review-confirm${postId ? `="${postId}"` : ""}]`) as HTMLElement;
          const id = button?.getAttribute("data-deck-review-confirm");
          button?.click();
          return id;
        }
        return Object.fromEntries(["normal", "review"].map(id => {
          const pane = root?.querySelector(`[data-deck-column-id="${id}"]`);
          return [id, { badge: Number(pane?.querySelector(".deck-badge")?.textContent), text: pane?.textContent, renderedRows: pane?.querySelectorAll('[data-deck-post-rendered="true"]').length ?? 0 }];
        }));
      } });
      return r.result as any;
    }, { origin, action, postId });
    const assertState = async (label: string, timeout = 120_000) => {
      let lastLogAt = 0;
      await expect.poll(async () => {
        await debug(page!, "applyMentionUpdates", { id: "normal" });
        await debug(page!, "applyMentionUpdates", { id: "review" });
        const normal = await debug(page!, "getColumnState", { id: "normal" });
        const review = await debug(page!, "getColumnState", { id: "review" });
        const badges = await dom();
        lastObserved = { normalIds: [...(normal?.visiblePostIds ?? [])].sort(), reviewIds: [...(review?.visiblePostIds ?? [])].sort(),
          normalBadge: badges.normal.badge, reviewBadge: badges.review.badge, loading: Boolean(normal?.mentionLoadActive) };
        if (Date.now() - lastLogAt > 10_000) {
          lastLogAt = Date.now();
          console.log("checking", label, { normal: lastObserved.normalIds.length, review: lastObserved.reviewIds.length,
            badges: [lastObserved.normalBadge, lastObserved.reviewBadge], loading: lastObserved.loading });
        }
        return lastObserved;
      }, { timeout, intervals: [500, 1000, 2000], message: label }).toEqual({
        normalIds: [...expected].sort(), reviewIds: [...pending].sort(), normalBadge: expected.size, reviewBadge: pending.size, loading: false,
      });
      checkpoints.push({ label, elapsedMs: Date.now() - started, normal: expected.size, review: pending.size,
        state: await debug(page!, "getColumnState", { id: "normal" }), badges: await dom() });
      console.log(label, { elapsedMs: Date.now() - started, normal: expected.size, review: pending.size });
    };
    await assertState("initial: all 117 mentions, including 78 replies");
    const initialReadyMs = Date.now() - started;
    await new Promise(resolve => setTimeout(resolve, 300));
    const initialTrace = (await sw.evaluate(() => chrome.storage.local.get("mattermostDeck.traceEntries.v1")))["mattermostDeck.traceEntries.v1"] ?? [];
    await page.screenshot({ path: testInfo.outputPath("13-teams-initial.png"), fullPage: true });

    phase = "unchanged-refresh";
    const before = requests.length;
    const refreshStarted = Date.now();
    await debug(page, "clickMentionControl", { id: "normal", control: "expandControls" });
    expect(await debug(page, "clickMentionControl", { id: "normal", control: "refresh" })).toBe(true);
    await expect.poll(async () => (await debug(page!, "getColumnState", { id: "normal" }))?.mentionLoadActive).toBe(true);
    await assertState("unchanged refresh: stable IDs and both badges");
    const refreshMs = Date.now() - refreshStarted;
    const refreshRequests = requests.slice(before);
    await new Promise(resolve => setTimeout(resolve, 300));
    const afterRefreshTrace = (await sw.evaluate(() => chrome.storage.local.get("mattermostDeck.traceEntries.v1")))["mattermostDeck.traceEntries.v1"] ?? [];
    const summarize = (entries: any[]) => {
      const apiEntries = entries.filter(e => e.source === "api" && e.event === "request.complete");
      const distribution = (values: number[]) => {
        values.sort((a, b) => a - b);
        return { p50: values[Math.floor(values.length * .5)], p95: values[Math.min(values.length - 1, Math.floor(values.length * .95))], max: values.at(-1) };
      };
      return { requests: apiEntries.length, threadRequests: apiEntries.filter(e => /\/posts\/[^/]+\/thread\?/.test(e.payload.fullPath)).length,
        queueWaitMs: distribution(apiEntries.map(e => e.payload.queueWaitMs)), durationMs: distribution(apiEntries.map(e => e.payload.durationMs)),
        errors: entries.filter(e => e.event === "request.error" || (e.payload?.status ?? 0) >= 400) };
    };

    phase = "background-unchanged";
    const beforeBackground = requests.length;
    await debug(page, "reconcileMentions");
    await expect.poll(() => requests.slice(beforeBackground).some(r => /\/teams\/unread$/.test(r.path)), { timeout: 20_000 }).toBe(true);
    await assertState("background unchanged: cached teams retain all posts and badges");
    const unchangedTeamSearches = requests.slice(beforeBackground).filter(r => /\/teams\/[^/]+\/posts\/search$/.test(r.path));
    expect(unchangedTeamSearches).toEqual([]);

    phase = "background-changed-team";
    const beforeChangedTeam = requests.length;
    const changedTeamPost = await api(admin, "POST", "/posts", { channel_id: teams[6].channel.id, message: `@${user.username} changed-team-only` });
    expected.add(changedTeamPost.id); pending.add(changedTeamPost.id);
    await debug(page, "reconcileMentions");
    await expect.poll(() => requests.slice(beforeChangedTeam).some(r => /\/teams\/unread$/.test(r.path)), { timeout: 20_000 }).toBe(true);
    await assertState("background changed team: no missing old or new posts");
    const changedTeamSearches = [...new Set(requests.slice(beforeChangedTeam).filter(r => /\/teams\/[^/]+\/posts\/search$/.test(r.path)).map(r => r.path))];
    expect(changedTeamSearches).toEqual([`/api/v4/teams/${teams[6].id}/posts/search`]);

    phase = "confirm";
    const confirmed = await dom("confirm");
    expect(pending.has(confirmed)).toBe(true);
    pending.delete(confirmed);
    await assertState("confirmed: normal unchanged, review minus one");
    phase = "reload";
    const restartStarted = Date.now();
    if (responsive) {
      // A real browser restart clears chrome.storage.session; only the explicitly
      // enabled local cache should cover the first paint of this new process.
      const url = page.url();
      await context.close();
      context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1600, height: 1000 },
        args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`] });
      sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      page = await context.newPage();
      page.on("pageerror", e => pageErrors.push({ message: e.message, stack: e.stack ?? "" }));
      page.on("response", r => { if (r.url().includes("/api/v4/")) requests.push({ path: new URL(r.url()).pathname, status: r.status(), phase }); });
      await page.addInitScript(() => localStorage.setItem("mattermostDeck.debugLogs", "1"));
      await page.goto(url);
    } else await page.reload();
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 30000 });
    if (responsive) {
      await expect.poll(async () => (await dom()).normal.renderedRows, { timeout: 30000, intervals: [50, 100, 250] }).toBeGreaterThan(0);
      restartFirstPaintMs = Date.now() - restartStarted;
      const firstState = await debug(page, "getColumnState", { id: "normal" });
      restartCachedRows = firstState?.visiblePostIds?.length ?? 0;
      expect(firstState?.mentionCacheActive).toBe(true);
      expect(firstState?.mentionLoadActive).toBe(true);
      expect(restartCachedRows).toBeGreaterThan(0);
      expect(restartCachedRows).toBeLessThanOrEqual(100);
      console.log("browser restart: cached first paint", { restartFirstPaintMs, restartCachedRows });
      await page.screenshot({ path: testInfo.outputPath("cached-first-paint.png"), fullPage: true });
    }
    await assertState("reload: confirmation and badge survive");

    phase = "read-markers";
    await api(token, "POST", "/channels/members/me/view", { channel_id: teams[0].channel.id, collapsed_threads_supported: true });
    for (const post of teams[0].direct) expected.delete(post.id);
    await api(token, "PUT", `/users/${user.id}/teams/${teams[0].id}/threads/${teams[0].roots[0].id}/read/${Date.now()}`);
    expected.delete(teams[0].replies[0].id);
    await assertState("read channel and one thread: unread minus four, review retained");

    phase = "new-reply";
    const added = await api(admin, "POST", "/posts", { channel_id: teams[0].channel.id, root_id: teams[0].roots[0].id, message: `@${user.username} added-during-load` });
    expected.add(added.id); pending.add(added.id);
    await assertState("new reply: cache refreshes and both badges increase");
    phase = "delete";
    const deleted = teams[12].replies[5];
    await api(admin, "DELETE", `/posts/${deleted.id}`);
    expected.delete(deleted.id); pending.delete(deleted.id);
    await assertState("deleted reply in last team: absent from both panes");
    phase = "own-post";
    // Posting can advance the author's channel read marker. Use a channel
    // without pending mentions to isolate exclusion of the author's own post.
    const ownPostChannel = (await api(token, "GET", `/users/me/teams/${teams[12].id}/channels`)).find((c: any) => c.name === "off-topic");
    expect(ownPostChannel).toBeTruthy();
    await api(token, "POST", "/posts", { channel_id: ownPostChannel.id, message: `@${user.username} self-excluded-live` });
    // Force reconciliation so this checks the HTTP path as well as WebSocket filtering.
    await debug(page, "clickMentionControl", { id: "normal", control: "expandControls" });
    await debug(page, "clickMentionControl", { id: "normal", control: "refresh" });
    await expect.poll(async () => (await debug(page!, "getColumnState", { id: "normal" }))?.mentionLoadActive).toBe(true);
    await assertState("own mention: no added row or badge count");
    const summary = { teamCount: 13, unreadThreads: 78, seededMentions: 117,
      responsivePreset: responsive, restartFirstPaintMs, restartCachedRows,
      initialReadyMs, refreshMs, refreshRequestCount: refreshRequests.length,
      unchangedTeamSearchCount: unchangedTeamSearches.length, changedTeamSearches,
      initialThreadRequests: requests.filter(r => r.phase === "initial" && /\/posts\/[^/]+\/thread$/.test(r.path)).length,
      traceNote: "The API trace retains at most 500 entries; initialApi may cover only the tail of initial loading. HTTP request counts are recorded independently.",
      initialApi: summarize(initialTrace), refreshApi: summarize(afterRefreshTrace.filter((e: any) => e.timestamp >= refreshStarted)),
      refreshThreadRequests: refreshRequests.filter(r => /\/posts\/[^/]+\/thread$/.test(r.path)).length,
      checkpoints, pageErrors };
    await fs.writeFile(testInfo.outputPath("13-team-summary.json"), JSON.stringify(summary, null, 2));
    await testInfo.attach("13-team-summary.json", { path: testInfo.outputPath("13-team-summary.json"), contentType: "application/json" });
    // The bundled Playbooks plugin also rejects with this error without the
    // extension. Retain the stack in the report and allow only that source.
    expect(pageErrors.filter(e => !(e.message.trim() === "Not authorized" && e.stack.includes("/static/plugins/playbooks/")))).toEqual([]);
    // The unlicensed 9.5 Docker server returns 501 for mention groups; the API
    // client explicitly falls back to no groups on 403/501. Other 5xx/429 fail.
    expect(requests.filter(r => (r.status === 429 || r.status >= 500)
      && !(r.status === 501 && /^\/api\/v4\/users\/[^/]+\/groups$/.test(r.path)))).toEqual([]);
  } finally {
    if (sw) {
      const data = await sw.evaluate(() => chrome.storage.local.get(["mattermostDeck.traceEntries.v1"])).catch(() => ({}));
      await fs.writeFile(testInfo.outputPath("13-team-trace.json"), JSON.stringify({ trace: data, requests, checkpoints, lastObserved, pageErrors }, null, 2));
      await testInfo.attach("13-team-trace.json", { path: testInfo.outputPath("13-team-trace.json"), contentType: "application/json" });
    }
    await page?.screenshot({ path: testInfo.outputPath("13-teams-final.png"), fullPage: true }).catch(() => {});
    await context?.close();
    for (const team of teams) await api(admin, "DELETE", `/teams/${team.id}`).catch(() => {});
    if (user) await api(admin, "DELETE", `/users/${user.id}`).catch(() => {});
    if (profile.startsWith(path.join(os.tmpdir(), "deck-thirteen-teams-"))) await fs.rm(profile, { recursive: true, force: true });
  }
});
