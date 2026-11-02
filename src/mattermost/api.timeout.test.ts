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
  it("reuses recent navigation targets and invalidates them with metadata", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response({ id: "channel", name: "town-square" }));
    const first = api.getChannelByName("team", "town-square");
    await vi.advanceTimersByTimeAsync(0); await first;
    await vi.advanceTimersByTimeAsync(2000);
    await api.getChannelByName("team", "town-square");
    expect(fetch).toHaveBeenCalledTimes(1);
    api.invalidateMentionMetadataCaches();
    const invalidated = api.getChannelByName("team", "town-square");
    await vi.advanceTimersByTimeAsync(120); await invalidated;
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_001);
    const expired = api.getChannelByName("team", "town-square");
    await vi.advanceTimersByTimeAsync(0); await expired;
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("reconciles missed old edits even when new replies keep arriving", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({ mentionThreadCacheSeconds: 10 });
    const base = { id: "old", channel_id: "c", user_id: "author", root_id: "root", create_at: 100, message: "before edit" };
    const added = { ...base, id: "new", create_at: 101 }, latest = { ...base, id: "latest", create_at: 102 };
    const payload = (posts: typeof base[]) => ({ order: posts.map(p => p.id), posts: Object.fromEntries(posts.map(p => [p.id, p])) });
    vi.mocked(fetch).mockResolvedValueOnce(response(payload([base])))
      .mockResolvedValueOnce(response(payload([added, base])))
      .mockResolvedValueOnce(response(payload([latest, added, { ...base, message: "edited while offline" }])));
    const thread = { id: "root", last_reply_at: 100, reply_count: 1, last_viewed_at: 0,
      unread_mentions: 1, unread_replies: 1, post: { ...base, id: "root" } };
    const first = api.getMentionThreadPosts(thread, 200);
    await vi.advanceTimersByTimeAsync(0); await first;
    await vi.advanceTimersByTimeAsync(5000);
    const second = api.getMentionThreadPosts({ ...thread, last_reply_at: 101, reply_count: 2 }, 200);
    await vi.advanceTimersByTimeAsync(0); await second;
    await vi.advanceTimersByTimeAsync(6000);
    const third = api.getMentionThreadPosts({ ...thread, last_reply_at: 102, reply_count: 3 }, 200);
    await vi.advanceTimersByTimeAsync(0);
    expect((await third).find(post => post.id === "old")?.message).toBe("edited while offline");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("keeps each queued request's timeout when settings change", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({ apiMaxConcurrentRequests: 1, apiRequestTimeoutSeconds: 60, apiQueueTimeoutSeconds: 30 });
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));
    const active = api.getCurrentUser();
    const activeExpectation = expect(active).rejects.toThrow("mattermost_api_timeout:network:60000");
    const old = api.getTeamByName("old-timeout");
    const oldExpectation = expect(old).rejects.toThrow("mattermost_api_timeout:queue:30000");
    api.configureApiPerformanceSettings({ apiQueueTimeoutSeconds: 10 });
    const recent = api.getTeamByName("new-timeout");
    const recentExpectation = expect(recent).rejects.toThrow("mattermost_api_timeout:queue:10000");
    await vi.advanceTimersByTimeAsync(10_000); await recentExpectation;
    await vi.advanceTimersByTimeAsync(20_000); await oldExpectation;
    await vi.advanceTimersByTimeAsync(30_000); await activeExpectation;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("applies concurrency increases and decreases without resetting occupied slots", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({ apiMaxConcurrentRequests: 1, apiMinStartGapMs: 0 });
    const releases: Array<() => void> = [];
    vi.mocked(fetch).mockImplementation(async () => ({ ok: true, status: 200,
      json: () => new Promise(resolve => releases.push(() => resolve({ order: [], posts: {} }))),
    } as Response));
    const calls = Array.from({ length: 5 }, (_, i) => api.getRecentPosts(`live-${i}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    api.configureApiPerformanceSettings({ apiMaxConcurrentRequests: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(4);
    api.configureApiPerformanceSettings({ apiMaxConcurrentRequests: 1 });
    for (let i = 0; i < 3; i++) { releases.shift()!(); await vi.advanceTimersByTimeAsync(0); }
    expect(fetch).toHaveBeenCalledTimes(4);
    releases.shift()!(); await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(5);
    releases.shift()!(); await Promise.all(calls);
  });

  it("reports active slots and queued requests separately", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({ apiMaxConcurrentRequests: 1, apiMinStartGapMs: 0 });
    let releaseFirst: (() => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => {
      releaseFirst = () => resolve(response({ order: [], posts: {} }));
    })).mockResolvedValueOnce(response({ order: [], posts: {} }));

    const active = api.getRecentPosts("metrics-active");
    const queued = api.getRecentPosts("metrics-queued");
    await vi.advanceTimersByTimeAsync(0);

    expect(api.getApiPerformanceSnapshot()).toMatchObject({
      activeRequestSlots: 1,
      queuedRequests: 1,
    });
    releaseFirst!();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([active, queued]);
  });

  it("applies the configured GET refill rate without granting a new burst", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({ apiGetRequestsPerMinute: 300, apiGlobalRequestsPerMinute: 600, apiMinStartGapMs: 0 });
    const starts: number[] = [];
    vi.mocked(fetch).mockImplementation(async () => { starts.push(Date.now()); return response({ order: [], posts: {} }); });
    const calls = Array.from({ length: 20 }, (_, i) => api.getRecentPosts(`configured-rate-${i}`));
    await vi.advanceTimersByTimeAsync(400);
    await Promise.all(calls);
    expect(starts[18] - starts[0]).toBe(200);
    expect(starts[19] - starts[0]).toBe(400);
    api.configureApiPerformanceSettings({ apiMaxConcurrentRequests: 4 });
    const afterChange = api.getRecentPosts("no-new-burst");
    await vi.advanceTimersByTimeAsync(199);
    expect(fetch).toHaveBeenCalledTimes(20);
    await vi.advanceTimersByTimeAsync(1);
    await afterChange;
  });

  it("merges a thread delta with timestamp overlap without dropping or duplicating replies", async () => {
    const api = await loadApi();
    const base = { id: "old", channel_id: "c", user_id: "author", root_id: "root", create_at: 100, message: "@me old" };
    const tie = { ...base, id: "tie", message: "@me tie" };
    const added = { ...base, id: "new", create_at: 101, message: "@me new" };
    vi.mocked(fetch).mockResolvedValueOnce(response({ order: [base.id], posts: { [base.id]: base } }))
      .mockResolvedValueOnce(response({ order: [added.id, tie.id, base.id], posts: { [base.id]: base, [tie.id]: tie, [added.id]: added } }));
    const thread = { id: "root", last_reply_at: 100, reply_count: 1, last_viewed_at: 0,
      unread_mentions: 1, unread_replies: 1, post: { ...base, id: "root" } };
    const initial = api.getMentionThreadPosts(thread, 200);
    await vi.advanceTimersByTimeAsync(0); await initial;
    const delta = api.getMentionThreadPosts({ ...thread, last_reply_at: 101, reply_count: 3 }, 200);
    await vi.advanceTimersByTimeAsync(120);
    expect((await delta).map(post => post.id).sort()).toEqual(["new", "old", "tie"]);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("direction=down&perPage=200&fromCreateAt=99");
  });

  it("shares participation context across scans and invalidates it for a new reply", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response({ order: [], posts: {} }));
    const first = api.getCachedPostThreadContext("root", 500);
    await vi.advanceTimersByTimeAsync(2000); await first;
    await api.getCachedPostThreadContext("root", 500);
    expect(fetch).toHaveBeenCalledTimes(1);
    api.invalidatePostThreadContext("root");
    const next = api.getCachedPostThreadContext("root", 500);
    await vi.advanceTimersByTimeAsync(120); await next;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the latest bounded page when a delta exceeds the scan budget", async () => {
    const api = await loadApi();
    const base = { id: "old", channel_id: "c", user_id: "author", root_id: "root", create_at: 100, message: "@me old" };
    const a = { ...base, id: "a", create_at: 101 }, b = { ...base, id: "b", create_at: 102 };
    const recent = { ...base, id: "recent", create_at: 103 }, newest = { ...base, id: "newest", create_at: 104 };
    const payload = (posts: typeof base[], has_next = false) => ({ order: posts.map(p => p.id), posts: Object.fromEntries(posts.map(p => [p.id, p])), has_next });
    vi.mocked(fetch).mockResolvedValueOnce(response(payload([base])))
      .mockResolvedValueOnce(response(payload([a, b], true)))
      .mockResolvedValueOnce(response(payload([newest, recent], true)));
    const thread = { id: "root", last_reply_at: 100, reply_count: 1, last_viewed_at: 0,
      unread_mentions: 1, unread_replies: 1, post: { ...base, id: "root" } };
    const first = api.getMentionThreadPosts(thread, 2);
    await vi.advanceTimersByTimeAsync(0); await first;
    const next = api.getMentionThreadPosts({ ...thread, last_reply_at: 104, reply_count: 5 }, 2);
    await vi.advanceTimersByTimeAsync(500);
    expect((await next).map(post => post.id)).toEqual(["newest", "recent"]);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("direction=down");
    expect(String(vi.mocked(fetch).mock.calls[2][0])).toContain("direction=up");
  });
  it("lets a short request complete while an unrelated request is stalled", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(response({ id: "fast" }));
    const hung = api.getCurrentUser();
    const hungExpectation = expect(hung).rejects.toThrow("mattermost_api_timeout:network:20000");
    const fast = api.getTeamByName("fast");
    await vi.advanceTimersByTimeAsync(120);
    await expect(fast).resolves.toMatchObject({ id: "fast" });
    await vi.advanceTimersByTimeAsync(20_000);
    await hungExpectation;
  });

  it("keeps all three old slots occupied until aborts unwind on a server switch", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 200));
    }));
    const old = [0, 1, 2].map(i => api.getTeamByName(`old-${i}`));
    const expectations = old.map(request => expect(request).rejects.toMatchObject({ name: "AbortError" }));
    await vi.advanceTimersByTimeAsync(300);
    expect(fetch).toHaveBeenCalledTimes(3);
    api.configureMattermostBaseUrl("https://example.test/new-base");
    vi.mocked(fetch).mockResolvedValue(response({ id: "new" }));
    const current = api.getTeamByName("new");
    await vi.advanceTimersByTimeAsync(199);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(expectations);
    await expect(current).resolves.toMatchObject({ id: "new" });
    expect(String(vi.mocked(fetch).mock.calls[3][0])).toBe("/new-base/api/v4/teams/name/new");
  });
  it("overlaps at most three response bodies and spaces all request starts", async () => {
    const api = await loadApi();
    const bodies: Array<() => void> = [];
    const starts: number[] = [];
    let active = 0;
    let peak = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      starts.push(Date.now());
      peak = Math.max(peak, ++active);
      return { ok: true, status: 200, json: () => new Promise(resolve => bodies.push(() => {
        active--;
        resolve({ order: [], posts: {} });
      })) } as Response;
    });
    const requests = Array.from({ length: 8 }, (_, i) => api.getRecentPosts(`channel-${i}`));
    await vi.advanceTimersByTimeAsync(1000);
    expect(starts).toHaveLength(3);
    expect(active).toBe(3);
    while (bodies.length) {
      bodies.shift()!();
      await vi.advanceTimersByTimeAsync(120);
    }
    await Promise.all(requests);
    expect(starts).toHaveLength(8);
    expect(peak).toBe(3);
    expect(active).toBe(0);
    expect(starts.slice(1).every((at, i) => at - starts[i] >= 120)).toBe(true);
  });

  it("prioritizes an interaction when all three network slots are occupied", async () => {
    const api = await loadApi();
    const releases: Array<() => void> = [];
    vi.mocked(fetch).mockImplementation(async () => ({ ok: true, status: 200,
      json: () => new Promise(resolve => releases.push(() => resolve({ order: [], posts: {} }))),
    } as Response));
    const active = [0, 1, 2].map(i => api.getRecentPosts(`active-${i}`));
    await vi.advanceTimersByTimeAsync(300);
    const background = api.getRecentPosts("background", 0, 20, "background");
    const foreground = api.getChannelByName("team", "foreground");
    releases.shift()!();
    await vi.advanceTimersByTimeAsync(120);
    expect(String(vi.mocked(fetch).mock.calls[3][0])).toContain("/channels/name/foreground");
    while (releases.length) { releases.shift()!(); await vi.advanceTimersByTimeAsync(120); }
    await Promise.all([...active, background, foreground]);
  });

  it("shares the GET token bucket across concurrent requests", async () => {
    const api = await loadApi();
    const starts: number[] = [];
    vi.mocked(fetch).mockImplementation(async () => {
      starts.push(Date.now());
      return response({ order: [], posts: {} });
    });
    const requests = Array.from({ length: 60 }, (_, i) => api.getRecentPosts(`rate-${i}`));
    await vi.advanceTimersByTimeAsync(29_000);
    await Promise.all(requests);
    expect(starts).toHaveLength(60);
    for (let i = 0; i < starts.length; i++) {
      expect(i + 1).toBeLessThanOrEqual(18 + (starts[i] - starts[0]) * 150 / 60_000 + 0.01);
      if (i > 0) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(120);
    }
  });
  it("serves an interactive channel before queued background requests", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response({ order: [], posts: {} }));
    const active = api.getRecentPosts("active");
    const background = api.getRecentPosts("background");
    const interactive = api.getRecentPosts("visible", 0, 20, "interactive");
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([active, background, interactive]);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url).split("/channels/")[1]?.split("/")[0]))
      .toEqual(["active", "visible", "background"]);
  });

  it("reuses unchanged thread scans and refetches on read/reply changes or invalidation", async () => {
    const api = await loadApi();
    vi.mocked(fetch).mockResolvedValue(response({ order: [], posts: {} }));
    const thread = { id: "root", last_reply_at: 100, reply_count: 2,
      last_viewed_at: 0, unread_mentions: 1, unread_replies: 2,
      post: { id: "root", channel_id: "channel", user_id: "author", create_at: 1, message: "root" } };
    const first = api.getMentionThreadPosts(thread, 200);
    const concurrent = api.getMentionThreadPosts(thread, 200);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([first, concurrent]);
    await api.getMentionThreadPosts(thread, 200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const reply = api.getMentionThreadPosts({ ...thread, last_reply_at: 200 }, 200);
    await vi.advanceTimersByTimeAsync(2000);
    await reply;
    expect(fetch).toHaveBeenCalledTimes(2);
    const read = api.getMentionThreadPosts({ ...thread, last_viewed_at: 50 }, 200);
    await vi.advanceTimersByTimeAsync(2000);
    await read;
    expect(fetch).toHaveBeenCalledTimes(3);
    api.invalidatePostByIdCache("reply");
    const invalidated = api.getMentionThreadPosts(thread, 200);
    await vi.advanceTimersByTimeAsync(2000);
    await invalidated;
    expect(fetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    const expired = api.getMentionThreadPosts(thread, 200);
    await vi.advanceTimersByTimeAsync(2000);
    await expired;
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("does not resurrect a cached thread response after an immediate edit", async () => {
    const api = await loadApi();
    const post = { id: "reply", channel_id: "channel", user_id: "author", create_at: 2, message: "before" };
    vi.mocked(fetch).mockResolvedValueOnce(response({ order: [post.id], posts: { [post.id]: post } }))
      .mockResolvedValueOnce(response({ order: [post.id], posts: { [post.id]: { ...post, message: "edited" } } }));
    const thread = { id: "root", last_reply_at: 2, reply_count: 1, last_viewed_at: 0,
      unread_mentions: 1, unread_replies: 1, post: { ...post, id: "root" } };
    const first = api.getMentionThreadPosts(thread, 200);
    await vi.advanceTimersByTimeAsync(0);
    expect((await first)[0].message).toBe("before");
    api.invalidatePostByIdCache("reply");
    const edited = api.getMentionThreadPosts(thread, 200);
    await vi.advanceTimersByTimeAsync(120);
    expect((await edited)[0].message).toBe("edited");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts a hung fetch and releases its concurrency slot", async () => {
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

  it("keeps the timeout active while a successful response body is still being read", async () => {
    const api = await loadApi();
    let firstSignal: AbortSignal | undefined;
    vi.mocked(fetch)
      .mockImplementationOnce((_input, init) => {
        firstSignal = init?.signal ?? undefined;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => new Promise<unknown>(() => undefined),
        } as Response);
      })
      .mockResolvedValueOnce(response({
        id: "team-after-body-timeout",
        name: "team-after-body-timeout",
      }));

    const hungBodyRequest = api.getCurrentUser();
    const hungBodyExpectation = expect(hungBodyRequest).rejects.toThrow(
      "mattermost_api_timeout:network:20000",
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await hungBodyExpectation;
    expect(firstSignal?.aborted).toBe(true);

    const nextRequest = api.getTeamByName("team-after-body-timeout");
    await vi.advanceTimersByTimeAsync(120);
    await expect(nextRequest).resolves.toMatchObject({
      id: "team-after-body-timeout",
    });
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
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));
    const stalled = Array.from({ length: 6 }, (_, i) => api.getTeamByName(`stalled-${i}`));
    const expectations = stalled.map(request => expect(request).rejects.toThrow("mattermost_api_timeout:network:20000"));
    const queuedRequest = api.getTeamByName("queued");
    const queuedExpectation = expect(queuedRequest).rejects.toThrow(
      "mattermost_api_timeout:queue:30000",
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await queuedExpectation;
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(6);

    await vi.advanceTimersByTimeAsync(10_500);
    await Promise.all(expectations);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(6);
    vi.mocked(fetch).mockResolvedValue(response({ id: "recovered" }));
    const recovered = api.getTeamByName("recovered");
    await vi.advanceTimersByTimeAsync(120);
    await expect(recovered).resolves.toMatchObject({ id: "recovered" });
  });
});
