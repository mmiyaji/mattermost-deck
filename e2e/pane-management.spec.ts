/**
 * ペイン管理の E2E テスト
 *
 * Closed Shadow DOM 化以降に壊れた以下の操作を検証する:
 *  - 追加メニューの開閉（pointerdown outside-click が closed shadow DOM で正しく動くか）
 *  - 全ペインタイプの追加
 *  - CustomSelect のドロップダウン項目選択（closed shadow DOM での composedPath 問題）
 *  - ペインの左右移動
 *  - ペインの削除
 */

import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8065";
const stateFile =
  process.env.CAB_MATTERMOST_E2E_STATE_FILE ??
  path.resolve("../chat-agent-bridge/data/runtime/mattermost-e2e.json");

interface E2EState {
  team: { id: string; name: string; display_name?: string };
  memberUser: { id: string; username: string; password: string; token: string };
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
}

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

test("ペイン追加メニューが開閉でき、各タイプを追加できる", async (_, testInfo) => {
  testInfo.setTimeout(180_000);
  const state = await readState();

  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-pane-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    // Service Worker から拡張機能の storage に直接 serverUrl を書き込む
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    console.log(`  Extension SW: ${sw.url()}`);

    await sw.evaluate((url: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ "mattermostDeck.serverUrl.v1": url }, () => resolve());
      });
    }, baseUrl);
    console.log(`  ✓ serverUrl をストレージに設定: ${baseUrl}`);

    // ログイン
    const page = await context.newPage();
    await login(page, state.memberUser.username, state.memberUser.password);
    console.log("  ✓ ログイン成功");

    // デッキが挿入されるのを待つ
    const deckRoot = page.locator("#mattermost-deck-root");
    await expect(deckRoot).toBeAttached({ timeout: 20_000 });
    await expect(page.locator("body")).toHaveClass(/mattermost-deck-body-offset/, { timeout: 10_000 });
    console.log("  ✓ デッキが挿入されました");

    // ── 追加ボタンを探す（「+」ボタン: deck-topbar-button クラスで secondary でないもの）──
    const addButton = page.locator("button.deck-topbar-button:not(.deck-button--secondary)");
    await expect(addButton).toBeEnabled({ timeout: 30_000 });
    console.log("  ✓ 追加ボタンが有効になりました");

    // ── 追加メニューの開閉テスト ──
    // メニューを開く
    await addButton.click();
    const addMenu = page.locator(".deck-add-menu");
    await expect(addMenu).toBeVisible({ timeout: 5_000 });
    console.log("  ✓ 追加メニューが開きました");

    // メニュー外をクリックして閉じる（closed Shadow DOM での外クリック検知テスト）
    await page.mouse.click(10, 10);
    await expect(addMenu).not.toBeVisible({ timeout: 3_000 });
    console.log("  ✓ メニュー外クリックでメニューが閉じました（Shadow DOM 外クリック検知 OK）");

    // ── Mentions ペイン追加 ──
    const initialCount = await page.locator(".deck-column").count();
    await addButton.click();
    await expect(addMenu).toBeVisible({ timeout: 3_000 });
    await page.locator(".deck-add-item", { hasText: /mentions/i }).first().click();
    await expect(addMenu).not.toBeVisible({ timeout: 3_000 });

    const afterMentionsCount = await page.locator(".deck-column").count();
    expect(afterMentionsCount).toBe(initialCount + 1);
    const mentionsColumn = page.locator(".deck-column--mentions").last();
    await expect(mentionsColumn).toBeVisible({ timeout: 5_000 });
    console.log("  ✓ Mentions ペインを追加しました");

    // ── Channel Watch ペイン追加 ──
    await addButton.click();
    await expect(addMenu).toBeVisible({ timeout: 3_000 });
    await page.locator(".deck-add-item", { hasText: /channel watch/i }).first().click();
    await expect(addMenu).not.toBeVisible({ timeout: 3_000 });

    const channelColumn = page.locator(".deck-column--channel").last();
    await expect(channelColumn).toBeVisible({ timeout: 5_000 });
    console.log("  ✓ Channel Watch ペインを追加しました");

    // ── Saved ペイン追加 ──
    await addButton.click();
    await expect(addMenu).toBeVisible({ timeout: 3_000 });
    await page.locator(".deck-add-item", { hasText: /saved/i }).first().click();
    await expect(addMenu).not.toBeVisible({ timeout: 3_000 });
    const savedColumn = page.locator(".deck-column--saved").last();
    await expect(savedColumn).toBeVisible({ timeout: 5_000 });
    console.log("  ✓ Saved ペインを追加しました");

    // ── CustomSelect: Channel Watch のチーム選択 ──
    // コントロールを展開する
    const controls = channelColumn.locator(".deck-stack--controls");
    if (!(await controls.isVisible().catch(() => false))) {
      await channelColumn.locator("header button").first().click();
    }
    await expect(controls).toBeVisible({ timeout: 5_000 });
    console.log("  ✓ Channel Watch コントロールが展開されました");

    // チーム選択ドロップダウンを開く
    const teamSelect = controls.locator(".mm-custom-select").first();
    const teamSelectBtn = teamSelect.locator("button.mm-custom-select-button");
    await teamSelectBtn.click();
    const teamMenu = teamSelect.locator(".mm-custom-select-menu");
    await expect(teamMenu).toBeVisible({ timeout: 5_000 });
    console.log("  ✓ チームドロップダウンが開きました");

    // ドロップダウン内の項目を選択（closed Shadow DOM での項目クリックテスト）
    const teamName = state.team.display_name ?? state.team.name;
    const teamOption = teamMenu.locator(".mm-custom-select-option").filter({ hasText: teamName });
    await expect(teamOption).toBeVisible({ timeout: 5_000 });
    await teamOption.click();

    // メニューが閉じ、選択が反映されたことを確認
    await expect(teamMenu).not.toBeVisible({ timeout: 3_000 });
    const selectedLabel = teamSelect.locator(".mm-custom-select-label:not(.mm-custom-select-label--placeholder)");
    await expect(selectedLabel).toBeVisible({ timeout: 3_000 });
    console.log(`  ✓ チーム "${teamName}" を選択できました（CustomSelect 項目クリック OK）`);

    // ── ペインの左右移動 ──
    // Saved ペイン（最後）を左に移動
    const savedControls = savedColumn.locator(".deck-stack--controls");
    if (!(await savedControls.isVisible().catch(() => false))) {
      await savedColumn.locator("header button").first().click();
    }
    await expect(savedControls).toBeVisible({ timeout: 5_000 });

    const moveLeftBtn = savedControls.locator("button[title='左に移動']");
    await expect(moveLeftBtn).toBeEnabled({ timeout: 3_000 });
    await moveLeftBtn.click();
    console.log("  ✓ ペインを左に移動しました");

    const moveRightBtn = savedControls.locator("button[title='右に移動']");
    await expect(moveRightBtn).toBeEnabled({ timeout: 3_000 });
    await moveRightBtn.click();
    console.log("  ✓ ペインを右に移動しました");

    // ── ペインの削除 ──
    const countBeforeRemove = await page.locator(".deck-column").count();
    const closeBtn = savedControls.locator("button[title='ペインを閉じる']");
    await closeBtn.click();

    const countAfterRemove = await page.locator(".deck-column").count();
    expect(countAfterRemove).toBe(countBeforeRemove - 1);
    await expect(savedColumn).not.toBeVisible({ timeout: 3_000 });
    console.log("  ✓ ペインを削除しました");

    // ── Escape キーでメニューを閉じる ──
    await addButton.click();
    await expect(addMenu).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press("Escape");
    await expect(addMenu).not.toBeVisible({ timeout: 3_000 });
    console.log("  ✓ Escape キーでメニューが閉じました");

  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
