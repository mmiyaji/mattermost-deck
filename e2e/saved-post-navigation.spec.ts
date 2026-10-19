import { chromium, expect, test, type Page, type Worker } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");

interface State {
  team: { id: string; name: string };
  teamName?: string;
  adminUser: { username: string; password: string };
  memberUser: { id: string; username: string; password: string; token: string };
}
interface Channel { id: string; name: string }
interface Post { id: string; channel_id: string; message: string; root_id?: string }
type ClosedRootChrome = typeof chrome & {
  dom: { openOrClosedShadowRoot(element: HTMLElement): ShadowRoot | null };
};

async function api<T>(token: string, method: string, endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v4${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

async function login(page: Page, state: State): Promise<void> {
  await page.goto(`${baseUrl}/landing#/login`);
  const browserChoice = page.getByText("View in Browser");
  const loginId = page.locator('input[name="loginId"]');
  await Promise.race([
    browserChoice.waitFor({ state: "visible" }).catch(() => undefined),
    loginId.waitFor({ state: "visible" }).catch(() => undefined),
  ]);
  if (await browserChoice.isVisible()) await browserChoice.click();
  await loginId.fill(state.memberUser.username);
  await page.locator('input[name="password-input"]').fill(state.memberUser.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/channels|messages/);
}

async function inspectSavedCard(worker: Worker, message: string, scroll: boolean) {
  return worker.evaluate(async ({ baseUrl, message, scroll }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(baseUrl));
    if (!tab?.id) throw new Error("Mattermost tab not found");
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (message: string, scroll: boolean) => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as ClosedRootChrome).dom.openOrClosedShadowRoot(host);
        const card = Array.from(root?.querySelectorAll<HTMLElement>(".deck-column--saved .deck-card--post") ?? [])
          .find(card => card.textContent?.includes(message));
        if (!card) return null;
        if (scroll) card.scrollIntoView({ block: "center" });
        const rect = card.getBoundingClientRect();
        const viewport = card.closest(".deck-list-viewport")?.getBoundingClientRect();
        return {
          clickable: card.classList.contains("deck-card--clickable"),
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          visible: Boolean(viewport && rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1),
        };
      },
      args: [message, scroll],
    });
    return injection.result;
  }, { baseUrl, message, scroll });
}

