import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";

const rootDir = process.cwd();
const extensionPath = path.resolve("./dist");
const docsAssetsDir = path.resolve("./docs/assets");
const screenshotPath = path.join(docsAssetsDir, "readme-overview.png");
const darkScreenshotPath = path.join(docsAssetsDir, "readme-overview-dark.png");
const headless = process.env.README_CAPTURE_HEADLESS !== "0";
const keepOpen = process.env.README_CAPTURE_KEEP_OPEN === "1";
const headedProfileDir = path.resolve("./.tmp-readme-browser/profile");
const statePath =
  process.env.CAB_MATTERMOST_E2E_STATE_FILE ??
  path.resolve("../chat-agent-bridge/data/runtime/mattermost-e2e.json");

const SHOWCASE_CHANNEL = {
  name: "readme-showcase",
  displayName: "README Showcase",
  type: "O",
  header: "README screenshot showcase channel",
  purpose: "Mattermost Deck README capture",
};

const SHOWCASE_MESSAGES = [
  {
    actor: "bridgeUser",
    channel: "showcase",
    message: "Welcome to the README showcase channel.",
  },
  {
    actor: "bridgeUser",
    channel: "showcase",
    message: "@cab-bridge Please review the release checklist before 10:00.",
  },
  {
    actor: "bridgeUser",
    channel: "showcase",
    message: "@cab-bridge The final notes are ready after the smoke test.",
  },
  {
    actor: "bridgeUser",
    channel: "showcase",
    message: "Support handoff and the FAQ draft are ready for publishing.",
  },
  {
    actor: "bridgeUser",
    channel: "dm",
    message: "@cab-bridge Can you post the deployment summary here when ready?",
  },
  {
    actor: "bridgeUser",
    channel: "dm",
    message: "I only need a short summary and the rollback note.",
  },
];

async function readState() {
  return JSON.parse(await fs.readFile(statePath, "utf8"));
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

async function prepareDeckView(page) {
  await page.waitForSelector("#mattermost-deck-root", { timeout: 60_000 });
  await page.waitForSelector(".deck-column .deck-card--post", { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  await page.mouse.click(520, 220);
  await page.waitForTimeout(300);
  await page.addStyleTag({
    content: `
      .AnnouncementBar,
      .tour-tip,
      .toast,
      [data-testid="channel-toast"],
      [class*="announcement"] {
        display: none !important;
      }
    `,
  });
}

async function applyMattermostThemeFromSettings(page, themeName) {
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

async function prepareShowcaseData(state) {
  const baseUrl = state.serverUrl;
  const team = state.team;
  await ensureTeamMember(baseUrl, state.bridgeUser.token, team.id, state.memberUser.id);
  const showcaseChannel = await ensureChannel(baseUrl, state.bridgeUser.token, team.id);
  const dmChannel = await ensureDirectChannel(baseUrl, state.bridgeUser.token, state.bridgeUser.id, state.memberUser.id);
  await ensureChannelMember(baseUrl, state.bridgeUser.token, showcaseChannel.id, state.memberUser.id);

  await deleteOwnedPosts(baseUrl, state, showcaseChannel.id);
  await deleteOwnedPosts(baseUrl, state, dmChannel.id);

  for (const entry of SHOWCASE_MESSAGES) {
    const channelId = entry.channel === "showcase" ? showcaseChannel.id : dmChannel.id;
    const token = state[entry.actor].token;
    await createPost(baseUrl, token, channelId, entry.message);
  }

  return {
    team,
    showcaseChannel,
    dmChannel,
  };
}

async function getExtensionId(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  return new URL(serviceWorker.url()).host;
}

async function configureExtension(page, extensionId, baseUrl, team, showcaseChannel, dmChannel) {
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await page.evaluate(
    async ({ baseUrl: origin, teamName, teamId, showcaseChannelId, dmChannelId }) => {
      await chrome.storage.local.set({
        "mattermostDeck.serverUrl.v1": origin,
        "mattermostDeck.teamSlug.v1": teamName,
        "mattermostDeck.allowedRouteKinds.v1": "channels,messages",
        "mattermostDeck.healthCheckPath.v1": "/api/v4/users/me",
        "mattermostDeck.theme.v1": "mattermost",
        "mattermostDeck.language.v1": "en",
        "mattermostDeck.pollingIntervalSeconds.v1": "45",
        "mattermostDeck.fontScalePercent.v1": "100",
        "mattermostDeck.preferredRailWidth.v1": "880",
        "mattermostDeck.preferredColumnWidth.v1": "300",
        "mattermostDeck.drawerOpen.v1": 1,
        "mattermostDeck.railWidth.v1": 880,
        "mattermostDeck.layout.v1": [
          { id: "mentions", type: "mentions", teamId },
          { id: "channel-watch", type: "channelWatch", teamId, channelId: showcaseChannelId },
          { id: "dm-watch", type: "dmWatch", channelId: dmChannelId },
        ],
      });
    },
    {
      baseUrl,
      teamName: team.name,
      teamId: team.id,
      showcaseChannelId: showcaseChannel.id,
      dmChannelId: dmChannel.id,
    },
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

async function captureShowcase() {
  const state = await readState();
  const { team, showcaseChannel, dmChannel } = await prepareShowcaseData(state);
  const userDataDir = headless
    ? await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-readme-"))
    : headedProfileDir;

  if (!headless) {
    await fs.mkdir(userDataDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless,
    viewport: { width: 1720, height: 1080 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--start-maximized",
    ],
  });

  try {
    await context.grantPermissions(["notifications"], { origin: state.serverUrl });
    const extensionId = await getExtensionId(context);
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(`${state.serverUrl}/landing#/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await loginIfNeeded(page, state);
    await configureExtension(page, extensionId, state.serverUrl, team, showcaseChannel, dmChannel);

    await page.goto(`${state.serverUrl}/${team.name}/channels/${showcaseChannel.name}`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    await applyMattermostThemeFromSettings(page, "Quartz");
    await prepareDeckView(page);

    await fs.mkdir(docsAssetsDir, { recursive: true });
    await page.screenshot({
      path: screenshotPath,
      clip: {
        x: 0,
        y: 0,
        width: 1720,
        height: 948,
      },
    });

    await applyMattermostThemeFromSettings(page, "Onyx");
    await prepareDeckView(page);
    await page.addStyleTag({
      content: `
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
      `,
    });
    await page.screenshot({
      path: darkScreenshotPath,
      clip: {
        x: 0,
        y: 0,
        width: 1720,
        height: 948,
      },
    });

    console.log(`Saved screenshot to ${path.relative(rootDir, screenshotPath)}`);
    console.log(`Saved screenshot to ${path.relative(rootDir, darkScreenshotPath)}`);

    if (keepOpen) {
      console.log("README showcase browser is ready and will stay open until closed manually.");
      await new Promise(() => {});
    }
  } finally {
    if (!keepOpen) {
      await context.close();
    }
  }
}

await captureShowcase();
