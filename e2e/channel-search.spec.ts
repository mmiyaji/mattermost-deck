import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8065";
const stateFile =
  process.env.CAB_MATTERMOST_E2E_STATE_FILE ??
  path.resolve("../chat-agent-bridge/data/runtime/mattermost-e2e.json");

const TEST_CHANNEL_PREFIX = "e2e-search-test-";
const TEST_CHANNEL_COUNT = 3;      // 検索フィールドは常に表示されるため少数で十分

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

// ── 状態読み込み ──────────────────────────────────────────────────────────────

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
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

test("Channel Watch のチャンネル選択にインクリメンタル検索が表示される", async () => {
  const state = await readState();
  const token = state.memberUser.token;

  // ── 1. 現在のチャンネル数を確認 ─────────────────────────────────────────
  const allChannels = await apiGet<{ id: string; name: string; type: string; display_name: string }[]>(
    token,
    `/users/me/teams/${state.team.id}/channels`,
  );
  const standardChannels = allChannels.filter((c) => c.type === "O" || c.type === "P");
  console.log(`\n  現在のチャンネル数: ${standardChannels.length}件`);

  // ── 2. しきい値に達していなければテスト用チャンネルを作成 ─────────────────
  const createdChannelIds: string[] = [];
  // 検索フィルタリングを確認するためにテスト用チャンネルを作成
  console.log(`  テスト用チャンネル ${TEST_CHANNEL_COUNT}件を作成します`);
  for (let i = 0; i < TEST_CHANNEL_COUNT; i++) {
    const ch = await apiPost<{ id: string }>(token, "/channels", {
      team_id: state.team.id,
      name: `${TEST_CHANNEL_PREFIX}${Date.now()}-${i}`,
      display_name: `E2E Search Test ${i + 1}`,
      type: "O",
    });
    createdChannelIds.push(ch.id);
  }
  console.log(`  ${createdChannelIds.length}件のテスト用チャンネルを作成しました`);

  // ── ブラウザ起動 ─────────────────────────────────────────────────────────
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-search-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    // ── 3. Service Worker から storage に直接 serverUrl を書き込む ────────
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    console.log(`  Extension SW: ${sw.url()}`);

    await sw.evaluate((url: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ "mattermostDeck.serverUrl.v1": url }, () => resolve());
      });
    }, baseUrl);
    console.log(`  ✓ serverUrl をストレージに設定: ${baseUrl}`);

    // ── 4. ログイン ────────────────────────────────────────────────────────
    const page = await context.newPage();
    await login(page, state.memberUser.username, state.memberUser.password);

    // ── 5. デッキが挿入されるのを待つ ──────────────────────────────────────
    const deckRoot = page.locator("#mattermost-deck-root");
    await expect(deckRoot).toBeAttached({ timeout: 20_000 });
    await expect(page.locator("body")).toHaveClass(/mattermost-deck-body-offset/);
    console.log("  ✓ デッキが挿入されました");

    // ── 6. Channel Watch カラムを追加 ──────────────────────────────────────
    const addButton = page.locator("button.deck-topbar-button:not(.deck-button--secondary)");
    await expect(addButton).toBeEnabled({ timeout: 30_000 });
    await addButton.click();
    await page.locator(".deck-add-item", { hasText: /channel watch/i }).first().click();
    console.log("  ✓ Channel Watch カラムを追加しました");

    // 追加されたカラムを取得
    const column = page.locator(".deck-column--channel").last();
    await expect(column).toBeVisible({ timeout: 10_000 });

    // ── 7. コントロールを展開 ────────────────────────────────────────────
    const controls = column.locator(".deck-stack--controls");
    if (!(await controls.isVisible().catch(() => false))) {
      await column.locator("header button").first().click();
    }
    await expect(controls).toBeVisible({ timeout: 5_000 });

    // ── 8. チームを選択 ──────────────────────────────────────────────────
    const teamSelect = controls.locator(".mm-custom-select").first();
    await teamSelect.locator("button.mm-custom-select-button").click();
    const teamMenu = teamSelect.locator(".mm-custom-select-menu");
    await expect(teamMenu).toBeVisible({ timeout: 5_000 });

    const teamOption = teamMenu.locator(".mm-custom-select-option", { hasText: state.team.name });
    await expect(teamOption).toBeVisible({ timeout: 5_000 });
    await teamOption.click();
    console.log(`  ✓ チーム "${state.team.name}" を選択しました`);

    // ── 9. チャンネルドロップダウンを開く ──────────────────────────────
    await page.waitForTimeout(1_000); // チャンネル一覧ロード待ち
    const channelSelect = controls.locator(".mm-custom-select").nth(1);
    await expect(channelSelect).toBeVisible({ timeout: 10_000 });
    await channelSelect.locator("button.mm-custom-select-button").click();

    const channelMenu = channelSelect.locator(".mm-custom-select-menu");
    await expect(channelMenu).toBeVisible({ timeout: 10_000 });

    const renderedOptions = channelMenu.locator(".mm-custom-select-option");
    await expect(renderedOptions.first()).toBeVisible({ timeout: 10_000 });
    const optionCount = await renderedOptions.count();
    console.log(`  ドロップダウンに表示されたチャンネル数: ${optionCount}件`);

    // ── 10. 検索フィールドの表示を検証 ────────────────────────────────
    const searchInput = channelMenu.locator(".mm-custom-select-search-input");
    await expect(searchInput).toBeVisible({ timeout: 3_000 });
    console.log("  ✓ インクリメンタル検索フィールドが表示されました");

    // ── 11. フィルタリング動作を確認 ────────────────────────────────────
    const allOptionsBefore = await renderedOptions.allTextContents();
    const countBefore = allOptionsBefore.length;

    // テスト用チャンネル名のプレフィックスで絞り込み
    const searchTerm = "E2E";
    await searchInput.fill(searchTerm);
    await page.waitForTimeout(300);

    const allOptionsAfter = await renderedOptions.allTextContents();
    const countAfter = allOptionsAfter.length;
    console.log(`  ✓ "${searchTerm}" で絞り込み: ${countBefore}件 → ${countAfter}件`);

    expect(countAfter).toBeLessThan(countBefore);
    expect(countAfter).toBeGreaterThan(0);
    const allMatch = allOptionsAfter
      .filter((t) => t.trim().length > 0)
      .every((t) => t.toLowerCase().includes(searchTerm.toLowerCase()));
    expect(allMatch, `絞り込み後の全オプションが "${searchTerm}" を含むべき`).toBe(true);

    // ── 12. 検索クリアで全件戻ることを確認 ──────────────────────────────
    await searchInput.clear();
    await page.waitForTimeout(300);
    const countAfterClear = await renderedOptions.count();
    expect(countAfterClear).toBeGreaterThanOrEqual(countBefore);
    console.log(`  ✓ 検索クリア後: ${countAfterClear}件に戻りました`);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });

    // ── 13. テスト用チャンネルを削除 ────────────────────────────────────
    for (const id of createdChannelIds) {
      await apiDelete(token, `/channels/${id}`).catch(() => undefined);
    }
    if (createdChannelIds.length > 0) {
      console.log(`  テスト用チャンネル ${createdChannelIds.length}件を削除しました`);
    }
  }
});
