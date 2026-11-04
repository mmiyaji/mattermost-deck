import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";
import { readTraceEntries, setTraceCapture } from "./trace-storage";

const serverScope = `${process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066"}/`;
const privacyType = "mattermost-deck:body-cache-privacy";
const mentionType = "mattermost-deck:mention-cache-storage";
const favoriteType = "mattermost-deck:favorite-cache-storage";
const reviewType = "mattermost-deck:review-storage";
const accounts = ["privacy-user-a", "privacy-user-b"];
const member = (userId: string) => ({ id: `favorite-${userId}`, revision: `revision-${userId}`, addedAt: 100 });
const favoriteScope = (userId: string) => JSON.stringify([serverScope, userId]);
const favoriteKey = (userId: string) => `mattermostDeck.favorites.v1:${encodeURIComponent(serverScope)}:${encodeURIComponent(userId)}`;
const reviewPrefix = (userId: string) => `mattermostDeck.mentionReview.v1:${encodeURIComponent(serverScope)}:${encodeURIComponent(userId)}:`;
const cacheKey = (userId: string) => JSON.stringify([serverScope, userId, "all"]);

async function send(page: Page, message: Record<string, unknown>): Promise<any> {
  const result = await page.evaluate(message => chrome.runtime.sendMessage(message), message);
  expect(result?.success, JSON.stringify(result)).toBe(true);
  return result;
}

async function launch(profile: string, freshInstall = true): Promise<{ context: BrowserContext; worker: Worker; page: Page }> {
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = freshInstall ? await waitForInstalledOptions(context, worker) : await context.newPage();
  if (!freshInstall) await page.goto(new URL("options.html", worker.url()).href);
  await page.evaluate(() => chrome.storage.local.set({ "mattermostDeck.language.v1": "en" }));
  await page.reload();
  await expect(page.locator(".options-app")).toHaveAttribute("data-loaded", "true");
  return { context, worker, page };
}

async function seed(page: Page, userId: string, requestStartedAt = Date.now() - 1000) {
  const now = Date.now();
  const post = { id: member(userId).id, user_id: "privacy-author", channel_id: "privacy-channel", create_at: 1, update_at: 2,
    message: `Private body for ${userId}` };
  const membership = member(userId);
  await page.evaluate(async ({ key, membership }) => chrome.storage.local.set({ [key]: [membership] }), { key: favoriteKey(userId), membership });
  const snapshot = { version: 1, serverScope, userId, scopeTeamId: null, savedAt: now, requestStartedAt,
    teamIds: ["privacy-team"], mentionSignature: "privacy-fixture", fingerprint: `${userId}-${now}`,
    posts: [post], readState: { channelLastViewedAt: {}, threadLastViewedAt: {}, activeChannelIds: null } };
  for (const persist of [true, false]) await send(page, { type: mentionType, operation: "put", persist, key: cacheKey(userId), snapshot });
  await send(page, { type: favoriteType, operation: "put", scope: favoriteScope(userId),
    entries: [{ id: post.id, revision: membership.revision, checkedAt: now, requestStartedAt, post }] });
  const prefix = reviewPrefix(userId);
  await send(page, { type: reviewType, operation: "write", prefix, sets: {
    [`${prefix}post:*:${post.id}`]: true, [`${prefix}body:${post.id}`]: post, [`${prefix}confirmed:${post.id}`]: 77,
    [`${prefix}post:*:pending-${userId}`]: true,
    [`${prefix}body:pending-${userId}`]: { ...post, id: `pending-${userId}`, message: `Unconfirmed retained body for ${userId}` },
  } });
  return { snapshot, post, requestStartedAt, now };
}

async function bodies(page: Page, userId: string) {
  const persistent = await send(page, { type: mentionType, operation: "get", persist: true, key: cacheKey(userId) });
  const session = await send(page, { type: mentionType, operation: "get", persist: false, key: cacheKey(userId) });
  const favorite = await send(page, { type: favoriteType, operation: "get", scope: favoriteScope(userId), members: [member(userId)] });
  return { persistent: persistent.snapshot ?? null, session: session.snapshot ?? null, favorites: favorite.entries ?? [] };
}

