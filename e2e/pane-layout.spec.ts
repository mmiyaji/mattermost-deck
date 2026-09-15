import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("pane sizing and two-row layouts stay usable and persist", async ({}, testInfo) => {
  const user = { id: "u".repeat(26), username: "favoriteuser", first_name: "Favorite", last_name: "User", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), name: "town-square", display_name: "開発チームの共有チャンネル / Product discussions and release planning", team_id: team.id, type: "O" };
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
      "mattermostDeck.preferredColumnWidth.v1": "260",
      "mattermostDeck.railWidth.v1": 900,
      "mattermostDeck.preferredRailWidth.v1": "900",
      "mattermostDeck.layout.v1": [{ id: "watch", type: "channelWatch", channelId: channel.id, teamId: team.id }, { id: "favorites", type: "favorites" }, { id: "watch2", type: "channelWatch", channelId: channel.id, teamId: team.id }, { id: "saved", type: "saved" }],
    }), { origin, channel, team });
    const page = await context.newPage();
    await page.goto(`${origin}/testteam/channels/town-square`);
    const inspect = (selector: string, click: boolean | "focus" | "compose-start" | "compose-end" | "text" = false) => sw.evaluate(async ({ origin, selector, click }) => {
      const tab = (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin));
      if (!tab?.id) return null;
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selector, click) => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host);
        const el = (click === "text" ? [...root.querySelectorAll("button")].find((button: HTMLElement) => button.textContent?.trim() === selector) : root?.querySelector(selector)) as HTMLElement | null;
        if (click === "focus") el?.focus();
        else if (click === "compose-start" || click === "compose-end") el?.dispatchEvent(new CompositionEvent(click === "compose-start" ? "compositionstart" : "compositionend", { bubbles: true }));
        else if (click) el?.click();
        return el ? { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, text: el.textContent, pressed: el.getAttribute("aria-pressed"), value: el.getAttribute("aria-valuenow"), expanded: el.getAttribute("aria-expanded"), borderStyle: getComputedStyle(el).borderTopStyle, opacity: getComputedStyle(el).opacity, paddingLeft: getComputedStyle(el).paddingLeft, paddingRight: getComputedStyle(el).paddingRight, bottom: el.getBoundingClientRect().bottom, top: el.getBoundingClientRect().top, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left } : null;
      }, args: [selector, click] });
      return result.result;
    }, { origin, selector, click });

    const pane = '.deck-column--channel';
    const handle = '.deck-column-motion .deck-column-resize';
    await expect.poll(async () => (await inspect(pane))?.width).toBe(260);
    // Check actual rendered controls instead of just container scrollWidth.
    const geometry = () => sw.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: () => {
        const root = (chrome as any).dom.openOrClosedShadowRoot(document.getElementById('mattermost-deck-root'));
        const panes = [...root.querySelectorAll('.deck-column-motion > .deck-column')] as HTMLElement[];
        return panes.map(pane => {
          const r = pane.getBoundingClientRect();
          const controls = [...pane.querySelectorAll('.deck-column-header button, .mm-custom-select-button, .deck-select')] as HTMLElement[];
          const visible = controls.filter(c => c.getBoundingClientRect().width > 0);
          return { x: r.x, y: r.y, width: r.width, height: r.height, controls: visible.length,
            contained: visible.every(c => { const b = c.getBoundingClientRect(); return b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom; }) };
        });
      } });
      return result.result!;
    }, origin);
    const controlsToggle = pane + ' .deck-column-header [aria-expanded]:not(.deck-pane-search-toggle)';
    if ((await inspect(controlsToggle))?.expanded === 'false') await inspect(controlsToggle, true);
    await expect.poll(async () => (await geometry())[0].controls).toBeGreaterThan(3);
    expect((await geometry()).every(p => p.contained)).toBe(true);

    await expect.poll(async () => (await inspect('[data-pane-id="watch"] h2'))?.text).toContain(channel.display_name);
    const compactHeader = await sw.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({target:{tabId:tab!.id!},func:()=> {
        const root = (chrome as any).dom.openOrClosedShadowRoot(document.getElementById('mattermost-deck-root'));
        const pane = root.querySelector('.deck-column--channel');
        const heading = pane.querySelector('.deck-column-heading').getBoundingClientRect();
        const actions = pane.querySelector('.deck-column-actions').getBoundingClientRect();
        const buttons = [...pane.querySelectorAll('.deck-stack--controls > .deck-inline-actions:first-child button')].map((b:any)=>b.getBoundingClientRect());
        return { headerHeight:pane.querySelector('.deck-column-header').getBoundingClientRect().height,
          controlHeight:pane.querySelector('.deck-stack--controls > .deck-inline-actions').getBoundingClientRect().height,
          sameHeaderRow:Math.abs(heading.top-actions.top)<2,
          titleContained:heading.right <= pane.querySelector(".deck-column-header").getBoundingClientRect().right, titleTooltip:pane.querySelector("h2").title, buttonRows:new Set(buttons.map((b:any)=>Math.round(b.top))).size,
          buttonCount:buttons.length, minButtonWidth:Math.min(...buttons.map((b:any)=>b.width)) };
      }}); return result.result!;
    }, origin);
    console.log('minimum-width header/control geometry', compactHeader);
    expect(compactHeader.sameHeaderRow).toBe(true);
    expect(compactHeader.titleContained).toBe(true);
    expect(compactHeader.titleTooltip).toBe(channel.display_name);
    expect(compactHeader.buttonCount).toBe(6);
    expect(compactHeader.buttonRows).toBe(1);
    expect(compactHeader.minButtonWidth).toBeGreaterThanOrEqual(28);
    await page.screenshot({path: testInfo.outputPath('minimum-width.png')});
    const headerActions = '[data-pane-id="watch"] .deck-column-actions';
    const headerHeading = '[data-pane-id="watch"] .deck-column-heading';
    await page.mouse.click(30, 30);
    await expect.poll(async () => (await inspect(headerActions))?.opacity).toBe('0');
    const quietHeading = (await inspect(headerHeading))!;
    const headerBounds = (await inspect('[data-pane-id="watch"] .deck-column-header'))!;
    expect(quietHeading.right).toBe(headerBounds.right);
    await page.screenshot({path: testInfo.outputPath('header-quiet.png')});
    await page.mouse.move(quietHeading.left + 40, quietHeading.top + 100);
    await expect.poll(async () => (await inspect(headerActions))?.opacity).toBe('1');
    expect((await inspect(headerHeading))!.width).toBe(quietHeading.width);
    await page.screenshot({path: testInfo.outputPath('header-hover.png')});
    const searchToggle = (await inspect('[data-pane-id="watch"] .deck-pane-search-toggle'))!;
    await page.mouse.click(searchToggle.left + 14, searchToggle.top + 14);
    await expect.poll(async () => (await inspect('[data-pane-id="watch"] .deck-pane-search input'))?.width).toBeGreaterThan(0);
    await page.mouse.click(30, 30);
    expect((await inspect(headerActions))!.opacity).toBe('1');
    await inspect('[data-pane-id="watch"] .deck-pane-search input', 'focus');
    await page.keyboard.press('Escape');
    await page.mouse.move(30, 30);
    expect((await inspect(headerActions))!.opacity).toBe('1'); // keyboard focus remains on the toggle
    await page.keyboard.press('Tab');
    expect((await inspect(headerActions))!.opacity).toBe('1');
    await page.keyboard.press('Enter'); // fold controls by keyboard
    await expect.poll(async () => (await inspect('[data-pane-id="watch"] .deck-column-actions > button:last-child'))?.expanded).toBe('false');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await inspect('[data-pane-id="watch"] .deck-column-actions > button:last-child'))?.expanded).toBe('true');
    await page.mouse.click(30, 30);
    expect((await inspect(headerActions))!.opacity).toBe('0');
    const touch = await context.newCDPSession(page);
    await touch.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect((await inspect(headerActions))!.opacity).toBe('1');
    await touch.send('Emulation.setTouchEmulationEnabled', {enabled: false});
    await touch.detach();
    const before = await inspect(handle);
    await page.mouse.move(before!.right - 6, before!.top + 100);
    await page.mouse.down();
    await page.mouse.move(before!.right + 94, before!.top + 100, {steps: 8});
    await page.mouse.up();
    await expect.poll(async () => (await geometry())[0].width).toBe(360);
    expect((await geometry())[1].width).toBe(260);
    await page.reload();
    await expect.poll(async () => (await inspect(pane))?.width).toBe(360);
    await inspect(handle, 'focus');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await inspect(pane))?.width).toBe(350);
    await page.keyboard.press('Home');
    await expect.poll(async () => (await inspect(pane))?.width).toBe(260);
    // Open Views through its real button and switch layout.
    await inspect('[aria-controls="mattermost-deck-views-menu"]', true);
    await expect.poll(async () => (await inspect('.deck-layout-mode'))?.text).toContain('Two rows');
    await inspect('.deck-layout-mode button:nth-child(2)', true);
    await expect.poll(async () => (await geometry())[2].y > (await geometry())[0].y + 100).toBe(true);
    const grid = await geometry();
    expect(grid[0].y).toBe(grid[1].y);
    expect(grid[2].y).toBe(grid[3].y);
    expect(Math.abs(grid[0].height - grid[2].height)).toBeLessThan(2);
    expect(grid.every(p => p.contained)).toBe(true);
    // Resize the row boundary with a real pointer and retain the ratio after reload.
    const divider = '.deck-row-resize';
    const boundary = (await inspect(divider))!;
    const dragX = boundary.left + 40;
    const dragY = boundary.top + 6;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX, dragY + (grid[0].height + grid[2].height) * 0.15, {steps: 8});
    await page.mouse.up();
    await expect.poll(async () => (await inspect(divider))?.value).toBe('65');
    const resized = await geometry();
    expect(resized[0].height / (resized[0].height + resized[2].height)).toBeCloseTo(0.65, 2);

    await page.reload();
    await expect.poll(async () => (await inspect('.deck-columns--two-rows'))?.width).toBeGreaterThan(0);
    await expect.poll(async () => (await geometry())?.length ?? 0).toBe(4);
    await expect.poll(async () => (await inspect(divider))?.value).toBe('65');
    await inspect(divider, 'focus');
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await inspect(divider))?.value).toBe('63');
    const resetBoundary = (await inspect(divider))!;
    await page.mouse.dblclick(resetBoundary.left + 40, resetBoundary.top + 6);
    await expect.poll(async () => (await inspect(divider))?.value).toBe('50');
    const equalBoundary = (await inspect(divider))!;
    await page.mouse.move(equalBoundary.left + 40, equalBoundary.top + 6);
    await page.mouse.down();
    await page.mouse.move(equalBoundary.left + 40, equalBoundary.top + 80);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(async () => (await inspect(divider))?.value).toBe('50');
    await inspect(divider, 'focus');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(async () => (await inspect(divider))?.value).toBe('60');

    await expect.poll(async () => (await inspect(pane + ' .deck-card--post'))?.text).toContain(post.message);
    await expect.poll(async () => (await inspect('.deck-column--saved .deck-card--post'))?.text).toContain(post.message);
    await page.screenshot({path: testInfo.outputPath('two-rows.png')});
    // Expanding a short pane scrolls its body, never moves the toggle under the pointer.
    const collapseToggle = '[data-pane-id="watch2"] .deck-column-actions > button:last-child';
    const bodySelector = '[data-pane-id="watch2"] .deck-column-body';
    const closedToggle = (await inspect(collapseToggle))!;
    expect(closedToggle.expanded).toBe('false');
    await page.mouse.move(closedToggle.left + 14, closedToggle.top + 14);
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.mouse.down(); await page.mouse.up();
      await expect.poll(async () => (await inspect(collapseToggle))?.expanded).toBe('true');
      expect((await inspect(collapseToggle))!.left).toBe(closedToggle.left);
      expect((await inspect(collapseToggle))!.top).toBe(closedToggle.top);
      const body = (await inspect(bodySelector))!;
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
      await page.mouse.down(); await page.mouse.up();
      await expect.poll(async () => (await inspect(collapseToggle))?.expanded).toBe('false');
      expect((await inspect(collapseToggle))!.left).toBe(closedToggle.left);
      expect((await inspect(collapseToggle))!.top).toBe(closedToggle.top);
    }
    await page.mouse.down(); await page.mouse.up();
    await expect.poll(async () => (await inspect(collapseToggle))?.expanded).toBe('true');
    const scrollBody = (await inspect(bodySelector))!;
    await page.mouse.move(scrollBody.left + 60, scrollBody.top + 60);
    await page.mouse.wheel(0, 350);
    await expect.poll(async () => (await inspect(bodySelector))?.scrollTop).toBeGreaterThan(0);
    expect((await inspect(collapseToggle))!.left).toBe(closedToggle.left);
    expect((await inspect(collapseToggle))!.top).toBe(closedToggle.top);
    expect((await inspect('[data-pane-id="watch2"] .deck-column'))!.scrollTop).toBe(0);
    await page.screenshot({path: testInfo.outputPath('fixed-collapse-header.png')});
    await page.mouse.click(closedToggle.left + 14, closedToggle.top + 14);
    await expect.poll(async () => (await inspect(collapseToggle))?.expanded).toBe('false');
    // The lower row can be resized independently, and cancellation never saves.
    const lowerHandle = '.deck-column-row:nth-child(2) .deck-column-resize';
    const low = (await inspect(lowerHandle))!;
    await page.mouse.move(low.left + 5, low.top + 80);
    await page.mouse.down();
    await page.mouse.move(low.left + 85, low.top + 80, {steps: 5});
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect((await geometry())[2].width).toBe(260);
    await inspect(lowerHandle, 'focus');
    await page.keyboard.press('End');
    await expect.poll(async () => (await geometry())[2].width).toBe(480);
    expect((await geometry())[0].width).toBe(260);
    expect((await geometry())[1].x).toBe(grid[1].x);
    const lowerNeighborX = (await geometry())[3].x;
    await inspect(handle, 'focus');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await geometry())[0].width).toBe(270);
    expect((await geometry())[3].x).toBe(lowerNeighborX);
    await page.keyboard.press('Home');
    await inspect(lowerHandle, 'focus');
    await page.keyboard.press('Home');
    // Focus mode fills the rail and returns to the same two-row layout.
    await inspect(controlsToggle, true);
    await inspect(pane + ' [aria-label="Focus pane"]', true);
    await expect.poll(async () => (await inspect('.deck-columns--focus'))?.width).toBeGreaterThan(800);
    await inspect(pane + ' .deck-column-header [aria-label="Exit focus"]', true);
    await expect.poll(async () => (await inspect('.deck-columns--two-rows'))?.width).toBeGreaterThan(0);

    await inspect('[aria-controls="mattermost-deck-views-menu"]', true);
    page.once('dialog', dialog => dialog.accept('Two-row workspace'));
    await inspect('Save current set', 'text');
    await expect.poll(async () => {
      const data = await sw.evaluate(() => chrome.storage.local.get('mattermostDeck.savedViews.v1'));
      const stored = data['mattermostDeck.savedViews.v1'];
      const views = typeof stored === 'string' ? JSON.parse(stored) : stored;
      return {mode: views?.[0]?.layoutMode, split: views?.[0]?.rowSplit};
    }).toEqual({mode: 'twoRows', split: 60});
    await inspect('[aria-controls="mattermost-deck-views-menu"]', true);
    await inspect('.deck-layout-mode button:first-child', true);
    await expect.poll(async () => { const g = await geometry(); return g.length === 4 && g.every(p => p.y === g[0].y); }).toBe(true);
    await expect.poll(async () => (await inspect(handle))?.width).toBeGreaterThan(0);
    expect(await inspect(divider)).toBeNull();
    const rowEdge = (await inspect(pane))!;
    await page.mouse.move(rowEdge.right - 2, (rowEdge.top + rowEdge.bottom) / 2);
    await page.mouse.down();
    await page.mouse.move(rowEdge.right + 68, (rowEdge.top + rowEdge.bottom) / 2, {steps: 8});
    await page.mouse.up();
    await expect.poll(async () => (await inspect(pane))?.width).toBe(330);
    await inspect('[aria-controls="mattermost-deck-views-menu"]', true);
    await inspect('.deck-add-menu--views .deck-add-item--recent', true);
    await expect.poll(async () => (await inspect(divider))?.value).toBe('60');
    await expect.poll(async () => (await inspect('.deck-columns--two-rows'))?.width).toBeGreaterThan(0);

    // Both rows overflow: native horizontal wheel input must affect only the hovered row.
    for (let row = 1; row <= 2; row++) {
      for (let column = 1; column <= 2; column++) {
        await inspect('.deck-column-row:nth-child(' + row + ') .deck-pane-frame:nth-child(' + column + ') .deck-column-resize', 'focus');
        await page.keyboard.press('End');
      }
    }
    const rowScroll = (action = '') => sw.evaluate(async ({origin, action}) => {
      const tab = (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({target:{tabId:tab!.id!},func:(action) => {
        const root = (chrome as any).dom.openOrClosedShadowRoot(document.getElementById('mattermost-deck-root'));
        const scrollers = [...root.querySelectorAll('.deck-row-scroll')] as HTMLElement[];
        if (action === 'end') scrollers.forEach(row => { row.scrollLeft = row.scrollWidth; });
        if (action === 'endOuter') root.querySelector('.deck-scroll-wrap').scrollLeft = root.querySelector('.deck-scroll-wrap').scrollWidth;
        if (action === 'resetOuter') root.querySelector('.deck-scroll-wrap').scrollLeft = 0;
        if (action === 'reset') scrollers.forEach(row => { row.scrollLeft = 0; });
        if (action === 'lastView') (root.querySelectorAll('.deck-menu-row--view .deck-add-item')[3] as HTMLElement)?.click();
        return { outer: root.querySelector('.deck-scroll-wrap').scrollLeft, rows: scrollers.map(row => ({
          left: row.scrollLeft, max: row.scrollWidth - row.clientWidth, x: row.getBoundingClientRect().left, y: row.getBoundingClientRect().top,
        })) };
      }, args:[action]});
      return result.result!;
    }, {origin, action});
    const scroll = await rowScroll('reset');
    expect(scroll.rows.every(row => row.max > 0)).toBe(true);
    const fixedBoundary = (await inspect(divider))!;
    await page.mouse.move(scroll.rows[0].x + 100, scroll.rows[0].y + 80);
    await page.mouse.wheel(180, 0);
    await expect.poll(async () => (await rowScroll()).rows[0].left).toBeGreaterThan(0);
    expect((await rowScroll()).rows[1].left).toBe(0);
    const topLeft = (await rowScroll()).rows[0].left;
    await page.mouse.move(scroll.rows[1].x + 100, scroll.rows[1].y + 80);
    await page.mouse.wheel(140, 0);
    await expect.poll(async () => (await rowScroll()).rows[1].left).toBeGreaterThan(0);
    expect((await rowScroll()).rows[0].left).toBe(topLeft);
    expect((await rowScroll()).outer).toBe(0);
    expect((await inspect(divider))!.left).toBe(fixedBoundary.left);
    await page.screenshot({path:testInfo.outputPath('independent-scroll.png')});
    await rowScroll('reset');
    await inspect('[aria-controls="mattermost-deck-views-menu"]', true);
    await rowScroll('lastView');
    await expect.poll(async () => (await rowScroll()).rows[1].left).toBeGreaterThan(0);
    expect((await rowScroll()).rows[0].left).toBe(0);

    const order = () => sw.evaluate(async () => {
      const data = await chrome.storage.local.get('mattermostDeck.layout.v1');
      const raw = data['mattermostDeck.layout.v1'];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return (Array.isArray(parsed) ? parsed : parsed.columns).map((p:any) => p.id);
    });
    await rowScroll('reset');
    const sourceTitle = (await inspect('[data-pane-id="watch"] h2'))!;
    const lowerTarget = (await inspect('[data-pane-id="watch2"]'))!;
    await page.mouse.move(sourceTitle.left + 35, sourceTitle.top + 8);
    await page.mouse.down();
    await page.mouse.move(lowerTarget.left + 300, lowerTarget.top + 30, {steps: 10});
    await expect.poll(async () => (await inspect('[data-drop-side="after"]'))?.width).toBeGreaterThan(0);
    const slot = (await inspect('.deck-drop-placeholder'))!;
    expect(slot.borderStyle).toBe('dashed');
    expect(slot.width).toBe(480);
    expect((await inspect('.deck-drag-ghost'))!.width).toBeGreaterThan(0);
    expect((await inspect('[data-pane-id="watch"]'))!.width).toBe(0);
    // A stationary pointer must not make the slot oscillate between neighbours.
    await page.waitForTimeout(250);
    expect((await inspect('.deck-drop-placeholder'))!.left).toBe(slot.left);
    expect((await inspect('.deck-drop-placeholder'))!.top).toBe(slot.top);
    await page.screenshot({path: testInfo.outputPath('drag-between-rows.png')});
    await sw.evaluate(() => chrome.storage.local.set({'mattermostDeck.theme.v1': 'dark'}));
    await expect.poll(async () => (await inspect('.deck-shell[data-theme="dark"]'))?.width).toBeGreaterThan(0);
    await page.screenshot({path: testInfo.outputPath('drag-between-rows-dark.png')});
    await sw.evaluate(() => chrome.storage.local.set({'mattermostDeck.theme.v1': 'light'}));
    await expect.poll(async () => (await inspect('.deck-shell[data-theme="light"]'))?.width).toBeGreaterThan(0);
    await page.mouse.up();
    await expect.poll(order).toEqual(['favorites', 'watch2', 'watch', 'saved']);
    await expect.poll(async () => await inspect('.deck-pane-frame[style*="translate"]')).toBeNull();
    expect((await inspect('[data-pane-id="watch"]'))!.left).toBe(slot.left);
    expect((await inspect('[data-pane-id="watch"]'))!.top).toBe(slot.top);
    expect(await inspect('.deck-drop-placeholder')).toBeNull();
    expect(await inspect('.deck-drag-ghost')).toBeNull();
    await page.reload();
    await expect.poll(async () => (await geometry())?.length ?? 0).toBe(4);
    expect(await order()).toEqual(['favorites', 'watch2', 'watch', 'saved']);
    await inspect('[aria-controls="mattermost-deck-views-menu"]', true);
    await inspect('.deck-layout-mode button:first-child', true);
    const firstTitle = (await inspect('[data-pane-id="favorites"] h2'))!;
    const secondPane = (await inspect('[data-pane-id="watch2"]'))!;
    await page.mouse.move(firstTitle.left + 25, firstTitle.top + 8);
    await page.mouse.down();
    await page.mouse.move(secondPane.left + 280, secondPane.top + 35, {steps: 10});
    await page.mouse.up();
    await expect.poll(order).toEqual(['watch2', 'favorites', 'watch', 'saved']);
    await expect.poll(async () => await inspect('.deck-pane-frame[style*="translate"]')).toBeNull();
    const cancelTitle = (await inspect('[data-pane-id="watch2"] h2'))!;
    const cancelTarget = (await inspect('[data-pane-id="favorites"]'))!;
    await page.mouse.move(cancelTitle.left + 30, cancelTitle.top + 8);
    await page.mouse.down();
    await page.mouse.move(cancelTarget.left + 270, cancelTarget.top + 30, {steps: 10});
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await order()).toEqual(['watch2', 'favorites', 'watch', 'saved']);
    expect(await inspect('.deck-columns--dragging')).toBeNull();
    expect(await inspect('.deck-drop-placeholder')).toBeNull();
    expect(await inspect('.deck-drag-ghost')).toBeNull();
    // Releasing outside the deck cancels instead of accepting the last hovered slot.
    const outsideTitle = (await inspect('[data-pane-id="watch2"] h2'))!;
    await page.mouse.move(outsideTitle.left + 30, outsideTitle.top + 8);
    await page.mouse.down();
    await page.mouse.move(cancelTarget.left + 270, cancelTarget.top + 30, {steps: 10});
    await page.mouse.move(30, 30, {steps: 5});
    await expect.poll(async () => (await inspect('.deck-drag-ghost--outside'))?.opacity).toBe('0.5');
    await page.mouse.up();
    expect(await order()).toEqual(['watch2', 'favorites', 'watch', 'saved']);
    expect(await inspect('.deck-drop-placeholder')).toBeNull();
    expect(await inspect('.deck-drag-ghost')).toBeNull();
    expect((await inspect('[data-pane-id="watch2"]'))!.width).toBe(480);
    // After cancellations, a reverse move still commits and leaves React's DOM usable.
    const reverseTitle = (await inspect('[data-pane-id="favorites"] h2'))!;
    const reverseTarget = (await inspect('[data-pane-id="watch2"]'))!;
    await page.mouse.move(reverseTitle.left + 25, reverseTitle.top + 8);
    await page.mouse.down();
    await page.mouse.move(reverseTarget.left + 80, reverseTarget.top + 30, {steps: 10});
    await page.mouse.up();
    await expect.poll(order).toEqual(['favorites', 'watch2', 'watch', 'saved']);
    await page.reload();
    await expect.poll(async () => (await geometry())?.length ?? 0).toBe(4);
    expect(await order()).toEqual(['favorites', 'watch2', 'watch', 'saved']);
    // Add controls belong to the scroll content, never a permanently reserved strip.
    const viewport = (await inspect('.deck-scroll-wrap'))!;
    expect((await inspect('.deck-column-add-button'))!.left).toBeGreaterThan(viewport.right);
    await rowScroll('endOuter');
    const rowAdd = (await inspect('.deck-column-add-button'))!;
    expect(rowAdd.right).toBeLessThanOrEqual(viewport.right);
    await page.mouse.click(rowAdd.left + 18, rowAdd.top + 18);
    await expect.poll(async () => (await inspect('.deck-add-menu--tail'))?.width).toBeGreaterThan(0);
    await rowScroll('resetOuter');
    await expect.poll(async () => await inspect('.deck-add-menu--tail')).toBeNull();
    await inspect('[aria-controls="mattermost-deck-views-menu"]', true);
    await inspect('.deck-layout-mode button:last-child', true);
    await rowScroll('reset');
    expect((await inspect('.deck-columns--two-rows'))!.paddingRight).toBe('0px');
    for (const row of [1, 2]) {
      const scroller = (await inspect('.deck-column-row:nth-child(' + row + ') .deck-row-scroll'))!;
      const add = (await inspect('.deck-column-row:nth-child(' + row + ') .deck-column-add-button'))!;
      expect(add.left).toBeGreaterThanOrEqual(scroller.right);
    }
    await page.screenshot({path: testInfo.outputPath('add-button-hidden.png')});
    await rowScroll('end');
    for (const row of [1, 2]) {
      const scroller = (await inspect('.deck-column-row:nth-child(' + row + ') .deck-row-scroll'))!;
      const add = (await inspect('.deck-column-row:nth-child(' + row + ') .deck-column-add-button'))!;
      expect(add.right).toBeLessThanOrEqual(scroller.right);
    }
    await page.screenshot({path: testInfo.outputPath('add-button-at-end.png')});
    const lowerAdd = (await inspect('.deck-column-row:nth-child(2) .deck-column-add-button'))!;
    await page.mouse.click(lowerAdd.left + 18, lowerAdd.top + 18);
    await expect.poll(async () => (await inspect('.deck-add-menu--tail'))?.width).toBeGreaterThan(0);
    expect((await inspect('.deck-column-row:first-child .deck-column-add-button'))!.expanded).toBe('false');
    expect((await inspect('.deck-column-row:nth-child(2) .deck-column-add-button'))!.expanded).toBe('true');
    await inspect('.deck-add-menu--tail .deck-add-item', true);
    await expect.poll(async () => (await order()).length).toBe(5);
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(profile, { recursive: true, force: true });
  }
});
