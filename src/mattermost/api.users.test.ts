import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MattermostUser } from "./api.js";

function makeFetchOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

function mockUser(id: string, overrides: Partial<MattermostUser> = {}): MattermostUser {
  return {
    id,
    username: `user-${id}`,
    ...overrides,
  };
}

async function loadApiModule() {
  vi.resetModules();
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
  });
  vi.stubGlobal("fetch", vi.fn());
  return await import("./api.js");
}

describe("getUsersByIds", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("returns [] without calling fetch for an empty input", async () => {
    const { getUsersByIds } = await loadApiModule();

    await expect(getUsersByIds([])).resolves.toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("reuses cached users within the ttl", async () => {
    const { getUsersByIds } = await loadApiModule();
    vi.mocked(fetch).mockResolvedValue(makeFetchOk([mockUser("u1")]));

    await expect(getUsersByIds(["u1"])).resolves.toEqual([mockUser("u1")]);
    await expect(getUsersByIds(["u1"])).resolves.toEqual([mockUser("u1")]);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/v4/users/ids",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("fetches only uncached users when cached and uncached ids are mixed", async () => {
    const { getUsersByIds } = await loadApiModule();
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeFetchOk([mockUser("u1")]))
      .mockResolvedValueOnce(makeFetchOk([mockUser("u2")]));

    await getUsersByIds(["u1"]);
    const result = await getUsersByIds(["u1", "u2"]);

    expect(result.map((user) => user.id)).toEqual(["u1", "u2"]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    const [, secondOptions] = vi.mocked(fetch).mock.calls[1]!;
    expect((secondOptions as RequestInit).body).toBe(JSON.stringify(["u2"]));
  });

  it("shares the same inflight request for concurrent identical lookups", async () => {
    const { getUsersByIds } = await loadApiModule();
    let resolveFetch!: (response: Response) => void;
    const deferred = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetch).mockReturnValue(deferred as Promise<Response>);

    const first = getUsersByIds(["u1"]);
    const second = getUsersByIds(["u1"]);
    resolveFetch(makeFetchOk([mockUser("u1")]));

    await expect(first).resolves.toEqual([mockUser("u1")]);
    await expect(second).resolves.toEqual([mockUser("u1")]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
