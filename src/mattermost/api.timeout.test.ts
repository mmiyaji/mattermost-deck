import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function response(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as Response;
}

async function loadApi() {
  vi.resetModules();
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("window", {
    location: {
      origin: "https://example.test",
      pathname: "/team/channels/town-square",
    },
    dispatchEvent: vi.fn(),
    setTimeout: (...args: Parameters<typeof setTimeout>) =>
      globalThis.setTimeout(...args),
  });
  vi.stubGlobal("fetch", vi.fn());
  const api = await import("./api.js");
  api.configureMattermostBaseUrl("https://example.test");
  return api;
}

describe("Mattermost API request timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts a hung fetch and releases the serial queue for the next request", async () => {
    const api = await loadApi();
    let firstSignal: AbortSignal | undefined;
    vi.mocked(fetch)
      .mockImplementationOnce((_input, init) => {
        firstSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      })
      .mockResolvedValueOnce(response({
        id: "team-id",
        name: "team",
        display_name: "Team",
      }));

    const hungRequest = api.getCurrentUser();
    const hungExpectation = expect(hungRequest).rejects.toThrow(
      "mattermost_api_timeout:network:20000",
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await hungExpectation;
    expect(firstSignal?.aborted).toBe(true);

    const nextRequest = api.getTeamByName("team");
    await vi.advanceTimersByTimeAsync(120);
    await expect(nextRequest).resolves.toMatchObject({ id: "team-id" });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight request when the configured server changes", async () => {
    const api = await loadApi();
    let firstSignal: AbortSignal | undefined;
    vi.mocked(fetch)
      .mockImplementationOnce((_input, init) => {
        firstSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          firstSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      })
      .mockResolvedValueOnce(response({
        id: "new-user",
        username: "new-user",
      }));

    const staleRequest = api.getCurrentUser();
    const staleExpectation = expect(staleRequest).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    api.configureMattermostBaseUrl("https://example.test/new-base");
    await staleExpectation;
    expect(firstSignal?.aborted).toBe(true);

    const currentRequest = api.getCurrentUser();
    await vi.advanceTimersByTimeAsync(120);
    await expect(currentRequest).resolves.toMatchObject({ id: "new-user" });
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(
      "/new-base/api/v4/users/me",
    );
  });

  it("does not start a stale queued request after the configured server changes", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockImplementationOnce((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("Aborted", "AbortError"),
              ),
            { once: true },
          );
        }),
      )
      .mockResolvedValueOnce(response({
        id: "new-team",
        name: "new-team",
        display_name: "New Team",
      }));

    const activeRequest = api.getCurrentUser();
    const activeExpectation =
      expect(activeRequest).rejects.toMatchObject({
        name: "AbortError",
      });
    const staleQueuedRequests = Array.from(
      { length: 12 },
      (_, index) =>
        api.getTeamByName(`stale-team-${index}`),
    );
    const staleExpectations = staleQueuedRequests.map(
      (request) =>
        expect(request).rejects.toThrow(
          "mattermost_api_server_changed",
        ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    api.configureMattermostBaseUrl(
      "https://example.test/new-base",
    );
    await activeExpectation;
    await vi.advanceTimersByTimeAsync(120);
    await Promise.all(staleExpectations);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    const currentRequest =
      api.getTeamByName("new-team");
    await vi.advanceTimersByTimeAsync(0);
    await expect(currentRequest).resolves.toMatchObject({
      id: "new-team",
    });
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(
      "/new-base/api/v4/teams/name/new-team",
    );
  });

  it("bounds time spent waiting behind stalled requests", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(response({
        id: "unexpected-third-request",
        name: "team-b",
      }));

    const firstRequest = api.getCurrentUser();
    const secondRequest = api.getTeamByName("team-a");
    const queuedRequest = api.getTeamByName("team-b");
    const firstExpectation = expect(firstRequest).rejects.toThrow(
      "mattermost_api_timeout:network:20000",
    );
    const secondExpectation = expect(secondRequest).rejects.toThrow(
      "mattermost_api_timeout:network:20000",
    );
    const queuedExpectation = expect(queuedRequest).rejects.toThrow(
      "mattermost_api_timeout:queue:30000",
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await firstExpectation;
    await queuedExpectation;
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_500);
    await secondExpectation;
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