test("saved posts open in their owning team despite missing or colliding channel names", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const state = JSON.parse(await fs.readFile(stateFile, "utf8")) as State;
  const loginResponse = await fetch(`${baseUrl}/api/v4/users/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: state.adminUser.username, password: state.adminUser.password }),
  });
  expect(loginResponse.ok).toBe(true);
  const adminToken = loginResponse.headers.get("Token");
  if (!adminToken) throw new Error("Admin token unavailable");
  const suffix = Date.now();
  const posts: Post[] = [];
  let team: { id: string; name: string } | undefined;
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  const flags = () => posts.map(post => ({
    user_id: state.memberUser.id, category: "flagged_post", name: post.id, value: "true",
  }));
  const evidence: Array<Record<string, unknown>> = [];
  let activePage: Page | undefined;

  try {
    team = await api<{ id: string; name: string }>(adminToken, "POST", "/teams", { name: `savednav${suffix}`, display_name: "Saved navigation audit", type: "O" });
    await api(adminToken, "POST", `/teams/${team.id}/members`, { team_id: team.id, user_id: state.memberUser.id });
    const channels = await api<Channel[]>(adminToken, "GET", `/teams/${team.id}/channels`);
    const sameNameChannel = channels.find(channel => channel.name === "town-square");
    if (!sameNameChannel) throw new Error("Default channel unavailable");
    const distinctChannel = await api<Channel>(adminToken, "POST", "/channels", {
      team_id: team.id, name: `savednav${suffix}`, display_name: "Other team only", type: "O",
    });
    await api(adminToken, "POST", `/channels/${distinctChannel.id}/members`, { user_id: state.memberUser.id });
    const distinctRoot = await api<Post>(adminToken, "POST", "/posts", {
      channel_id: distinctChannel.id, message: `saved-navigation-distinct-${suffix}`,
    });
    posts.push(distinctRoot);
    posts.push(await api<Post>(adminToken, "POST", "/posts", {
      channel_id: sameNameChannel.id, message: `saved-navigation-collision-${suffix}`,
    }));
    posts.push(await api<Post>(adminToken, "POST", "/posts", {
      channel_id: distinctChannel.id, root_id: distinctRoot.id, message: `saved-navigation-reply-${suffix}`,
    }));
    await api(state.memberUser.token, "PUT", `/users/${state.memberUser.id}/preferences`, flags());

    context = await chromium.launchPersistentContext("", {
      channel: "chromium", headless: true, viewport: { width: 1800, height: 900 },
      args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await worker.evaluate(({ baseUrl }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": baseUrl,
      "mattermostDeck.language.v1": "en",
      "mattermostDeck.postClickAction.v1": "ask",
      "mattermostDeck.preferredRailWidth.v1": "360",
      "mattermostDeck.layout.v1": [{ id: "saved", type: "saved" }],
    }), { baseUrl });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(15_000);
    await login(page, state);

    for (const [index, post] of posts.entries()) {
      // Make channel metadata available before clicking: otherwise the former
      // bug could be hidden by its temporary permalink fallback during loading.
      const metadata = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/v4/channels/${post.channel_id}` && response.ok(),
      );
      await page.goto(`${baseUrl}/${state.teamName ?? state.team.name}/channels/town-square`);
      await metadata;
      await expect.poll(async () => (await inspectSavedCard(worker, post.message, true))?.visible).toBe(true);
      await page.waitForTimeout(250);
      const card = await inspectSavedCard(worker, post.message, false);
      expect(card?.clickable).toBe(true);
      if (!card?.visible) throw new Error("Saved post is not visible");
      const confirmation = page.waitForEvent("dialog").then(async dialog => {
        const kind = dialog.type();
        await dialog.accept();
        return kind;
      });
      const [kind] = await Promise.all([confirmation, page.mouse.click(card.x, card.y)]);
      expect(kind).toBe("confirm");
      // Mattermost may canonicalize a permalink to the owning channel URL,
      // removing the post ID after focusing it. Check both context and content.
      const expectedChannel = index === 1 ? sameNameChannel : distinctChannel;
      await expect(page).toHaveURL(new RegExp(`/${team.name}/(?:pl/${post.id}|channels/${expectedChannel.name}(?:/${post.id})?)$`));
      // Reply nodes in the native RHS use different IDs from timeline posts.
      // Match the unique fixture message inside Mattermost, excluding Deck.
      await expect(page.locator("#root").getByText(post.message, { exact: true }).last()).toBeVisible();
      await expect(page.getByText("Channel Not Found", { exact: true })).toHaveCount(0);
      evidence.push({ case: index === 0 ? "distinct-channel-name" : index === 1 ? "colliding-channel-name" : "reply", correctTeam: true, targetPostVisible: true, confirmedByPointer: true });
      await page.screenshot({ path: testInfo.outputPath(`saved-navigation-${index}.png`) });
    }
    await fs.writeFile(testInfo.outputPath("saved-navigation.json"), JSON.stringify({ baseUrl, evidence }, null, 2));
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path: testInfo.outputPath("saved-navigation-failure.png") });
      await fs.writeFile(testInfo.outputPath("saved-navigation-failure.json"), JSON.stringify({
        url: activePage.url(),
        nativeText: await activePage.locator("#root").innerText().catch(() => ""),
        nativePostIds: await activePage.locator('#root [id^="post_"]').evaluateAll(elements => elements.map(element => element.id)),
        expectedPostIds: posts.map(post => post.id),
      }, null, 2));
    }
    throw error;
  } finally {
    await context?.close();
    if (posts.length) await api(state.memberUser.token, "POST", `/users/${state.memberUser.id}/preferences/delete`, flags());
    for (const post of [...posts].reverse()) await api(adminToken, "DELETE", `/posts/${post.id}`);
    if (team) await api(adminToken, "DELETE", `/teams/${team.id}`);
  }
});
