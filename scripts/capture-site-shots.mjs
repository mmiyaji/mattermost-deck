/**
 * Captures the screenshots used by the site design mock (mock/deck-tone.html).
 *
 * Needs the Mattermost test server from scripts/mm95-start.mjs and a development
 * build (`npm run build`). For each language and theme it writes, into --out:
 *   overview-<theme>-<lang>.png  (1720x948, row layout)
 *   two-rows-<theme>-<lang>.png  (1720x948, two-row layout)
 *   wide-<theme>-<lang>.png      (1720x620, row layout)
 *   rhs-<theme>-<lang>.png       (1720x620, a thread open in the right pane)
 *   rects-<theme>-<lang>.json    (x positions of Deck and the right pane)
 *
 * Usage: node scripts/capture-site-shots.mjs [--langs ja,en] [--out mock/shots]
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const languages = argValue("langs", "ja,en").split(",").map((value) => value.trim()).filter(Boolean);
const outDir = path.resolve(argValue("out", "./mock/shots"));
const extensionPath = path.resolve("./dist");
const captureProfileId = "site-capture-profile";
const OVERVIEW_CAPTURE_RAIL_WIDTH = 880;
const TALL = 948;
const SHORT = 620;
const headless = process.env.README_CAPTURE_HEADLESS !== "0";
const statePath =
  process.env.MM95_STATE_FILE ??
  process.env.CAB_MATTERMOST_E2E_STATE_FILE ??
  path.resolve("./e2e/mm95-state.json");

const SHOWCASE_CHANNEL = {
  name: "readme-showcase",
  displayName: "README Showcase",
  type: "O",
  header: "README screenshot showcase channel",
  purpose: "Mattermost Deck README capture",
};

// Posts per language. The older posts push the channel introduction out of view.
const POSTS = {
  en: {
    welcome: "Welcome to the README showcase channel.",
    threadKey: "final notes are ready",
    earlier: [
      ["memberUser", "The staging deploy finished without errors."],
      ["bridgeUser", "Release notes draft is in the wiki."],
      ["bridgeUser", "I moved the rollback steps to the top of the page."],
      ["memberUser", "Smoke test list is updated for the new build."],
      ["bridgeUser", "Which build are we shipping on Thursday?"],
      ["memberUser", "The one from this morning. CI is green."],
      ["memberUser", "I will check the dashboards again after lunch."],
      ["bridgeUser", "Thanks. Ping me if the error rate moves."],
      ["memberUser", "Support asked for a short status for the customer."],
      ["bridgeUser", "I will write it once the checklist is done."],
    ],
    showcase: [
      "@cab-bridge Please review the release checklist before 10:00.",
      "@cab-bridge The final notes are ready after the smoke test.",
      "Support handoff and the FAQ draft are ready for publishing.",
    ],
    dm: [
      "@cab-bridge Can you post the deployment summary here when ready?",
      "I only need a short summary and the rollback note.",
    ],
    reply: "Thanks. I will post the summary after the smoke test.",
  },
  ja: {
    welcome: "READMEショーケースのチャンネルへようこそ。",
    threadKey: "最終のメモが揃います",
    earlier: [
      ["memberUser", "ステージングへのデプロイはエラーなく完了しました。"],
      ["bridgeUser", "リリースノートの下書きを Wiki に置きました。"],
      ["bridgeUser", "ロールバック手順をページの先頭に移しました。"],
      ["memberUser", "新しいビルド向けにスモークテストの項目を更新しました。"],
      ["bridgeUser", "木曜に出すのはどのビルドですか。"],
      ["memberUser", "今朝のビルドです。CI は通っています。"],
      ["memberUser", "昼食後にもう一度ダッシュボードを確認します。"],
      ["bridgeUser", "ありがとうございます。エラー率が動いたら教えてください。"],
      ["memberUser", "サポートから、お客様向けの短い状況報告を頼まれています。"],
      ["bridgeUser", "チェックリストが終わったら書きます。"],
    ],
    showcase: [
      "@cab-bridge 10:00 までにリリースチェックリストを確認してください。",
      "@cab-bridge スモークテストの後に最終のメモが揃います。",
      "サポートへの引き継ぎと FAQ の下書きは公開できる状態です。",
    ],
    dm: [
      "@cab-bridge 準備ができたら、デプロイの概要をここに投稿してもらえますか。",
      "短い概要とロールバックの注記だけで足ります。",
    ],
    reply: "了解です。スモークテストの後に概要を投稿します。",
  },
};
let posts = POSTS.en;

const DARK_CSS = `
        #root,
        .app__body,
        .app-bar-enabled.channel-view.multi-teams,
        .main-wrapper,
        .channel-view,
        .channel-view .inner-wrap,
        .channel-header,
        .post-list__dynamic,
        .post-list__content,
        .post-list-holder-by-time,
        .post-list__scroll,
        .channel-intro,
        .advancedTextEditor,
        .advanced-text-editor,
        .file-preview__container {
          background: #0f1724 !important;
          color: #e5edf8 !important;
        }

        .SidebarContainer,
        .SidebarContainer .SidebarChannelGroupHeader,
        .channel-header,
        .channel-header__info,
        .post,
        .post__body,
        .post__message,
        .post__content,
        .channel-intro__content,
        .rhs-root,
        .sidebar--left {
          color: #e5edf8 !important;
        }

        .post,
        .post-list__center,
        .channel-intro,
        .advancedTextEditor,
        .advanced-text-editor,
        .channel-header,
        .MenuWrapper,
        .modal-content,
        textarea,
        input {
          background: #0f1724 !important;
          border-color: rgba(148, 163, 184, 0.18) !important;
          color: #e5edf8 !important;
        }

        .post:hover,
        .post.post--highlighted {
          background: #162132 !important;
        }

        .day-divider__line,
        .Separator,
        hr {
          border-color: rgba(148, 163, 184, 0.14) !important;
          background: rgba(148, 163, 184, 0.14) !important;
        }

        a,
        .post__link,
        .mention-link,
        .markdown__link {
          color: #8ab4ff !important;
        }
      `;

async function readState() {
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const serverUrl = state.serverUrl ?? state.baseUrl;
  const bridgeUser = state.bridgeUser ?? state.adminUser;
  if (!serverUrl || !bridgeUser || !state.memberUser || !state.team) {
    throw new Error(`README capture state is incomplete: ${statePath}`);
  }
  return { ...state, serverUrl, bridgeUser };
}

async function mattermostFetch(baseUrl, token, pathname, init = {}) {
  const response = await fetch(`${baseUrl}/api/v4${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 404) {
    return { status: 404, data: null };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${init.method ?? "GET"} ${pathname} failed with ${response.status}: ${text}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    data: contentType.includes("application/json") ? await response.json() : null,
  };
}

async function ensureTeamMember(baseUrl, token, teamId, userId) {
  try {
    await mattermostFetch(baseUrl, token, `/teams/${teamId}/members`, {
      method: "POST",
      body: JSON.stringify({ team_id: teamId, user_id: userId }),
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("400")) {
      throw error;
    }
  }
}

async function ensureChannel(baseUrl, token, teamId) {
  const existing = await mattermostFetch(baseUrl, token, `/teams/${teamId}/channels/name/${SHOWCASE_CHANNEL.name}`);
  if (existing.status === 200) {
    return existing.data;
  }

  const created = await mattermostFetch(baseUrl, token, "/channels", {
    method: "POST",
    body: JSON.stringify({
      team_id: teamId,
      name: SHOWCASE_CHANNEL.name,
      display_name: SHOWCASE_CHANNEL.displayName,
      type: SHOWCASE_CHANNEL.type,
      purpose: SHOWCASE_CHANNEL.purpose,
      header: SHOWCASE_CHANNEL.header,
    }),
  });
  return created.data;
}

async function ensureDirectChannel(baseUrl, token, bridgeUserId, memberUserId) {
  const response = await mattermostFetch(baseUrl, token, "/channels/direct", {
    method: "POST",
    body: JSON.stringify([bridgeUserId, memberUserId]),
  });
  return response.data;
}

async function ensureChannelMember(baseUrl, token, channelId, userId) {
  try {
    await mattermostFetch(baseUrl, token, `/channels/${channelId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("400")) {
      throw error;
    }
  }
}

async function listRecentPosts(baseUrl, token, channelId) {
  const response = await mattermostFetch(baseUrl, token, `/channels/${channelId}/posts?page=0&per_page=60`);
  const data = response.data;
  return data?.order?.map((postId) => data.posts[postId]) ?? [];
}

async function deleteOwnedPosts(baseUrl, state, channelId) {
  const posts = await listRecentPosts(baseUrl, state.bridgeUser.token, channelId);
  for (const post of posts) {
    if (post.user_id === state.bridgeUser.id) {
      await mattermostFetch(baseUrl, state.bridgeUser.token, `/posts/${post.id}`, { method: "DELETE" });
      continue;
    }
    if (post.user_id === state.memberUser.id) {
      await mattermostFetch(baseUrl, state.memberUser.token, `/posts/${post.id}`, { method: "DELETE" });
    }
  }
}

async function createPost(baseUrl, token, channelId, message) {
  await mattermostFetch(baseUrl, token, "/posts", {
    method: "POST",
    body: JSON.stringify({ channel_id: channelId, message }),
  });
}

async function debugRequest(page, action, payload) {
  return page.evaluate(({ action: requestedAction, payload: requestedPayload }) => new Promise((resolve) => {
    const id = `deck-debug-${Math.random().toString(36).slice(2)}`;
    const finish = (result) => {
      window.removeEventListener("mattermost-deck-debug-response", handleResponse);
      window.clearTimeout(timer);
      resolve(result);
    };
    const handleResponse = (event) => {
      if (event.detail?.id === id) finish(event.detail.result);
    };
    const timer = window.setTimeout(() => finish(null), 1_000);
    window.addEventListener("mattermost-deck-debug-response", handleResponse);
    window.dispatchEvent(new CustomEvent("mattermost-deck-debug-request", {
      detail: { id, action: requestedAction, payload: requestedPayload },
    }));
  }), { action, payload });
}

async function prepareDeckView(page) {
  await page.waitForSelector("#mattermost-deck-root", { timeout: 60_000 });
  const debugBridgeAvailable = await debugRequest(page, "getRenderedText");
  if (debugBridgeAvailable === null) {
    throw new Error(
      "README capture requires a development build with the E2E debug bridge. Run `npm run build` without STORE_BUILD=true first.",
    );
  }
  const deadline = Date.now() + 60_000;
  let deckText = debugBridgeAvailable;
  while (Date.now() < deadline) {
    deckText = await debugRequest(page, "getRenderedText") ?? "";
    if (deckText.includes(posts.welcome)) break;
    await page.waitForTimeout(500);
  }
  if (!deckText.includes(posts.welcome)) {
    throw new Error(`Deck posts did not render. Visible Deck text: ${deckText.slice(0, 1_000)}`);
  }
  await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll("h1, h2, h3, h4, strong, div"))
      .find((element) => {
        if (element.textContent?.trim() !== "Welcome to Mattermost") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    if (!heading) return;

    let panel = heading;
    while (panel.parentElement && panel.parentElement !== document.body) {
      const parentRect = panel.parentElement.getBoundingClientRect();
      if (parentRect.width > 600 || parentRect.height > window.innerHeight * 0.9) break;
      panel = panel.parentElement;
    }
    panel.remove();
  });
  await page.waitForTimeout(2_000);
  await page.mouse.move(1000, 900);
  await page.waitForTimeout(300);
  await page.addStyleTag({
    content: `
      .AnnouncementBar,
      .tour-tip,
      .toast,
      [data-testid="channel-toast"],
      [data-cy*="onboarding"],
      [class*="Onboarding"],
      [class*="onboarding"],
      [class*="announcement"] {
        display: none !important;
      }
    `,
  });
}

// A server that has been running for a while can greet the capture profile with
// an announcement such as the trial offer, which covers the global header and
// hides the Settings button the theme step needs.
async function dismissBlockingModals(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const closeButton = page.getByRole("button", { name: "Close" }).first();
    if (!(await closeButton.isVisible().catch(() => false))) {
      return;
    }
    await closeButton.click().catch(() => undefined);
    await page.waitForTimeout(600);
  }
}

async function applyMattermostThemeFromSettings(page, themeName) {
  await page.addStyleTag({
    content: `
      [data-cy="onboarding-task-list-overlay"],
      [data-cy="onboarding-task-list"] {
        display: none !important;
      }
    `,
  });
  await dismissBlockingModals(page);
  const settingsButton = page.getByRole("button", { name: "Settings" });
  await settingsButton.waitFor({ state: "visible", timeout: 30_000 });
  await settingsButton.click();

  const modal = page.locator(".modal-dialog, .modal-content").filter({ hasText: "Settings" }).first();
  await modal.waitFor({ state: "visible", timeout: 30_000 });
  await modal.getByRole("tab", { name: "Display" }).click();
  await modal.getByRole("button", { name: "Edit" }).first().click();
  const themeModal = page.locator(".modal-dialog, .modal-content").filter({ hasText: "Display Settings" }).last();
  await themeModal.waitFor({ state: "visible", timeout: 30_000 });
  await themeModal.getByText(themeName, { exact: true }).click();
  await themeModal.getByRole("button", { name: /^Save$/i }).click();
  await page.waitForTimeout(1200);
  const closeButton = page.getByRole("button", { name: "Close" }).first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);
}

async function setUserLocale(state, locale) {
  for (const user of [state.bridgeUser, state.memberUser]) {
    await mattermostFetch(state.serverUrl, user.token, `/users/${user.id}/patch`, {
      method: "PUT",
      body: JSON.stringify({ locale }),
    });
  }
}

async function prepareShowcaseData(state, language) {
  posts = POSTS[language];
  const baseUrl = state.serverUrl;
  const team = state.team;
  await ensureTeamMember(baseUrl, state.bridgeUser.token, team.id, state.memberUser.id);
  const showcaseChannel = await ensureChannel(baseUrl, state.bridgeUser.token, team.id);
  const dmChannel = await ensureDirectChannel(baseUrl, state.bridgeUser.token, state.bridgeUser.id, state.memberUser.id);
  await ensureChannelMember(baseUrl, state.bridgeUser.token, showcaseChannel.id, state.memberUser.id);

  await deleteOwnedPosts(baseUrl, state, showcaseChannel.id);
  await deleteOwnedPosts(baseUrl, state, dmChannel.id);

  for (const [actor, message] of posts.earlier) {
    await createPost(baseUrl, state[actor].token, showcaseChannel.id, message);
  }
  for (const message of [posts.welcome, ...posts.showcase]) {
    await createPost(baseUrl, state.bridgeUser.token, showcaseChannel.id, message);
  }
  for (const message of posts.dm) {
    await createPost(baseUrl, state.bridgeUser.token, dmChannel.id, message);
  }
  const recent = await listRecentPosts(baseUrl, state.bridgeUser.token, showcaseChannel.id);
  const root = recent.find((post) => post.message.includes(posts.threadKey));
  if (root) {
    await mattermostFetch(baseUrl, state.memberUser.token, "/posts", {
      method: "POST",
      body: JSON.stringify({ channel_id: showcaseChannel.id, root_id: root.id, message: posts.reply }),
    });
  }
  return { team, showcaseChannel, dmChannel };
}

async function getExtensionId(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  return new URL(serviceWorker.url()).host;
}

async function configureExtension(page, extensionId, baseUrl, team, showcaseChannel, dmChannel, language) {
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await page.evaluate(
    async ({ language: deckLanguage, baseUrl: origin, profileId, teamName, teamId, showcaseChannelId, dmChannelId, railWidth }) => {
      const now = Date.now();
      const settings = {
        "mattermostDeck.serverUrl.v1": origin,
        "mattermostDeck.teamSlug.v1": teamName,
        "mattermostDeck.allowedRouteKinds.v1": "channels,messages",
        "mattermostDeck.healthCheckPath.v1": "/api/v4/users/me",
        "mattermostDeck.theme.v1": "mattermost",
        "mattermostDeck.twoRowHintDismissed.v1": true,
        "mattermostDeck.language.v1": deckLanguage,
        "mattermostDeck.pollingIntervalSeconds.v1": "45",
        "mattermostDeck.fontScalePercent.v1": "100",
        "mattermostDeck.preferredRailWidth.v1": String(railWidth),
        "mattermostDeck.preferredColumnWidth.v1": "300",
        "mattermostDeck.drawerOpen.v1": 1,
        "mattermostDeck.railWidth.v1": railWidth,
        "mattermostDeck.layout.v1": [
          { id: "mentions", type: "mentions", teamId },
          { id: "channel-watch", type: "channelWatch", teamId, channelId: showcaseChannelId },
          { id: "dm-watch", type: "dmWatch", channelId: dmChannelId },
        ],
      };
      await chrome.storage.local.set({
        ...settings,
        ...Object.fromEntries(
          Object.entries(settings).map(([key, value]) => [`${key}.profile.${profileId}`, value]),
        ),
        "mattermostDeck.profiles.v1": {
          version: 1,
          profiles: [{
            id: profileId,
            name: "README Capture",
            origin: new URL(origin).origin,
            createdAt: now,
            updatedAt: now,
          }],
          activeProfileIdByOrigin: { [new URL(origin).origin]: profileId },
          lastActiveProfileId: profileId,
        },
      });
    },
    {
      language,
      baseUrl,
      profileId: captureProfileId,
      teamName: team.name,
      teamId: team.id,
      showcaseChannelId: showcaseChannel.id,
      dmChannelId: dmChannel.id,
      railWidth: OVERVIEW_CAPTURE_RAIL_WIDTH,
    },
  );
}

async function setExtensionLanguage(context, language) {
  const [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    throw new Error("The extension service worker is not available for locale capture.");
  }

  await serviceWorker.evaluate(
    ({ language: nextLanguage, profileId }) => new Promise((resolve, reject) => {
      chrome.storage.local.set({
        "mattermostDeck.language.v1": nextLanguage,
        [`mattermostDeck.language.v1.profile.${profileId}`]: nextLanguage,
      }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    }),
    { language, profileId: captureProfileId },
  );
}

async function setDeckRailWidth(context, railWidth) {
  const [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    throw new Error("The extension service worker is not available for rail width capture.");
  }

  await serviceWorker.evaluate(
    ({ width, profileId }) => new Promise((resolve, reject) => {
      const settings = {
        "mattermostDeck.preferredRailWidth.v1": String(width),
        "mattermostDeck.railWidth.v1": width,
      };
      chrome.storage.local.set({
        ...settings,
        ...Object.fromEntries(
          Object.entries(settings).map(([key, value]) => [`${key}.profile.${profileId}`, value]),
        ),
      }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    }),
    { width: railWidth, profileId: captureProfileId },
  );
}

async function loginIfNeeded(page, state) {
  const browserChoice = page.getByText("View in Browser");
  const loginId = page.locator('input[name="loginId"]');
  const passwordInput = page.locator('input[name="password-input"]');

  await Promise.race([
    browserChoice.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    loginId.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    page.waitForURL(/channels|messages/, { timeout: 15_000 }).catch(() => undefined),
  ]);

  if (await browserChoice.isVisible().catch(() => false)) {
    await browserChoice.click();
    await Promise.race([
      loginId.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
      page.waitForURL(/channels|messages/, { timeout: 30_000 }).catch(() => undefined),
    ]);
  }

  if (!(await page.waitForURL(/channels|messages/, { timeout: 2_000 }).then(() => true).catch(() => false))) {
    await loginId.waitFor({ state: "visible", timeout: 30_000 });
    await loginId.fill(state.bridgeUser.username);
    await passwordInput.fill(state.bridgeUser.password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/channels|messages/, { timeout: 60_000 });
  }
}

async function measure(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { l: Math.round(box.left), r: Math.round(box.right) };
    };
    return {
      deck: rect(document.querySelector("#mattermost-deck-root")),
      rhs: rect(document.querySelector("#sidebar-right")),
    };
  });
}

async function shot(page, name, height) {
  await page.screenshot({
    path: path.join(outDir, name),
    clip: { x: 0, y: 0, width: 1720, height },
  });
  console.log(`Saved ${path.relative(process.cwd(), path.join(outDir, name))}`);
}

async function openThread(page) {
  const post = page.locator(".post").filter({ hasText: posts.threadKey }).first();
  await post.hover();
  await page.waitForTimeout(400);
  await post.locator('button[aria-label*="eply" i], [id^="CENTER_commentIcon"]').first().click();
  await page.waitForTimeout(3000);
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await page.waitForTimeout(600);
  }
  await page.mouse.move(1000, 560);
  await page.waitForTimeout(400);
}

async function captureShowcase(language) {
  const state = await readState();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-site-"));
  await setUserLocale(state, "en");
  const { team, showcaseChannel, dmChannel } = await prepareShowcaseData(state, language);
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless,
    viewport: { width: 1720, height: TALL },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    await fs.mkdir(outDir, { recursive: true });
    await context.grantPermissions(["notifications"], { origin: state.serverUrl });
    const extensionId = await getExtensionId(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.addInitScript(() => window.localStorage.setItem("mattermostDeck.debugLogs", "1"));
    const channelUrl = `${state.serverUrl}/${team.name}/channels/${showcaseChannel.name}`;
    const worker = () => context.serviceWorkers()[0];

    await page.goto(`${state.serverUrl}/landing#/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await loginIfNeeded(page, state);
    await configureExtension(page, extensionId, state.serverUrl, team, showcaseChannel, dmChannel, language);
    const originalLayout = await worker().evaluate(async () => (await chrome.storage.local.get("mattermostDeck.layout.v1"))["mattermostDeck.layout.v1"]);
    const setTwoRows = async (twoRows) => worker().evaluate(async ({ originalLayout: base, twoRows: enabled, profileId }) => {
      const layout = enabled ? [
        ...base.map((column, index) => ({ ...column, row: index < 2 ? 0 : 1, width: 400,
          ...(index === 1 ? { customTitle: "Release watch" } : {}) })),
        { id: "showcase-favorites", type: "favorites", row: 1, width: 400, customTitle: "Follow up" },
      ] : base;
      const settings = { "mattermostDeck.layout.v1": layout, "mattermostDeck.layoutMode.v1": enabled ? "twoRows" : "row" };
      await chrome.storage.local.set({ ...settings, ...Object.fromEntries(Object.entries(settings).map(([key, value]) => [key + ".profile." + profileId, value])) });
    }, { originalLayout, twoRows, profileId: captureProfileId });

    for (const [theme, mattermostTheme] of [["light", "Quartz"], ["dark", "Onyx"]]) {
      // Mattermost's settings dialog is driven by its English labels.
      await setUserLocale(state, "en");
      await setTwoRows(false);
      await page.setViewportSize({ width: 1720, height: TALL });
      await page.goto(channelUrl, { waitUntil: "networkidle", timeout: 60_000 });
      await applyMattermostThemeFromSettings(page, mattermostTheme);
      await setUserLocale(state, language);
      const load = async () => {
        await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
        await prepareDeckView(page);
        if (theme === "dark") await page.addStyleTag({ content: DARK_CSS });
        await page.waitForTimeout(600);
      };

      await load();
      await shot(page, `overview-${theme}-${language}.png`, TALL);

      await setTwoRows(true);
      await load();
      await shot(page, `two-rows-${theme}-${language}.png`, TALL);
      await setTwoRows(false);

      await page.setViewportSize({ width: 1720, height: SHORT });
      await load();
      await shot(page, `wide-${theme}-${language}.png`, SHORT);
      const rects = { normal: await measure(page) };
      await openThread(page);
      rects.thread = await measure(page);
      await shot(page, `rhs-${theme}-${language}.png`, SHORT);
      await fs.writeFile(path.join(outDir, `rects-${theme}-${language}.json`), JSON.stringify(rects));
    }
  } finally {
    await context.close();
  }
}

for (const language of languages) {
  await captureShowcase(language);
}
