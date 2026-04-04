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

const TEST_CHANNEL_NAME = `e2e-imgtest-${Date.now()}`;

interface E2EState {
  team: { id: string; name: string };
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

test("画像添付投稿のサムネイルとライトボックスが表示される", async () => {
  const state: E2EState = JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
  const { token } = state.memberUser;

  // ── 1. テスト用チャンネル作成 ─────────────────────────────────────────────
  const channel = await apiPost<{ id: string; name: string; display_name: string }>(token, "/channels", {
    team_id: state.team.id,
    name: TEST_CHANNEL_NAME,
    display_name: "E2E Image Test",
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
      await login(page, state.memberUser.username, state.memberUser.password);
      console.log("  ✓ ログイン成功");

      // ── 6. デッキが挿入されるのを待つ ──────────────────────────────────
      const deckRoot = page.locator("#mattermost-deck-root");
      await expect(deckRoot).toBeAttached({ timeout: 20_000 });
      await expect(page.locator("body")).toHaveClass(/mattermost-deck-body-offset/, { timeout: 10_000 });
      console.log("  ✓ デッキが挿入されました");

      // ── 7. Channel Watch カラムを追加 ──────────────────────────────────
      const addWrap = page.locator(".deck-add-wrap").last();
      await addWrap.locator("button").first().click();
      await page.locator(".deck-add-item", { hasText: "Channel Watch" }).first().click();
      console.log("  ✓ Channel Watch カラムを追加");

      const column = page.locator(".deck-column--channelwatch").last();
      await expect(column).toBeVisible({ timeout: 10_000 });

      // ── 8. コントロールを展開してチーム・チャンネルを選択 ──────────────
      const controls = column.locator(".deck-stack--controls");
      if (!(await controls.isVisible().catch(() => false))) {
        await column.locator("header button").first().click();
      }
      await expect(controls).toBeVisible({ timeout: 5_000 });

      // チーム選択
      const teamSelect = controls.locator(".mm-custom-select").first();
      await teamSelect.locator("button.mm-custom-select-button").click();
      const teamMenu = teamSelect.locator(".mm-custom-select-menu");
      await expect(teamMenu).toBeVisible({ timeout: 5_000 });
      await teamMenu.locator(".mm-custom-select-option", { hasText: state.team.name }).click();
      console.log(`  ✓ チーム "${state.team.name}" を選択`);

      // チャンネル選択
      await page.waitForTimeout(1_000);
      const channelSelect = controls.locator(".mm-custom-select").nth(1);
      await channelSelect.locator("button.mm-custom-select-button").click();
      const channelMenu = channelSelect.locator(".mm-custom-select-menu");
      await expect(channelMenu).toBeVisible({ timeout: 10_000 });

      // 検索して絞り込み
      const searchInput = channelMenu.locator(".mm-custom-select-search-input");
      await expect(searchInput).toBeVisible({ timeout: 3_000 });
      await searchInput.fill("E2E Image");
      await page.waitForTimeout(300);

      await channelMenu.locator(".mm-custom-select-option", { hasText: "E2E Image Test" }).click();
      console.log("  ✓ テストチャンネルを選択");

      // ── 9. 投稿が表示されるのを待つ ────────────────────────────────────
      const postCards = column.locator(".deck-card");
      await expect(postCards.first()).toBeVisible({ timeout: 15_000 });
      console.log("  ✓ 投稿が表示されました");

      // ── 10. サムネイルの表示を確認 ─────────────────────────────────────
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

      // ── 12. Esc でライトボックスを閉じる ───────────────────────────────
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
