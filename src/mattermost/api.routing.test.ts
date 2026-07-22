import { beforeEach, describe, expect, it, vi } from "vitest";

function response(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as Response;
}

function errorResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as Response;
}

async function loadApi(
  pathname = "/company/mattermost/team/channels/town-square",
  serverUrl = "https://example.test/company/mattermost",
) {
  vi.resetModules();
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("window", {
    location: { origin: "https://example.test", pathname },
    dispatchEvent: vi.fn(),
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
  });
  vi.stubGlobal("fetch", vi.fn());
  const api = await import("./api.js");
  api.configureMattermostBaseUrl(serverUrl);
  return api;
}

describe("Mattermost base path", () => {
  beforeEach(() => vi.useRealTimers());

  it("prefixes REST and WebSocket paths and strips the base path from routes", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response({ id: "u1", username: "alice" }));

    await api.getCurrentUser();

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/company/mattermost/api/v4/users/me",
      expect.any(Object),
    );
    expect(api.getWebSocketUrl()).toBe("wss://example.test/company/mattermost/api/v4/websocket");
    expect(api.readCurrentRoute()).toEqual({ teamName: "team", channelName: "town-square" });
  });

  it("sends search pagination in the JSON body", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response({ order: [], posts: {} }));

    await api.searchPostsInTeam("team-id", "release", 2, 20);

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/company/mattermost/api/v4/teams/team-id/posts/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          terms: "release",
          is_or_search: false,
          include_deleted_channels: false,
          page: 2,
          per_page: 20,
        }),
      }),
    );
  });

  it("invalidates the member cache after marking a channel viewed", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ channel_id: "c1", last_viewed_at: 1 }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ channel_id: "c1", last_viewed_at: 2 }));

    await api.getMyChannelMember("c1");
    await api.viewChannel("c1");
    await expect(api.getMyChannelMember("c1")).resolves.toMatchObject({ last_viewed_at: 2 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("does not reuse GET, user, or channel caches after the base path changes", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ id: "me-one", username: "alice" }))
      .mockResolvedValueOnce(response([{ id: "u1", username: "alice" }]))
      .mockResolvedValueOnce(response({ id: "c1", name: "one", display_name: "One", type: "O" }))
      .mockResolvedValueOnce(response({ id: "me-two", username: "bob" }))
      .mockResolvedValueOnce(response([{ id: "u1", username: "bob" }]))
      .mockResolvedValueOnce(response({ id: "c1", name: "two", display_name: "Two", type: "O" }));

    await expect(api.getCurrentUser()).resolves.toMatchObject({ id: "me-one" });
    await expect(api.getUsersByIds(["u1"])).resolves.toMatchObject([{ username: "alice" }]);
    await expect(api.getChannelsByIds(["c1"])).resolves.toMatchObject([{ name: "one" }]);

    api.configureMattermostBaseUrl("https://example.test/company/two");

    await expect(api.getCurrentUser()).resolves.toMatchObject({ id: "me-two" });
    await expect(api.getUsersByIds(["u1"])).resolves.toMatchObject([{ username: "bob" }]);
    await expect(api.getChannelsByIds(["c1"])).resolves.toMatchObject([{ name: "two" }]);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      "/company/mattermost/api/v4/users/me",
      "/company/mattermost/api/v4/users/ids",
      "/company/mattermost/api/v4/channels/c1",
      "/company/two/api/v4/users/me",
      "/company/two/api/v4/users/ids",
      "/company/two/api/v4/channels/c1",
    ]);
  });

  it("clears caches when switching server origins with the same root base path", async () => {
    const api = await loadApi("/team/channels/town-square", "https://example.test");
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ id: "me-one", username: "alice" }))
      .mockResolvedValueOnce(response({ id: "me-two", username: "bob" }));

    await expect(api.getCurrentUser()).resolves.toMatchObject({ id: "me-one" });
    api.configureMattermostBaseUrl("https://other.example.test");
    await expect(api.getCurrentUser()).resolves.toMatchObject({ id: "me-two" });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("throws structured API errors with status, method, and pathname", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(401))
      .mockResolvedValueOnce(errorResponse(403));

    await expect(api.getCurrentUser()).rejects.toMatchObject({
      name: "MattermostApiError",
      status: 401,
      method: "GET",
      pathname: "/users/me",
      message: expect.stringMatching(/401/),
    });
    await expect(api.searchPostsInTeam("team-id", "release")).rejects.toMatchObject({
      name: "MattermostApiError",
      status: 403,
      method: "POST",
      pathname: "/teams/team-id/posts/search",
    });
  });
});