async function expectJudgments(page: Page, userId: string) {
  const prefix = reviewPrefix(userId), favorite = member(userId);
  const values = (await send(page, { type: reviewType, operation: "get", prefix })).values;
  const post = { id: favorite.id, user_id: "privacy-author", channel_id: "privacy-channel", create_at: 1, update_at: 2,
    message: `Private body for ${userId}` };
  expect(values).toEqual({
    [`${prefix}post:*:${favorite.id}`]: true, [`${prefix}body:${favorite.id}`]: post, [`${prefix}confirmed:${favorite.id}`]: 77,
    [`${prefix}post:*:pending-${userId}`]: true,
    [`${prefix}body:pending-${userId}`]: { ...post, id: `pending-${userId}`, message: `Unconfirmed retained body for ${userId}` },
  });
  expect(await page.evaluate(async key => (await chrome.storage.local.get(key))[key], favoriteKey(userId))).toEqual([favorite]);
}

async function expectNoBodies(page: Page, userId: string) {
  expect(await bodies(page, userId)).toEqual({ persistent: null, session: null, favorites: [] });
  await expectJudgments(page, userId);
}

test("manual body-cache deletion spans all accounts, preserves judgments, and rejects late writes across restart", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-cache-privacy-"));
  let running: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    running = await launch(profile);
    let page = running.page;
    const original = new Map<string, Awaited<ReturnType<typeof seed>>>();
    for (const userId of accounts) {
      original.set(userId, await seed(page, userId));
      const stored = await bodies(page, userId);
      expect(stored.persistent?.posts[0]?.message).toContain(userId);
      expect(stored.session?.posts[0]?.message).toContain(userId);
      expect(stored.favorites[0]?.post?.message).toContain(userId);
    }
    await page.getByTestId("options-nav-performance").click();
    await expect(page.getByTestId("performance-cache-on")).toBeChecked();
    page.on("dialog", dialog => dialog.accept());
    await page.getByTestId("options-clear-body-cache").click();
    await expect.poll(async () => (await bodies(page, accounts[0])).persistent).toBeNull();
    for (const userId of accounts) await expectNoBodies(page, userId);
    await page.screenshot({ path: testInfo.outputPath("manual-body-cache-cleared.png"), fullPage: true });

    // A response that started before deletion must not resurrect its contents,
    // even when its completion/saved time is after the clear operation.
    for (const userId of accounts) {
      const prior = original.get(userId)!;
      const now = Date.now();
      for (const persist of [true, false]) await send(page, { type: mentionType, operation: "put", persist, key: cacheKey(userId),
        snapshot: { ...prior.snapshot, savedAt: now, fingerprint: `late-${now}` } });
      await send(page, { type: favoriteType, operation: "put", scope: favoriteScope(userId), entries: [{ id: prior.post.id,
        revision: member(userId).revision, checkedAt: now, requestStartedAt: prior.requestStartedAt, post: prior.post }] });
      await expectNoBodies(page, userId);
    }
    await running.context.close();
    running = await launch(profile, false);
    page = running.page;
    for (const userId of accounts) await expectNoBodies(page, userId);
    // Clearing the cache is not a permanent ban: a new fetch may cache again.
    const fresh = await seed(page, accounts[0], Date.now());
    const restored = await bodies(page, accounts[0]);
    expect(restored.persistent?.posts[0]?.message).toBe(fresh.post.message);
    expect(restored.session?.posts[0]?.message).toBe(fresh.post.message);
    expect(restored.favorites[0]?.post?.message).toBe(fresh.post.message);
    await expectJudgments(page, accounts[0]);
    for (const userId of accounts.slice(1)) await expectNoBodies(page, userId);
    await fs.writeFile(testInfo.outputPath("body-cache-privacy-summary.json"), JSON.stringify({ accounts: accounts.length,
      defaultEnabled: true, manualAllAccountClear: true, judgmentsPreserved: true, lateWritesRejected: true,
      restartPreservedDeletion: true, freshFetchAllowed: true }, null, 2));
  } finally {
    await running?.context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});

