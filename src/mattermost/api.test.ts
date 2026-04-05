import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MattermostChannel } from "./api.js";

// api.ts はブラウザ環境を前提とするため、必要なグローバルをスタブする。
// window.setTimeout は scheduleApiRequest 内のレート制限遅延に使われる。
vi.stubGlobal("document", { cookie: "" });
vi.stubGlobal("window", {
  dispatchEvent: vi.fn(),
  setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
});

// グローバルスタブを確立してからモジュールをインポートする。
const { getChannelsByIds } = await import("./api.js");

// fetch のスタブは各テストで差し替えるため beforeEach で設定する。
// モジュール内の GET キャッシュ（GET_BURST_GUARD_TTL_MS = 1s）を回避するため、
// テストごとに異なるチャンネル ID を使う。

function mockChannel(id: string, overrides: Partial<MattermostChannel> = {}): MattermostChannel {
  return { id, name: `ch-${id}`, display_name: `Channel ${id}`, type: "O", ...overrides };
}

function makeFetchOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

function makeFetchError(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ message: `error ${status}` }),
  } as Response;
}

describe("getChannelsByIds", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("空配列を渡すと fetch を呼ばず [] を返す", async () => {
    const result = await getChannelsByIds([]);
    expect(result).toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("1 件の ID に対して GET /api/v4/channels/{id} を呼ぶ", async () => {
    const channel = mockChannel("aaa001");
    vi.mocked(fetch).mockResolvedValue(makeFetchOk(channel));

    const result = await getChannelsByIds(["aaa001"]);

    expect(result).toEqual([channel]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/v4/channels/aaa001",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("複数 ID を渡すと各 ID に対して GET を呼び、全件を返す", async () => {
    const ch1 = mockChannel("bbb001");
    const ch2 = mockChannel("bbb002", { type: "P" });
    const ch3 = mockChannel("bbb003", { type: "D" });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeFetchOk(ch1))
      .mockResolvedValueOnce(makeFetchOk(ch2))
      .mockResolvedValueOnce(makeFetchOk(ch3));

    const result = await getChannelsByIds(["bbb001", "bbb002", "bbb003"]);

    expect(result).toEqual([ch1, ch2, ch3]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/v4/channels/bbb001", expect.any(Object));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/v4/channels/bbb002", expect.any(Object));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/v4/channels/bbb003", expect.any(Object));
  });

  it("POST /channels/ids を呼ばない（旧実装の退行検知）", async () => {
    const channel = mockChannel("ccc001");
    vi.mocked(fetch).mockResolvedValue(makeFetchOk(channel));

    await getChannelsByIds(["ccc001"]);

    const badCall = vi.mocked(fetch).mock.calls.find(([url, opts]) => {
      const urlStr = typeof url === "string" ? url : String(url);
      return urlStr.includes("/channels/ids") && (opts as RequestInit | undefined)?.method === "POST";
    });
    expect(badCall).toBeUndefined();
  });

  it("存在しない ID で fetch が 404 を返すと例外をスローする", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchError(404));

    await expect(getChannelsByIds(["ddd-notfound"])).rejects.toThrow(/404/);
  });

  it("CSRF トークンが cookie にある場合は X-CSRF-Token ヘッダーを付ける", async () => {
    vi.stubGlobal("document", { cookie: "MMCSRF=test-csrf-token" });
    const channel = mockChannel("eee001");
    vi.mocked(fetch).mockResolvedValue(makeFetchOk(channel));

    await getChannelsByIds(["eee001"]);

    const [, opts] = vi.mocked(fetch).mock.calls[0]!;
    expect((opts as RequestInit).headers).toMatchObject({
      "X-CSRF-Token": "test-csrf-token",
    });

    // 後続テストへの影響を避けて元に戻す
    vi.stubGlobal("document", { cookie: "" });
  });
});
