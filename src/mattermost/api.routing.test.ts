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

  it("requests collapsed-thread unread counters and thread read markers", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({
        total: 1,
        total_unread_threads: 1,
        total_unread_mentions: 1,
        threads: [],
      }))
      .mockResolvedValueOnce(response({ order: [], posts: {} }));

    await api.getTeamUnread("user-id");
    await api.getUserThreads("user-id", "team-id", { unread: true, perPage: 100 });
    await api.getPostThreadSince("root-id", 123, 200);

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      "/company/mattermost/api/v4/users/user-id/teams/unread?include_collapsed_threads=true",
      "/company/mattermost/api/v4/users/user-id/teams/team-id/threads?unread=true&extended=false&deleted=false&per_page=100",
      "/company/mattermost/api/v4/posts/root-id/thread?direction=down&perPage=200&fromCreateAt=123",
    ]);
  });

  it("loads every post since the channel-specific read marker", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response({
      order: ["reply"],
      posts: {
        root: {
          id: "root",
          user_id: "other",
          channel_id: "channel-id",
          create_at: 100,
          message: "root context",
        },
        reply: {
          id: "reply",
          user_id: "other",
          channel_id: "channel-id",
          create_at: 124,
          message: "@alice",
          root_id: "root",
        },
        deleted: {
          id: "deleted",
          user_id: "other",
          channel_id: "channel-id",
          create_at: 125,
          delete_at: 126,
          message: "",
        },
      },
    }));

    await expect(api.getPostsSince("channel-id", 123.9)).resolves.toMatchObject([
      { id: "reply", root_id: "root" },
      { id: "root" },
    ]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/company/mattermost/api/v4/channels/channel-id/posts?since=123&skipFetchThreads=false",
      expect.any(Object),
    );
  });

  it("keeps only the newest channel posts when a maximum is provided", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response({
      order: ["older", "newest", "middle"],
      posts: {
        older: {
          id: "older",
          user_id: "other",
          channel_id: "channel-id",
          create_at: 124,
          message: "older",
        },
        newest: {
          id: "newest",
          user_id: "other",
          channel_id: "channel-id",
          create_at: 300,
          message: "newest",
        },
        middle: {
          id: "middle",
          user_id: "other",
          channel_id: "channel-id",
          create_at: 200,
          message: "middle",
        },
      },
    }));

    await expect(api.getPostsSince("channel-id", 123, 2)).resolves.toMatchObject([
      { id: "newest" },
      { id: "middle" },
    ]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not request channel posts when the maximum is zero", async () => {
    const api = await loadApi();

    await expect(api.getPostsSince("channel-id", 123, 0)).resolves.toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("reconciles retained mention posts in one bounded request", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response([
      {
        id: "active-post",
        user_id: "author",
        channel_id: "channel-id",
        create_at: 123,
        delete_at: 0,
        message: "@alice",
      },
      {
        id: "deleted-post",
        user_id: "author",
        channel_id: "channel-id",
        create_at: 124,
        delete_at: 125,
        message: "",
      },
    ]));

    await expect(api.getPostsByIds([
      "active-post",
      "deleted-post",
      "active-post",
    ])).resolves.toHaveLength(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/company/mattermost/api/v4/posts/ids",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(["active-post", "deleted-post"]),
      }),
    );
  });

  it("treats a retained-post 404 as an empty hard-deleted set", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(errorResponse(404));

    await expect(
      api.getPostsByIds(["retention-deleted"], { maxAgeMs: 300_000 }),
    ).resolves.toEqual([]);
    await expect(
      api.getPostsByIds(["retention-deleted"], { maxAgeMs: 300_000 }),
    ).resolves.toEqual([]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("coalesces retained-post lookups across columns and caches history", async () => {
    const api = await loadApi();
    let resolveLookup!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveLookup = resolve;
      }))
      .mockResolvedValueOnce(response([{
        id: "active-post",
        user_id: "author",
        channel_id: "channel-id",
        create_at: 123,
        message: "@alice edited",
      }]));

    const first = api.getPostsByIds(["active-post"], { maxAgeMs: 300_000 });
    const overlapping = api.getPostsByIds(["active-post"], { maxAgeMs: 300_000 });
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    resolveLookup(response([{
      id: "active-post",
      user_id: "author",
      channel_id: "channel-id",
      create_at: 123,
      message: "@alice",
    }]));

    await expect(Promise.all([first, overlapping])).resolves.toHaveLength(2);
    await expect(
      api.getPostsByIds(["active-post"], { maxAgeMs: 300_000 }),
    ).resolves.toMatchObject([{ message: "@alice" }]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    api.invalidatePostByIdCache("active-post");
    await expect(
      api.getPostsByIds(["active-post"], { maxAgeMs: 300_000 }),
    ).resolves.toMatchObject([{ message: "@alice edited" }]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("does not cache an in-flight retained-post response after invalidation", async () => {
    const api = await loadApi();
    let resolveStaleLookup!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveStaleLookup = resolve;
      }))
      .mockResolvedValueOnce(response([{
        id: "edited-post",
        user_id: "author",
        channel_id: "channel-id",
        create_at: 123,
        message: "fresh body",
      }]));

    const staleLookup = api.getPostsByIds(
      ["edited-post"],
      { maxAgeMs: 300_000 },
    );
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    api.invalidatePostByIdCache("edited-post");
    resolveStaleLookup(response([{
      id: "edited-post",
      user_id: "author",
      channel_id: "channel-id",
      create_at: 123,
      message: "stale body",
    }]));
    await expect(staleLookup).resolves.toMatchObject([{ message: "stale body" }]);

    await expect(
      api.getPostsByIds(["edited-post"], { maxAgeMs: 300_000 }),
    ).resolves.toMatchObject([{ message: "fresh body" }]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("bounds the retained-post cache and evicts the oldest entries", async () => {
    const api = await loadApi();
    const posts = Array.from({ length: 2_001 }, (_, index) => ({
      id: `post-${index.toString().padStart(4, "0")}`,
      user_id: "author",
      channel_id: "channel-id",
      create_at: index + 1,
      message: `message ${index}`,
    }));
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(posts))
      .mockResolvedValueOnce(response([posts[0]]));

    await api.getPostsByIds(
      posts.map((post) => post.id),
      { maxAgeMs: 300_000 },
    );
    await expect(
      api.getPostsByIds([posts.at(-1)?.id ?? ""], { maxAgeMs: 300_000 }),
    ).resolves.toMatchObject([{ id: posts.at(-1)?.id }]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    await expect(
      api.getPostsByIds([posts[0].id], { maxAgeMs: 300_000 }),
    ).resolves.toMatchObject([{ id: posts[0].id }]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("keeps the REST scheduler serial while mention metadata is invalidated", async () => {
    const api = await loadApi();
    let resolveFirstRequest!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveFirstRequest = resolve;
      }))
      .mockResolvedValueOnce(response({ id: "team-id", name: "team" }))
      .mockResolvedValueOnce(response([]));

    const first = api.getCurrentUser();
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    const queuedBeforeInvalidation = api.getTeamByName("team");
    api.invalidateMentionMetadataCaches();
    const queuedAfterInvalidation = api.getDirectChannelsForCurrentUser();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    resolveFirstRequest(response({ id: "user-id", username: "alice" }));
    await expect(Promise.all([
      first,
      queuedBeforeInvalidation,
      queuedAfterInvalidation,
    ])).resolves.toHaveLength(3);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("loads and filters the current user's mentionable group handles", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response([
      {
        id: "g1",
        name: "release-team",
        display_name: "Release Team",
        source: "custom",
        allow_reference: true,
        delete_at: 0,
      },
      {
        id: "g2",
        name: "hidden-team",
        display_name: "Hidden Team",
        source: "custom",
        allow_reference: false,
        delete_at: 0,
      },
      {
        id: "g3",
        name: "deleted-team",
        display_name: "Deleted Team",
        source: "ldap",
        allow_reference: true,
        delete_at: 123,
      },
    ]));

    await expect(api.getMentionGroupsForUser("user-id")).resolves.toMatchObject([
      { id: "g1", name: "release-team" },
    ]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/company/mattermost/api/v4/users/user-id/groups",
      expect.any(Object),
    );
  });

  it("falls back without failing the feed when group mentions are not licensed", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(errorResponse(501));

    await expect(api.getMentionGroupsForUser("user-id")).resolves.toEqual([]);
    await expect(api.getMentionGroupsForUser("user-id")).resolves.toEqual([]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("loads the user's collapsed-reply-thread preference source", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response([{
      user_id: "user-id",
      category: "display_settings",
      name: "collapsed_reply_threads",
      value: "on",
    }]));

    await expect(api.getUserPreferences("user-id")).resolves.toMatchObject([
      { name: "collapsed_reply_threads", value: "on" },
    ]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/company/mattermost/api/v4/users/user-id/preferences",
      expect.any(Object),
    );
  });

  it("loads and caches the server collapsed-thread mode", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ CollapsedThreads: "always_on" }))
      .mockResolvedValueOnce(response({ CollapsedThreads: "disabled" }));

    await expect(api.getMattermostClientConfig()).resolves.toMatchObject({
      CollapsedThreads: "always_on",
    });
    await expect(api.getMattermostClientConfig()).resolves.toMatchObject({
      CollapsedThreads: "always_on",
    });
    api.invalidateMentionMetadataCaches();
    await expect(api.getMattermostClientConfig()).resolves.toMatchObject({
      CollapsedThreads: "disabled",
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/company/mattermost/api/v4/config/client?format=old",
      expect.any(Object),
    );
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("paginates a long thread from its read marker without repeating the root", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({
        order: ["root-id", "reply-a"],
        posts: {
          "root-id": {
            id: "root-id",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 50,
            message: "root",
          },
          "reply-a": {
            id: "reply-a",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 200,
            message: "@alice first",
            root_id: "root-id",
          },
        },
        has_next: true,
      }))
      .mockResolvedValueOnce(response({
        order: ["root-id", "reply-b"],
        posts: {
          "root-id": {
            id: "root-id",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 50,
            message: "root",
          },
          "reply-b": {
            id: "reply-b",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 300,
            message: "@alice second",
            root_id: "root-id",
          },
        },
        has_next: false,
      }));

    await expect(
      api.getPostThreadSinceWithMetadata("root-id", 100, 1),
    ).resolves.toMatchObject({
      posts: [
        { id: "reply-b" },
        { id: "reply-a" },
      ],
      truncated: false,
    });
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      "/company/mattermost/api/v4/posts/root-id/thread?direction=down&perPage=1&fromCreateAt=100",
      "/company/mattermost/api/v4/posts/root-id/thread?direction=down&perPage=1&fromPost=reply-a&fromCreateAt=200",
    ]);
  });

  it("loads newest thread pages first and stops when the maximum is reached", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({
        order: ["root-id", "reply-newest", "reply-deleted"],
        posts: {
          "root-id": {
            id: "root-id",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 50,
            message: "root",
          },
          "reply-newest": {
            id: "reply-newest",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 300,
            message: "@alice newest",
            root_id: "root-id",
          },
          "reply-deleted": {
            id: "reply-deleted",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 250,
            delete_at: 260,
            message: "",
            root_id: "root-id",
          },
        },
        has_next: true,
      }))
      .mockResolvedValueOnce(response({
        order: ["root-id", "reply-next"],
        posts: {
          "root-id": {
            id: "root-id",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 50,
            message: "root",
          },
          "reply-next": {
            id: "reply-next",
            user_id: "author",
            channel_id: "channel-id",
            create_at: 200,
            message: "@alice next",
            root_id: "root-id",
          },
        },
        has_next: true,
      }));

    await expect(
      api.getPostThreadSinceWithMetadata("root-id", 100, 2, 2),
    ).resolves.toMatchObject({
      posts: [
        { id: "reply-newest" },
        { id: "reply-next" },
      ],
      truncated: true,
    });
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      "/company/mattermost/api/v4/posts/root-id/thread?direction=up&perPage=2&fromCreateAt=9007199254740991",
      "/company/mattermost/api/v4/posts/root-id/thread?direction=up&perPage=1&fromPost=reply-deleted&fromCreateAt=250",
    ]);
  });

  it("does not request thread pages when the maximum is zero", async () => {
    const api = await loadApi();

    await expect(
      api.getPostThreadSince("root-id", 100, 200, 0),
    ).resolves.toEqual([]);
    await expect(
      api.getPostThreadSinceWithMetadata("root-id", 100, 200, 0),
    ).resolves.toEqual({ posts: [], truncated: true });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("does not mark a fully loaded bounded thread as truncated", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValueOnce(response({
      order: ["root-id", "reply-newest", "reply-next"],
      posts: {
        "root-id": {
          id: "root-id",
          user_id: "author",
          channel_id: "channel-id",
          create_at: 50,
          message: "root",
        },
        "reply-newest": {
          id: "reply-newest",
          user_id: "author",
          channel_id: "channel-id",
          create_at: 300,
          message: "@alice newest",
          root_id: "root-id",
        },
        "reply-next": {
          id: "reply-next",
          user_id: "author",
          channel_id: "channel-id",
          create_at: 200,
          message: "@alice next",
          root_id: "root-id",
        },
      },
      has_next: false,
    }));

    await expect(
      api.getPostThreadSinceWithMetadata("root-id", 100, 2, 2),
    ).resolves.toMatchObject({
      posts: [
        { id: "reply-newest" },
        { id: "reply-next" },
      ],
      truncated: false,
    });
  });

  it("marks a bounded thread as truncated when a page exceeds the maximum", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValueOnce(response({
      order: ["reply-newest", "reply-next"],
      posts: {
        "reply-newest": {
          id: "reply-newest",
          user_id: "author",
          channel_id: "channel-id",
          create_at: 300,
          message: "@alice newest",
          root_id: "root-id",
        },
        "reply-next": {
          id: "reply-next",
          user_id: "author",
          channel_id: "channel-id",
          create_at: 200,
          message: "@alice next",
          root_id: "root-id",
        },
      },
      has_next: false,
    }));

    await expect(
      api.getPostThreadSinceWithMetadata("root-id", 100, 1, 1),
    ).resolves.toMatchObject({
      posts: [{ id: "reply-newest" }],
      truncated: true,
    });
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

  it("can bypass the burst cache when a WebSocket read event has newer state", async () => {
    const api = await loadApi();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ channel_id: "c1", last_viewed_at: 1 }))
      .mockResolvedValueOnce(response({ channel_id: "c1", last_viewed_at: 2 }));

    await expect(api.getMyChannelMember("c1")).resolves.toMatchObject({
      last_viewed_at: 1,
    });
    await expect(api.getMyChannelMember("c1", { fresh: true })).resolves.toMatchObject({
      last_viewed_at: 2,
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
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