test("scoped privacy invalidation removes one account's bodies and leaves another account intact", async () => {
  test.setTimeout(90_000);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-cache-privacy-scope-"));
  const running = await launch(profile);
  try {
    for (const userId of accounts) await seed(running.page, userId);
    await send(running.page, { type: privacyType, operation: "clear", reason: "auth", scope: { serverScope, userId: accounts[0] } });
    await expectNoBodies(running.page, accounts[0]);
    const other = await bodies(running.page, accounts[1]);
    expect(other.persistent?.posts[0]?.message).toContain(accounts[1]);
    expect(other.session?.posts[0]?.message).toContain(accounts[1]);
    expect(other.favorites[0]?.post?.message).toContain(accounts[1]);
    await expectJudgments(running.page, accounts[1]);
  } finally {
    await running.context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});

test("background maintenance physically removes expired bodies without deleting registrations or fresh caches", async () => {
  test.setTimeout(90_000);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-cache-privacy-expiry-"));
  const running = await launch(profile);
  try {
    const page = running.page;
    for (const userId of accounts) await seed(page, userId);
    await page.evaluate(async ({ mentionKey, favoriteScope }) => {
      const expiredAt = Date.now() - 8 * 24 * 60 * 60_000;
      const mutate = (name: string, stores: string[], edit: (transaction: IDBTransaction) => void) => new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result, transaction = database.transaction(stores, "readwrite");
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => { database.close(); resolve(); };
          edit(transaction);
        };
      });
      await mutate("mattermostDeck.mentionCache", ["snapshots", "metadata"], transaction => {
        for (const name of ["snapshots", "metadata"]) {
          const store = transaction.objectStore(name), get = store.get(mentionKey);
          get.onsuccess = () => {
            if (!get.result) throw new Error(`Missing seeded ${name}`);
            const record = { ...get.result, savedAt: expiredAt };
            if (name === "snapshots") store.put(record, mentionKey); else store.put(record);
          };
        }
      });
      await mutate("mattermostDeck.favoriteBodies", ["metadata"], transaction => {
        const store = transaction.objectStore("metadata"), cursor = store.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          if (row.value.scope === favoriteScope) row.update({ ...row.value, checkedAt: expiredAt });
          row.continue();
        };
      });
      const sessionKey = "mattermostDeck.mentionFeedCache.v1";
      const registry = (await chrome.storage.session.get(sessionKey))[sessionKey];
      registry.entries[mentionKey].savedAt = expiredAt;
      await chrome.storage.session.set({ [sessionKey]: registry });
    }, { mentionKey: cacheKey(accounts[0]), favoriteScope: favoriteScope(accounts[0]) });

    const rawState = () => page.evaluate(async ({ mentionKey, favoriteScope }) => {
      const read = (name: string, storeName: string) => new Promise<any[]>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result, transaction = database.transaction(storeName, "readonly"), request = transaction.objectStore(storeName).getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
          transaction.oncomplete = () => database.close();
        };
      });
      const session = (await chrome.storage.session.get("mattermostDeck.mentionFeedCache.v1"))["mattermostDeck.mentionFeedCache.v1"];
      return { mentionSnapshots: (await read("mattermostDeck.mentionCache", "snapshots")).length,
        mentionMetadata: (await read("mattermostDeck.mentionCache", "metadata")).length,
        favoriteBodies: (await read("mattermostDeck.favoriteBodies", "bodies")).length,
        favoriteMetadata: (await read("mattermostDeck.favoriteBodies", "metadata")).filter(entry => entry.scope === favoriteScope).length,
        expiredSessionPresent: Boolean(session?.entries?.[mentionKey]) };
    }, { mentionKey: cacheKey(accounts[0]), favoriteScope: favoriteScope(accounts[0]) });
    expect(await rawState()).toEqual({ mentionSnapshots: 2, mentionMetadata: 2, favoriteBodies: 2, favoriteMetadata: 1, expiredSessionPresent: true });
    const rejected = await page.evaluate(type => chrome.runtime.sendMessage({ type, operation: "prune" }), privacyType);
    expect(rejected).toMatchObject({ success: false, error: expect.stringContaining("background-only") });
    await running.worker.evaluate(() => chrome.alarms.create("mattermost-deck-body-cache-expiry", { when: Date.now() + 100 }));
    await expect.poll(rawState, { timeout: 45_000, intervals: [100, 250, 1000] }).toEqual({ mentionSnapshots: 1,
      mentionMetadata: 1, favoriteBodies: 1, favoriteMetadata: 0, expiredSessionPresent: false });
    for (const userId of accounts) await expectJudgments(page, userId);
    const fresh = await bodies(page, accounts[1]);
    expect(fresh.persistent?.posts[0]?.message).toContain(accounts[1]);
    expect(fresh.session?.posts[0]?.message).toContain(accounts[1]);
    expect(fresh.favorites[0]?.post?.message).toContain(accounts[1]);
  } finally {
    await running.context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});

