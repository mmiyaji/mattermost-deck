import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8065";
const stateFile =
  process.env.CAB_MATTERMOST_E2E_STATE_FILE ??
  path.resolve("../chat-agent-bridge/data/runtime/mattermost-e2e.json");

// 最小 PNG (1×1 赤ピクセル)
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

const RUN_ID = Date.now();
const TEST_CHANNEL_NAME = `e2e-imgtest-${RUN_ID}`;
const TEST_CHANNEL_DISPLAY = `E2E Image ${RUN_ID}`;

interface E2EState {
  team: { id: string; name: string; display_name?: string };
  memberUser: { id: string; username: string; password: string; token: string };
}

// ── API ヘルパー ──────────────────────────────────────────────────────────────

async function apiGet<T>(token: string, pathname: string): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${pathname} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(token: string, pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${pathname} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiDelete(token: string, pathname: string): Promise<void> {
  await fetch(`${baseUrl}/api/v4${pathname}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function uploadFile(token: string, channelId: string): Promise<string> {
  const pngBytes = Buffer.from(TINY_PNG_BASE64, "base64");
  const formData = new FormData();
  formData.set("channel_id", channelId);
  formData.set("files", new Blob([pngBytes], { type: "image/png" }), "test-image.png");

  const res = await fetch(`${baseUrl}/api/v4/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`File upload failed: ${res.status}: ${text}`);
  }
  const data = await res.json() as { file_infos: Array<{ id: string }> };
  return data.file_infos[0].id;
}

// ── ログイン ──────────────────────────────────────────────────────────────────

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto(`${baseUrl}/landing#/login`);
  const browserChoice = page.getByText("View in Browser");
  const loginId = page.locator('input[name="loginId"]');

  await Promise.race([
    browserChoice.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    loginId.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
  ]);
  if (await browserChoice.isVisible().catch(() => false)) {
    await browserChoice.click();
  }

  await loginId.waitFor({ state: "visible", timeout: 30_000 });
  await loginId.fill(username);
  await page.locator('input[name="password-input"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/channels|messages/, { timeout: 30_000 });
}

// ── テスト ────────────────────────────────────────────────────────────────────

