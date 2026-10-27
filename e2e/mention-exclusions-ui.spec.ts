import { test, expect, chromium, type BrowserContext, type Worker, type Page } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function luminance(css: string): number {
  const channels = css.startsWith("color(srgb")
    ? css.match(/[\d.]+/g)!.slice(0, 3).map(Number)
    : css.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / 255);
  const [r, g, b] = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}

function contrast(a: string, b: string): number {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

test("mention exclusions share author/thread rules, survive browser restart and preserve pending posts", async ({}, testInfo) => {
  const user = { id: "u".repeat(26), username: "reviewuser", notify_props: { mention_keys: "reviewuser", channel: "true" } };
  const alice = { id: "a".repeat(26), username: "alice", first_name: "Alice", notify_props: {} };
  const bob = { id: "b".repeat(26), username: "bob", first_name: "Bob", notify_props: {} };
  const carol = { id: "d".repeat(26), username: "carol", first_name: "Carol", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "Town Square", team_id: team.id, type: "O" };
  const now = Date.now();
  const root = { id: "p".repeat(26), user_id: alice.id, channel_id: channel.id, create_at: now, message: "@reviewuser リリース日程について" };
  const reply = { ...root, id: "r".repeat(26), root_id: root.id, user_id: bob.id, create_at: now + 1, message: "@reviewuser 日程を確認しました。" };
  const unrelated = { ...root, id: "q".repeat(26), user_id: bob.id, create_at: now + 2, message: "@reviewuser 別の会話です。" };
  const future = { ...reply, id: "f".repeat(26), create_at: now + 3, message: "@reviewuser この会話に追加された返信です。" };
  let posts = [unrelated, reply, root];
  let searchRequests = 0;
  const server = createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://localhost").pathname.replace("/api/v4", "");
    if (!req.url?.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><head><style>:root{--sidebar-bg:#1f2f4a;--sidebar-teambar-bg:#16233d;--sidebar-text:#ffffff;--center-channel-bg:#ffffff;--center-channel-color:#3d3c40;--button-bg:#1c58d9;--button-color:#ffffff;--link-color:#1c58d9}</style></head><body class="app__body"><div id="root"><div id="SidebarContainer">Test workspace</div><main class="app__content"><h1 class="channel-header">Town Square</h1></main></div></body></html>');
      return;
    }
    let data: unknown = [];
    if (p === "/system/ping") data = { status: "OK" };
    else if (p === "/users/me") data = user;
    else if (p === "/users/ids") data = [user, alice, bob];
    else if (p === "/users/search") data = [alice, bob, carol];
    else if (p === "/users/me/teams") data = [team];
    else if (p.endsWith("/teams/unread")) data = [{ team_id: team.id, msg_count: posts.length, mention_count: posts.length }];
    else if (p.startsWith("/config/client")) data = { CollapsedThreads: "disabled" };
    else if (p.endsWith("/channels/members")) data = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: posts.length }];
    else if (p.endsWith("/channels")) data = [channel];
    else if (p.includes("/channels/name/") || p === `/channels/${channel.id}`) data = channel;
    else if (p.endsWith("/posts/search")) { searchRequests++; data = { order: posts.map(x => x.id), posts: Object.fromEntries(posts.map(x => [x.id, x])) }; }
    else if (p.endsWith("/posts") || p.endsWith("/thread")) data = { order: posts.map(x => x.id), posts: Object.fromEntries(posts.map(x => [x.id, x])) };
    else if (p === `/posts/${root.id}`) data = root;
    else if (p.endsWith(`/members/${user.id}`)) data = { user_id: user.id, channel_id: channel.id, last_viewed_at: 0, mention_count: posts.length };
    else if (p.includes("/threads")) data = { total: 0, threads: [] };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "deck-mention-exclusions-"));
  let context: BrowserContext;
  let sw: Worker;
  let page: Page;
  const errors: string[] = [];
  const launch = async (configure = false) => {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, viewport: { width: 1600, height: 1000 },
      args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
    });
    sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    if (configure) await sw.evaluate(({ origin }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light",
      "mattermostDeck.pollingIntervalSeconds.v1": 3600, "mattermostDeck.postClickAction.v1": "navigate",
      "mattermostDeck.layout.v1": [{ id: "mentions", type: "mentions" }, { id: "review", type: "mentions", mentionReview: true }],
    }), { origin });
    page = context.pages().find(candidate => candidate.url().startsWith(origin)) ?? await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/testteam/channels/town-square`);
    await page.bringToFront();
    // A persistent browser can restore a previous tab after a new tab is opened.
    // Bind script inspection to this exact test page instead of the first URL match.
    await page.evaluate(() => { document.title = "Mention exclusions fixture target"; });
    await page.locator("#mattermost-deck-root").waitFor({ state: "attached", timeout: 15_000 });
  };
  const inspect = (selector: string, action: "read" | "click" | "check" | "uncheck" | "focus" = "read") => sw.evaluate(async ({ origin, selector, action }) => {
    const tab = (await chrome.tabs.query({})).find(candidate => candidate.url?.startsWith(origin) && candidate.title === "Mention exclusions fixture target");
    if (!tab?.id) return null;
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selector, action) => {
      const host = document.getElementById("mattermost-deck-root");
      const shadow = host && (chrome as any).dom.openOrClosedShadowRoot(host);
      const element = shadow?.querySelector(selector) as HTMLElement | null;
      if (element && action !== "read") {
        element.focus();
        if (action === "click") element.click();
        if ((action === "check" || action === "uncheck") && (element as HTMLInputElement).checked !== (action === "check")) element.click();
      }
      const rect = element?.getBoundingClientRect();
      return element ? { text: element.textContent, count: shadow.querySelectorAll(selector).length, expanded: element.getAttribute("aria-expanded"), pressed: element.getAttribute("aria-pressed"), checked: (element as HTMLInputElement).checked, disabled: (element as HTMLButtonElement).disabled,
        actionOpacity: getComputedStyle(element.closest(".deck-mention-actions") ?? element).opacity,
        background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color,
        theme: shadow.querySelector(".deck-shell")?.getAttribute("data-theme"),
        left: rect!.left, top: rect!.top, width: rect!.width, height: rect!.height } : null;
    }, args: [selector, action] });
    return result.result;
  }, { origin, selector, action });
  const normal = '[data-deck-column-id="mentions"]';
  const review = '[data-deck-column-id="review"]';
  const post = (pane: string, id: string) => `${pane} [data-deck-mention-menu="${id}"]`;
  const openControls = async (pane: string) => {
    const toggle = `${pane} .deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)`;
    if ((await inspect(toggle))?.expanded !== "true") await inspect(toggle, "click");
  };
  const expectPresentBoth = async (id: string) => {
    try {
      await expect.poll(() => inspect(post(normal, id)), { timeout: 15_000 }).not.toBeNull();
      await expect.poll(() => inspect(post(review, id)), { timeout: 15_000 }).not.toBeNull();
    } catch (error) {
      console.log("Exclusion fixture state", { normal: await inspect(normal), review: await inspect(review), errors, searchRequests });
      throw error;
    }
  };
  const expectAbsentBoth = async (id: string) => {
    await expect.poll(() => inspect(post(normal, id))).toBeNull();
    await expect.poll(() => inspect(post(review, id))).toBeNull();
  };
  try {
    await launch(true);
    await expectPresentBoth(root.id);
    await expectPresentBoth(reply.id);
    const baseline = searchRequests;
    const routeBefore = page.url();
    await page.mouse.move(30, 30);
    const rootCard = `${normal} .deck-card--post:has([data-deck-mention-menu="${root.id}"])`;
    await expect.poll(async () => (await inspect(`${rootCard} .deck-card-author`))?.text).toMatch(/Alice|alice/);
    const cardBeforeHover = (await inspect(rootCard))!;
    const authorBeforeHover = (await inspect(`${rootCard} .deck-card-author`))!;
    expect(cardBeforeHover.left + cardBeforeHover.width - authorBeforeHover.left - authorBeforeHover.width).toBeLessThan(18);
    expect((await inspect(post(normal, root.id)))?.actionOpacity).toBe("0");
    await inspect(post(normal, root.id), "focus");
    expect((await inspect(post(normal, root.id)))?.actionOpacity).toBe("1");
    await page.mouse.click(30, 30);
    expect((await inspect(post(normal, root.id)))?.actionOpacity).toBe("0");
    const menuButton = (await inspect(post(normal, root.id)))!;
    await page.mouse.move(menuButton.left - 80, menuButton.top + menuButton.height / 2);
    expect((await inspect(post(normal, root.id)))?.actionOpacity).toBe("1");
    const authorAfterHover = (await inspect(`${rootCard} .deck-card-author`))!;
    expect(authorAfterHover.left).toBeCloseTo(authorBeforeHover.left, 1);
    expect(authorAfterHover.width).toBeCloseTo(authorBeforeHover.width, 1);
    await page.screenshot({ path: testInfo.outputPath("mention-menu-overlays-author.png"), fullPage: true });
    await page.mouse.click(menuButton.left + menuButton.width / 2, menuButton.top + menuButton.height / 2);
    await page.mouse.move(30, 30);
    expect((await inspect(post(normal, root.id)))?.actionOpacity).toBe("1");
    await expect.poll(async () => (await inspect(`${normal} [data-deck-exclude-user]`))?.disabled).toBe(false);
    // Mattermost can combine a dark sidebar with white content panels.
    // Hover must follow the menu's surface, not the sidebar/shell background.
    for (const theme of ["light", "mattermost", "dark"]) {
      await sw.evaluate(theme => chrome.storage.local.set({ "mattermostDeck.theme.v1": theme }), theme);
      await expect.poll(async () => (await inspect(normal))?.theme).toBe(theme);
      const hoverTarget = (await inspect(`${normal} [data-deck-exclude-user]`))!;
      await page.mouse.move(hoverTarget.left + hoverTarget.width / 2, hoverTarget.top + hoverTarget.height / 2);
      const hovered = (await inspect(`${normal} [data-deck-exclude-user]`))!;
      expect(contrast(hovered.color, hovered.background)).toBeGreaterThanOrEqual(4.5);
      if (theme === "mattermost") {
        expect(luminance(hovered.background)).toBeGreaterThan(.75);
        await page.screenshot({ path: testInfo.outputPath("mention-exclusion-mixed-theme-hover.png"), fullPage: true });
      }
    }
    await sw.evaluate(() => chrome.storage.local.set({ "mattermostDeck.theme.v1": "light" }));
    await expect.poll(async () => (await inspect(normal))?.theme).toBe("light");
    await page.screenshot({ path: testInfo.outputPath("mention-exclusion-post-menu.png"), fullPage: true });
    const excludeUser = (await inspect(`${normal} [data-deck-exclude-user]`))!;
    await page.mouse.click(excludeUser.left + excludeUser.width / 2, excludeUser.top + excludeUser.height / 2);
    await expectAbsentBoth(root.id);
    await expectPresentBoth(reply.id);
    expect(page.url()).toBe(routeBefore);
    expect(searchRequests).toBe(baseline);
    await context.close();
    await launch();
    await expectPresentBoth(reply.id);
    await expectAbsentBoth(root.id);
    await openControls(review);
    await expect.poll(() => inspect(`${review} [data-deck-excluded-user="${alice.id}"]`)).not.toBeNull();
    await inspect(`${review} [data-deck-restore-excluded-user="${alice.id}"]`, "click");
    await expectPresentBoth(root.id);
    // Thread exclusion from a reply must hide its root and all authors' replies.
    await inspect(post(normal, reply.id), "click");
    await inspect(`${normal} [data-deck-exclude-thread]`, "click");
    await expectAbsentBoth(root.id);
    await expectAbsentBoth(reply.id);
    await expectPresentBoth(unrelated.id);
    await inspect(`${review} [data-deck-show-excluded]`, "check");
    await expect.poll(() => inspect(post(review, root.id))).not.toBeNull();
    await expect.poll(() => inspect(post(review, reply.id))).not.toBeNull();
    expect(await inspect(post(normal, root.id))).toBeNull();
    await expect.poll(() => inspect(`${review} [data-deck-post-excluded="true"]`)).not.toBeNull();
    await inspect(`${review} [data-deck-show-excluded]`, "uncheck");
    await expectAbsentBoth(root.id);
    posts = [future, ...posts];
    const beforeRefresh = searchRequests;
    await inspect(`${review} button[title="Refresh"]`, "click");
    await expect.poll(() => searchRequests).toBeGreaterThan(beforeRefresh);
    await expectAbsentBoth(future.id);
    await context.close();
    await launch();
    await expectPresentBoth(unrelated.id);
    await expectAbsentBoth(root.id);
    await expectAbsentBoth(reply.id);
    await expectAbsentBoth(future.id);
    await openControls(normal);
    await expect.poll(() => inspect(`${normal} [data-deck-excluded-thread="${root.id}"]`)).not.toBeNull();
    await inspect(`${normal} [data-deck-restore-excluded-thread="${root.id}"]`, "click");
    await expectPresentBoth(root.id);
    await expectPresentBoth(reply.id);
    await expectPresentBoth(future.id);
    // Search can add a user who has not authored a loaded post.
    await inspect(`${normal} [data-deck-exclusion-user-search]`, "focus");
    await page.keyboard.type("carol");
    await expect.poll(() => inspect(`${normal} [data-deck-exclusion-user-result="${carol.id}"]`)).not.toBeNull();
    const searchResult = (await inspect(`${normal} [data-deck-exclusion-user-result="${carol.id}"]`))!;
    await page.mouse.move(searchResult.left + searchResult.width / 2, searchResult.top + searchResult.height / 2);
    const hoveredResult = (await inspect(`${normal} [data-deck-exclusion-user-result="${carol.id}"]`))!;
    expect(contrast(hoveredResult.color, hoveredResult.background)).toBeGreaterThanOrEqual(4.5);
    await inspect(`${normal} [data-deck-exclusion-user-result="${carol.id}"]`, "click");
    await openControls(review);
    await expect.poll(() => inspect(`${review} [data-deck-excluded-user="${carol.id}"]`)).not.toBeNull();
    await inspect(post(normal, root.id), "click");
    await inspect(`${normal} [data-deck-exclude-thread]`, "click");
    await expectAbsentBoth(root.id);
    await sw.evaluate(() => chrome.storage.local.set({ "mattermostDeck.language.v1": "ja" }));
    await expect.poll(async () => (await inspect(`${review} [data-deck-exclusion-controls]`))?.text).toContain("表示の除外");
    await page.screenshot({ path: testInfo.outputPath("mention-exclusions.png"), fullPage: true });
    const touch = await context.newCDPSession(page);
    await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await expect.poll(async () => (await inspect(post(normal, unrelated.id)))?.actionOpacity).toBe("1");
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (!profile.startsWith(path.join(os.tmpdir(), "deck-mention-exclusions-"))) throw new Error("Unexpected temporary profile path");
    await fs.rm(profile, { recursive: true, force: true });
  }
});