async function debug(page: Page, action: string, payload: Record<string, unknown> = {}): Promise<any> {
  return page.evaluate(({ action, payload }) => new Promise(resolve => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener("mattermost-deck-debug-response", listener); resolve(null); }, 5000);
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("mattermost-deck-debug-response", listener);
      resolve(detail.result);
    };
    window.addEventListener("mattermost-deck-debug-response", listener);
    window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", { detail: { id, action, payload } }));
  }), { action, payload });
}

test("real Mattermost session expiry, logout and post-access 403 clear bodies while feature 403 does not", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const origin = serverScope.replace(/\/$/, "");
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local Docker fixture only");
  const state = JSON.parse(await fs.readFile(process.env.MM95_STATE_FILE ?? "e2e/mm95-state.json", "utf8"));
  const adminLogin = await fetch(`${origin}/api/v4/users/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: state.adminUser.username, password: state.adminUser.password }) });
  if (!adminLogin.ok || !adminLogin.headers.get("Token")) throw new Error(`Fixture admin login: ${adminLogin.status}`);
  const adminToken = adminLogin.headers.get("Token")!;
  const api = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`${origin}/api/v4${route}`, { method,
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`Fixture ${method} ${route}: ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const suffix = Date.now().toString();
  const password = `DeckPrivacy-${suffix}!aA`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-cache-privacy-live-"));
  let running: Awaited<ReturnType<typeof launch>> | undefined;
  let user: any, team: any;
  try {
    user = await api("POST", "/users", { username: `deckprivacy${suffix}`, email: `deckprivacy${suffix}@example.test`, password });
    team = await api("POST", "/teams", { name: `privacy${suffix}`, display_name: "Cache privacy E2E", type: "O" });
    await api("POST", `/teams/${team.id}/members`, { team_id: team.id, user_id: user.id });
    const channels = await api("GET", `/teams/${team.id}/channels`);
    const watched = channels.find((channel: any) => channel.name === "off-topic");
    expect(watched).toBeTruthy();
    running = await launch(profile);
    const { context, worker } = running;
    const options = running.page;
    await worker.evaluate(({ origin, watched, teamId }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light",
      "mattermostDeck.pollingIntervalSeconds.v1": "3600", "mattermostDeck.allowedRouteKinds.v1": "channels",
      "mattermostDeck.apiMinStartGapMs.v1": "0", "mattermostDeck.apiGlobalRequestsPerMinute.v1": "1200",
      "mattermostDeck.apiGetRequestsPerMinute.v1": "1200", "mattermostDeck.apiPostRequestsPerMinute.v1": "600",
      "mattermostDeck.layout.v1": [{ id: "privacy-watch", type: "channelWatch", teamId, channelId: watched.id }],
    }), { origin, watched, teamId: team.id });
    await setTraceCapture(context,worker,true);
    const login = await context.request.post(`${origin}/api/v4/users/login`, { data: { login_id: user.username, password } });
    expect(login.ok()).toBe(true);
    const app = await context.newPage();
    await app.addInitScript(() => localStorage.setItem("mattermostDeck.debugLogs", "1"));
    const groupPattern = `**/api/v4/users/${user.id}/groups*`;
    let group403s = 0;
    await app.route(groupPattern, async route => { group403s++; await route.fulfill({ status: 403, contentType: "application/json", body: '{}' }); });
    const channelUrl = `${origin}/${team.name}/channels/town-square`;
    const ready = async () => {
      const browserChoice = app.getByRole("link", { name: "View in Browser", exact: true });
      const loginId = app.locator('input[name="loginId"]');
      await Promise.race([browserChoice.waitFor({ state: "visible", timeout: 30_000 }),
        loginId.waitFor({ state: "visible", timeout: 30_000 }),
        app.locator("#mattermost-deck-root").waitFor({ state: "attached", timeout: 30_000 })]);
      if (await browserChoice.isVisible()) await browserChoice.click();
      await Promise.race([loginId.waitFor({ state: "visible", timeout: 30_000 }),
        app.locator("#mattermost-deck-root").waitFor({ state: "attached", timeout: 30_000 })]);
      if (await loginId.isVisible()) {
        await loginId.fill(user.username);
        await app.locator('input[name="password-input"]').fill(password);
        await app.getByRole("button", { name: /log in/i }).click();
      }
      await expect(app.locator("#mattermost-deck-root")).toBeAttached({ timeout: 30_000 });
      await expect.poll(async () => (await debug(app, "getState"))?.stateStatus, { timeout: 30_000 }).toBe("ready");
      await expect.poll(async () => (await debug(app, "getColumnState", { id: "privacy-watch" }))?.channelStatus, { timeout: 30_000 }).toBe("ready");
      await expect.poll(async () => worker.evaluate(async ({ serverScope, userId }) => {
        const entries = Object.entries(await chrome.storage.session.get(null));
        return entries.some(([key, value]) => key.startsWith("mattermostDeck.bodyCacheSession.v1:") && value?.serverScope === serverScope && value?.userId === userId);
      }, { serverScope, userId: user.id }), { timeout: 15_000 }).toBe(true);
    };
    await app.goto(channelUrl);
    await ready();
    console.log("privacy lifecycle: authenticated Deck ready");
    await seed(options, user.id, Date.now());
    await seed(options, accounts[1], Date.now());
    const beforeFeature = group403s;
    await app.reload();
    await ready();
    await expect.poll(() => group403s).toBeGreaterThan(beforeFeature);
    // Check the extension's own API trace, not merely a similar native-client
    // request, so this proves its feature-level 403 path does not purge bodies.
    await expect.poll(async () => {
      const entries=await readTraceEntries(context,worker,{requestsOnly:true,query:`/users/${user.id}/groups`});
      return entries.some(entry=>entry.source==="api"&&entry.event==="request.complete"&&entry.payload?.status===403);
    }, { timeout: 10_000 }).toBe(true);
    const afterFeature = await bodies(options, user.id);
    expect(afterFeature.persistent?.posts[0]?.message).toContain(user.id);
    expect(afterFeature.session?.posts[0]?.message).toContain(user.id);
    expect(afterFeature.favorites[0]?.post?.message).toContain(user.id);
    await expectJudgments(options, user.id);
    console.log("privacy lifecycle: feature 403 retains all bodies");

    const postPattern = `**/api/v4/channels/${watched.id}/posts**`;
    let accessFailures = 0;
    const deny = (status: number) => app.route(postPattern, async route => {
      accessFailures++;
      await route.fulfill({ status, contentType: "application/json", body: '{}' });
    });
    const refreshWatch = async () => {
      const click = (control: "expand" | "refresh") => worker.evaluate(async ({ origin, control }) => {
        const tab = (await chrome.tabs.query({ url: `${origin}/*` })).find(tab => tab.id !== undefined);
        if (!tab?.id) return false;
        const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [control], func: control => {
          const host = document.getElementById("mattermost-deck-root");
          const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
          const pane = root?.querySelector('[data-pane-id="privacy-watch"]');
          if (control === "expand" && pane?.querySelector(".deck-stack--controls")) return true;
          const button = pane?.querySelector(control === "expand" ? ".deck-column-actions > button:last-child" : '.deck-stack--controls button[title="Refresh"]') as HTMLButtonElement | null;
          if (!button || button.disabled) return false;
          button.click();
          return true;
        } });
        return Boolean(result.result);
      }, { origin, control });
      await expect.poll(() => click("expand"), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => click("refresh"), { timeout: 10_000 }).toBe(true);
    };
    await deny(403);
    // A just-completed read may still be coalesced by the one-second GET
    // cache. Retry the actual refresh control until a new transport request starts.
    await expect.poll(async () => { if (!accessFailures) await refreshWatch(); return accessFailures; },
      { timeout: 15_000, intervals: [1000] }).toBeGreaterThan(0);
    await expect.poll(async () => (await bodies(options, user.id)).persistent, { timeout: 15_000 }).toBeNull();
    await expectNoBodies(options, user.id);
    expect((await bodies(options, accounts[1])).persistent?.posts[0]?.message).toContain(accounts[1]);
    expect((await worker.evaluate(() => chrome.storage.session.get("mattermostDeck.bodyCachePrivacyChanged.v1")))["mattermostDeck.bodyCachePrivacyChanged.v1"]?.reason).toBe("permission");
    console.log("privacy lifecycle: post-access 403 clears only the affected account");

    await app.unroute(postPattern);
    await app.reload();
    await ready();
    await seed(options, user.id, Date.now());
    accessFailures = 0;
    await deny(401);
    // A just-completed read may still be coalesced by the one-second GET
    // cache. Retry the actual refresh control until a new transport request starts.
    await expect.poll(async () => { if (!accessFailures) await refreshWatch(); return accessFailures; },
      { timeout: 15_000, intervals: [1000] }).toBeGreaterThan(0);
    await expect.poll(async () => (await bodies(options, user.id)).persistent, { timeout: 15_000 }).toBeNull();
    await expectNoBodies(options, user.id);
    expect((await worker.evaluate(() => chrome.storage.session.get("mattermostDeck.bodyCachePrivacyChanged.v1")))["mattermostDeck.bodyCachePrivacyChanged.v1"]?.reason).toBe("auth");
    console.log("privacy lifecycle: API 401 clears bodies");

    await app.unroute(postPattern);
    await app.reload();
    await ready();
    await seed(options, user.id, Date.now());
    const csrf = (await context.cookies(origin)).find(cookie => cookie.name === "MMCSRF")?.value;
    const logout = await context.request.post(`${origin}/api/v4/users/logout`, { headers: csrf ? { "X-CSRF-Token": csrf } : {} });
    expect(logout.ok()).toBe(true);
    await app.goto(`${origin}/login?extra=expired`);
    await expect.poll(async () => (await bodies(options, user.id)).persistent, { timeout: 20_000 }).toBeNull();
    await expectNoBodies(options, user.id);
    expect((await bodies(options, accounts[1])).persistent?.posts[0]?.message).toContain(accounts[1]);
    expect((await worker.evaluate(() => chrome.storage.session.get("mattermostDeck.bodyCachePrivacyChanged.v1")))["mattermostDeck.bodyCachePrivacyChanged.v1"]?.reason).toBe("logout");
    await fs.writeFile(testInfo.outputPath("mattermost-body-cache-lifecycle-summary.json"), JSON.stringify({
      feature403PreservedBodies: true, post403ClearedBodies: true, api401ClearedBodies: true,
      logoutClearedBodies: true, otherAccountPreserved: true, fullReviewRecordsPreserved: true,
    }, null, 2));
  } finally {
    await running?.context.close();
    if (team) await api("DELETE", `/teams/${team.id}`).catch(() => undefined);
    if (user) await api("DELETE", `/users/${user.id}`).catch(() => undefined);
    await fs.rm(profile, { recursive: true, force: true });
  }
});