test("画像添付投稿のサムネイルとライトボックスが表示される", async ({ }, testInfo) => {
  testInfo.setTimeout(180_000);
  const state: E2EState = JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
  const { token } = state.memberUser;

  // ── 0. チームの display_name を取得 ──────────────────────────────────────
  if (!state.team.display_name) {
    const teamInfo = await apiGet<{ display_name: string }>(token, `/teams/${state.team.id}`);
    state.team.display_name = teamInfo.display_name;
  }
  console.log(`  チーム表示名: "${state.team.display_name}"`);

  // ── 1. テスト用チャンネル作成 ─────────────────────────────────────────────
  // 過去のテスト残骸チャンネルをクリーンアップ
  const allChannels = await apiGet<Array<{ id: string; name: string }>>(token, `/users/me/teams/${state.team.id}/channels`);
  for (const ch of allChannels.filter((c) => c.name.startsWith("e2e-imgtest-"))) {
    await apiDelete(token, `/channels/${ch.id}`).catch(() => undefined);
  }
  console.log("  残骸チャンネルをクリーンアップしました");

  const channel = await apiPost<{ id: string; name: string; display_name: string }>(token, "/channels", {
    team_id: state.team.id,
    name: TEST_CHANNEL_NAME,
    display_name: TEST_CHANNEL_DISPLAY,
    type: "O",
  });
  console.log(`  ✓ チャンネル作成: ${channel.display_name} (${channel.id})`);

  let createdPostId = "";

  try {
    // ── 2. 画像アップロード + 投稿作成 ────────────────────────────────────
    const fileId = await uploadFile(token, channel.id);
    console.log(`  ✓ 画像アップロード: fileId=${fileId}`);

    const post = await apiPost<{ id: string }>(token, "/posts", {
      channel_id: channel.id,
      message: "E2E test: image attachment",
      file_ids: [fileId],
    });
    createdPostId = post.id;
    console.log(`  ✓ 投稿作成: postId=${createdPostId}`);

    // ── 3. ブラウザ起動 ───────────────────────────────────────────────────
    const extensionPath = path.resolve("./dist");
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-img-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    try {
      // ── 4. Service Worker でサーバーURL をストレージに直接書き込む ────────
      const [existingSw] = context.serviceWorkers();
      const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      console.log(`  Extension SW: ${sw.url()}`);

      await sw.evaluate((url: string) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.set({ "mattermostDeck.serverUrl.v1": url }, () => resolve());
        });
      }, baseUrl);
      console.log(`  ✓ serverUrl をストレージに設定: ${baseUrl}`);

      // ── 5. ログイン ────────────────────────────────────────────────────
      const page = await context.newPage();
      // ブラウザコンソールのエラーをキャプチャ
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          console.log(`  [browser error] ${msg.text()}`);
        }
      });
      await login(page, state.memberUser.username, state.memberUser.password);
      console.log("  ✓ ログイン成功");

      // ── 6. デッキが挿入されるのを待つ ──────────────────────────────────
      const deckRoot = page.locator("#mattermost-deck-root");
      await expect(deckRoot).toBeAttached({ timeout: 20_000 });
      await expect(page.locator("body")).toHaveClass(/mattermost-deck-body-offset/, { timeout: 10_000 });
      console.log("  ✓ デッキが挿入されました");

      // ── 7. Channel Watch カラムを追加 ──────────────────────────────────
      // deck-topbar-button が2つある（Views / 追加）。追加は secondary クラスなし
      // columns ロード完了まで disabled になるので enabled になるのを待つ
      const addButton = page.locator("button.deck-topbar-button:not(.deck-button--secondary)");
      await expect(addButton).toBeEnabled({ timeout: 30_000 });
      await addButton.click();
      await page.locator(".deck-add-item", { hasText: "Channel Watch" }).first().click();
      console.log("  ✓ Channel Watch カラムを追加");

      const column = page.locator(".deck-column--channel").last();
      await expect(column).toBeVisible({ timeout: 15_000 });
      console.log("  ✓ Channel Watch カラムが表示されました");

      // ── 8. コントロールを展開してチーム・チャンネルを選択 ──────────────
      const controls = column.locator(".deck-stack--controls");
      if (!(await controls.isVisible().catch(() => false))) {
        await column.locator("header button").first().click();
      }
      await expect(controls).toBeVisible({ timeout: 10_000 });
      console.log("  ✓ コントロールが展開されました");

      // チーム選択
      const teamSelect = controls.locator(".mm-custom-select").first();
      await teamSelect.locator("button.mm-custom-select-button").click();
      const teamMenu = teamSelect.locator(".mm-custom-select-menu");
      await expect(teamMenu).toBeVisible({ timeout: 10_000 });
      console.log("  ✓ チームメニューが開きました");
      await teamMenu.locator(".mm-custom-select-option", { hasText: state.team.display_name ?? state.team.name }).click();
      console.log(`  ✓ チーム "${state.team.display_name}" を選択`);

      // チャンネル選択（チームのチャンネル一覧 API が返るまで disabled → enabled を待つ）
      const channelSelect = controls.locator(".mm-custom-select").nth(1);
      await expect(channelSelect).toBeVisible({ timeout: 10_000 });
      console.log("  チャンネルセレクト表示確認");

      const channelSelectBtn = channelSelect.locator("button.mm-custom-select-button");
      await expect(channelSelectBtn).toBeEnabled({ timeout: 20_000 });
      console.log("  ✓ チャンネルセレクトが有効化されました");

      // Shadow DOM 内の要素は Playwright の actionability check が誤検知することがある
      // dispatchEvent で直接クリックイベントを発火させてメニューを開く
      await channelSelectBtn.evaluate((el: HTMLElement) => el.click());
      await page.screenshot({ path: "test-results/debug-after-channel-click.png" });
      console.log("  チャンネルセレクトをクリック（スクリーンショット保存）");

      const channelMenu = channelSelect.locator(".mm-custom-select-menu");
      await expect(channelMenu).toBeVisible({ timeout: 15_000 });
      console.log("  ✓ チャンネルメニューが開きました");

      // 検索して絞り込み
      const searchInput = channelMenu.locator(".mm-custom-select-search-input");
      await expect(searchInput).toBeVisible({ timeout: 5_000 });
      await searchInput.fill(TEST_CHANNEL_DISPLAY);
      await page.waitForTimeout(300);

      const channelOption = channelMenu.locator(".mm-custom-select-option", { hasText: TEST_CHANNEL_DISPLAY });
      await expect(channelOption).toBeVisible({ timeout: 5_000 });
      await channelOption.evaluate((el: HTMLElement) => el.click());
      console.log("  ✓ テストチャンネルを選択");

      // ── 9. 実際の投稿カード（ヘッダー付き）が表示されるのを待つ ──────────
      // .deck-card-header があるものだけが実投稿（info メッセージを除外）
      const postCard = column.locator(".deck-card:has(.deck-card-header)");
      await expect(postCard.first()).toBeVisible({ timeout: 30_000 });
      console.log("  ✓ 投稿が表示されました");

      // ── 10. サムネイルの表示を確認 ─────────────────────────────────────
      // デバッグ: 投稿カードの内容と deck-post-files の存在を確認
      const postTexts = await column.locator(".deck-card p").allTextContents();
      console.log(`  投稿テキスト: ${JSON.stringify(postTexts.slice(0, 3))}`);
      const postFilesCount = await column.locator(".deck-post-files").count();
      console.log(`  deck-post-files 数: ${postFilesCount}`);

      const thumbWrap = column.locator(".deck-file-thumb-wrap").first();
      await expect(thumbWrap).toBeVisible({ timeout: 10_000 });
      console.log("  ✓ 画像サムネイルが表示されました");

      // サムネイル img が実際にロードされているか確認
      const thumb = column.locator(".deck-file-thumb").first();
      await expect(thumb).toBeVisible({ timeout: 5_000 });

      const thumbLoaded = await thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
      console.log(`  サムネイル画像ロード状態: ${thumbLoaded ? "OK" : "PENDING (not yet loaded)"}`);

      // ── 11. クリックでライトボックスを開く ─────────────────────────────
      // Shadow DOM 内の要素なので shadowRoot 経由でクリック
      await thumbWrap.click();
      console.log("  ✓ サムネイルをクリック");

      // ライトボックス backdrop の確認 (Shadow DOM 内)
      const shadowHost = page.locator("#mattermost-deck-root");
      const lightbackdrop = shadowHost.locator(".deck-lightbox-backdrop");
      await expect(lightbackdrop).toBeVisible({ timeout: 5_000 });
      console.log("  ✓ ライトボックスが開きました");

      // ライトボックス内の img 確認
      const lightboxImg = lightbackdrop.locator(".deck-lightbox-img");
      await expect(lightboxImg).toBeVisible({ timeout: 5_000 });

      // 画像のロード待ち (最大 10 秒)
      await page.waitForTimeout(2_000);
      const lightboxLoaded = await lightboxImg.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
      console.log(`  ライトボックス画像ロード状態: ${lightboxLoaded ? "✓ ロード済み" : "✗ 未ロード"}`);
      expect(lightboxLoaded, "ライトボックスの画像が読み込まれるべき").toBe(true);

      // ── 12. 画像クリックで拡大を確認 ──────────────────────────────────
      const scaleBefore = await lightboxImg.evaluate((img: HTMLImageElement) => {
        const style = window.getComputedStyle(img);
        return style.transform;
      });
      await lightboxImg.click();
      await page.waitForTimeout(200);
      const scaleAfter = await lightboxImg.evaluate((img: HTMLImageElement) => {
        const style = window.getComputedStyle(img);
        return style.transform;
      });
      expect(scaleBefore).not.toBe(scaleAfter);
      console.log("  ✓ 画像クリックで拡大されました");

      // ── 13. カーテン（暗い部分）クリックで閉じる ───────────────────────
      // ステージ要素（暗い部分）の左上隅をクリック
      const stage = lightbackdrop.locator(".deck-lightbox-stage");
      await stage.click({ position: { x: 10, y: 10 } });
      await expect(lightbackdrop).not.toBeVisible({ timeout: 3_000 });
      console.log("  ✓ カーテンクリックでライトボックスが閉じました");

      // ── 14. 再度開いて Esc で閉じる ────────────────────────────────────
      await thumbWrap.click();
      await expect(lightbackdrop).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press("Escape");
      await expect(lightbackdrop).not.toBeVisible({ timeout: 3_000 });
      console.log("  ✓ Esc でライトボックスが閉じました");

    } finally {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  } finally {
    // ── クリーンアップ ────────────────────────────────────────────────────
    if (createdPostId) {
      await apiDelete(token, `/posts/${createdPostId}`).catch(() => undefined);
    }
    await apiDelete(token, `/channels/${channel.id}`).catch(() => undefined);
    console.log("  ✓ テストデータを削除しました");
  }
});