test("opting out deletes every persisted mention cache without an open Deck while keeping session, favorite and review data", async () => {
  test.setTimeout(90_000);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-cache-privacy-opt-out-"));
  const running = await launch(profile);
  try {
    const page = running.page;
    await page.getByTestId("options-nav-conn").click();
    await page.locator("#mattermost-server-url").fill(serverScope);
    await page.getByTestId("options-save").click();
    await expect(page.getByTestId("options-save")).toBeDisabled();
    for (const userId of accounts) await seed(page, userId);
    await page.getByTestId("options-nav-performance").click();
    const persistence = page.getByTestId("performance-cache-on");
    await expect(persistence).toBeChecked();
    await page.getByTestId("performance-cache-off").check();
    await page.getByTestId("options-save").click();
    await expect(page.getByTestId("options-save")).toBeDisabled();
    for (const userId of accounts) {
      const remaining = await bodies(page, userId);
      expect(remaining.persistent).toBeNull();
      expect(remaining.session?.posts[0]?.message).toContain(userId);
      expect(remaining.favorites[0]?.post?.message).toContain(userId);
      await expectJudgments(page, userId);
    }
    await page.reload();
    await page.getByTestId("options-nav-performance").click();
    await expect(page.getByTestId("performance-cache-on")).not.toBeChecked();
  } finally {
    await running.context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
