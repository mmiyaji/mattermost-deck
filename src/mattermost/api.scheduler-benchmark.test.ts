import { mkdir, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERFORMANCE_DEFAULTS } from "../performanceSettings";

type Api = typeof import("./api");
type Start = { method: string; path: string; at: number };

async function loadApi(): Promise<Api> {
  vi.resetModules();
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("window", {
    location: { origin: "https://example.test", pathname: "/team/channels/town-square" },
    dispatchEvent: vi.fn(),
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
  });
  vi.stubGlobal("fetch", vi.fn());
  const api = await import("./api.js");
  api.configureMattermostBaseUrl("https://example.test");
  return api;
}

function percentile95(values: number[]): number {
  return values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? 0;
}

// Validate the burst + refill envelope at every start, rather than assuming
// that an average requests/second number proves a token bucket is respected.
function expectRateEnvelope(starts: Start[], method: string | null, burst: number, perMinute: number) {
  let tokens = burst;
  let previousAt = 0;
  for (const start of starts.filter(value => method === null || value.method === method)) {
    tokens = Math.min(burst, tokens + (start.at - previousAt) * perMinute / 60_000);
    expect(tokens, `${method ?? "global"} bucket at ${start.at}ms`).toBeGreaterThanOrEqual(0.999);
    tokens -= 1;
    previousAt = start.at;
  }
}

describe("Mattermost scheduler repeatable workload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts an eligible POST while a queued GET waits for its method bucket", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({
      apiMaxConcurrentRequests: 4, apiMinStartGapMs: 0,
      apiGlobalRequestsPerMinute: 1200, apiGetRequestsPerMinute: 30,
      apiPostRequestsPerMinute: 600,
    });
    const epoch = Date.now();
    const starts: Start[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      starts.push({ method: init?.method ?? "GET", path: String(input), at: Date.now() - epoch });
      return { ok: true, status: 200, json: async () => ({ order: [], posts: {} }) } as Response;
    });
    const burst = Array.from({ length: 18 }, (_, index) => api.getRecentPosts(`burst-${index}`));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(burst);
    const waitingGet = api.getRecentPosts("waiting-for-get-token", 0, 20, "background");
    await vi.advanceTimersByTimeAsync(0);
    const eligiblePost = api.searchPostsInTeam("ready-post", "@me");
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([waitingGet, eligiblePost]);
    const post = starts.find(start => start.method === "POST")!;
    const waiting = starts.find(start => start.path.includes("waiting-for-get-token"))!;
    expect(post.at).toBe(0);
    expect(waiting.at).toBe(2000);
    expectRateEnvelope(starts, null, 24, 1200);
    expectRateEnvelope(starts, "GET", 18, 30);
    expectRateEnvelope(starts, "POST", 10, 600);
  });

  it("ages a background request into service during sustained foreground traffic", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({
      apiMaxConcurrentRequests: 1, apiMinStartGapMs: 0,
      apiGlobalRequestsPerMinute: 1200, apiGetRequestsPerMinute: 1200,
      apiPostRequestsPerMinute: 600,
    });
    const epoch = Date.now();
    let backgroundStart: number | undefined;
    vi.mocked(fetch).mockImplementation(async input => {
      if (String(input).includes("waiting-background")) backgroundStart = Date.now() - epoch;
      return { ok: true, status: 200, json: async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
        return { order: [], posts: {} };
      } } as Response;
    });
    const work: Promise<unknown>[] = [api.searchPostsInTeam("initial-foreground", "query")];
    await vi.advanceTimersByTimeAsync(0);
    work.push(api.getRecentPosts("waiting-background", 0, 20, "background"));
    // Foreground arrival rate exceeds the single slot's service rate. The
    // background request must become eligible before the stream runs out.
    for (let index = 0; index < 30; index++) {
      setTimeout(() => work.push(api.searchPostsInTeam(`foreground-stream-${index}`, "query")), index * 200);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(work);
    expect(backgroundStart).toBeGreaterThanOrEqual(2000);
    expect(backgroundStart).toBeLessThanOrEqual(2500);
    expect(api.getApiPerformanceSnapshot()).toMatchObject({ totalFailedRequests: 0, activeRequestSlots: 0, queuedRequests: 0 });
  });

  it("coalesces identical in-flight searches while preserving query semantics and view mutations", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({ apiMinStartGapMs: 0 });
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { terms?: string };
      const id = body.terms ?? "view";
      return { ok: true, status: 200, json: async () => ({
        order: [id], posts: { [id]: { id, user_id: "author", channel_id: "channel", create_at: 1, message: id } },
      }) } as Response;
    });
    const same = Array.from({ length: 3 }, () => api.searchPostsInTeam("team", "same"));
    const different = [
      api.searchPostsInTeam("team", "different"),
      api.searchPostsInTeam("team", "same", 1),
      api.searchPostsInTeam("team", "same", 0, 20, { isOrSearch: true }),
      api.searchPostsInTeam("other-team", "same"),
    ];
    await vi.advanceTimersByTimeAsync(0);
    const results = await Promise.all([...same, ...different]);
    expect(results.map(posts => posts.map(post => post.id))).toEqual([
      ["same"], ["same"], ["same"], ["different"], ["same"], ["same"], ["same"],
    ]);
    expect(fetch).toHaveBeenCalledTimes(5);
    const nextSearch = api.searchPostsInTeam("team", "same");
    const mutations = [api.viewChannel("channel"), api.viewChannel("channel")];
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([nextSearch, ...mutations]);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => String(path).endsWith("/channels/members/me/view"))).toHaveLength(2);
  });

  it("promotes a shared background search when an interactive consumer joins", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({ apiMaxConcurrentRequests: 1, apiMinStartGapMs: 0 });
    const epoch = Date.now();
    const starts: Array<{ path: string; at: number }> = [];
    let releaseHeldBody!: () => void;
    vi.mocked(fetch).mockImplementation(async input => {
      const path = String(input);
      starts.push({ path, at: Date.now() - epoch });
      return { ok: true, status: 200, json: async () => {
        if (path.includes("held-slot")) await new Promise<void>(resolve => { releaseHeldBody = resolve; });
        return { order: ["result"], posts: { result: { id: "result", user_id: "author", channel_id: "channel", create_at: 1, message: "result" } } };
      } } as Response;
    });
    const held = api.getRecentPosts("held-slot");
    await vi.advanceTimersByTimeAsync(0);
    const earlierNormal = api.getRecentPosts("earlier-normal");
    const background = api.searchPostsInTeam("shared-search", "@me", 0, 20, { reason: "mention-team-search" });
    await vi.advanceTimersByTimeAsync(100);
    const interactive = api.searchPostsInTeam("shared-search", "@me");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(api.getApiPerformanceSnapshot()).toMatchObject({ queuedRequests: 2, coalescedRequests: 1 });
    releaseHeldBody();
    await vi.advanceTimersByTimeAsync(0);
    const [, , backgroundPosts, interactivePosts] = await Promise.all([held, earlierNormal, background, interactive]);
    expect(starts.map(start => start.path)).toEqual([
      "/api/v4/channels/held-slot/posts?page=0&per_page=20",
      "/api/v4/teams/shared-search/posts/search",
      "/api/v4/channels/earlier-normal/posts?page=0&per_page=20",
    ]);
    expect(starts[1].at).toBe(100);
    expect(backgroundPosts.map(post => post.id)).toEqual(["result"]);
    expect(interactivePosts.map(post => post.id)).toEqual(["result"]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not coalesce readonly POST data across metadata invalidation", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({ apiMinStartGapMs: 0 });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
      return [{ id: "user", username: "before-change" }];
    } } as Response).mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: "user", username: "after-change" }] } as Response);
    const old = api.getUsersByIds(["user"]);
    await vi.advanceTimersByTimeAsync(0);
    api.invalidateMentionMetadataCaches();
    const fresh = api.getUsersByIds(["user"]);
    await vi.advanceTimersByTimeAsync(250);
    expect((await old)[0].username).toBe("before-change");
    expect((await fresh)[0].username).toBe("after-change");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await api.getUsersByIds(["user"]))[0].username).toBe("after-change");
  });

  it.each(["2", "Thu, 01 Jan 2026 00:00:02 GMT"])("honors Retry-After %s, reduces concurrency and recovers under healthy load", async retryAfter => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({
      apiMaxConcurrentRequests: 4, apiMinStartGapMs: 0,
      apiGlobalRequestsPerMinute: 1200, apiGetRequestsPerMinute: 1200,
    });
    let active = 0, peakActive = 0;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "Retry-After": retryAfter }) } as Response)
      .mockImplementation(async () => {
        active++;
        peakActive = Math.max(peakActive, active);
        return { ok: true, status: 200, json: async () => {
          await new Promise(resolve => setTimeout(resolve, 250));
          active--;
          return { order: [], posts: {} };
        } } as Response;
      });
    const throttled = expect(api.getRecentPosts("throttled")).rejects.toThrow("mattermost_api_error:429");
    await vi.advanceTimersByTimeAsync(0);
    await throttled;
    expect(api.getApiPerformanceSnapshot()).toMatchObject({ adaptiveConcurrency: 2, adaptationReason: "congestion" });
    const recovery = Array.from({ length: 40 }, (_, index) => api.getRecentPosts(`healthy-recovery-${index}`));
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(recovery);
    expect(fetch).toHaveBeenCalledTimes(41);
    expect(peakActive).toBe(4);
    expect(api.getApiPerformanceSnapshot()).toMatchObject({ adaptiveConcurrency: 4, totalFailedRequests: 1, activeRequestSlots: 0, queuedRequests: 0 });
  });

  it("expires a rate-blocked request when the browser resumes after its queue deadline", async () => {
    const api = await loadApi();
    api.configureApiPerformanceSettings({ apiMinStartGapMs: 0, apiGlobalRequestsPerMinute: 1200, apiGetRequestsPerMinute: 30 });
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ order: [], posts: {} }) } as Response);
    const burst = Array.from({ length: 18 }, (_, index) => api.getRecentPosts(`before-suspend-${index}`));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(burst);
    const outcome = api.getRecentPosts("expired-during-suspend").then(() => "resolved", (error: Error) => error.message);
    // The rate wake was registered for 2 seconds, before the queue deadline
    // timer. Simulate an event-loop pause without running either callback yet.
    const monotonic = performance.now();
    const clock = vi.spyOn(performance, "now").mockReturnValue(monotonic + 31_000);
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(await outcome).toBe("mattermost_api_timeout:queue:30000");
      expect(fetch).toHaveBeenCalledTimes(18);
    } finally {
      clock.mockRestore();
    }
  });

  for (const scenario of [
    { name: "defaults", settings: { ...PERFORMANCE_DEFAULTS } },
    ...[1200, 30].map(getPerMinute => ({
      name: getPerMinute === 1200 ? "high-rate" : "get-rate-limited",
      settings: { ...PERFORMANCE_DEFAULTS, apiMaxConcurrentRequests: 4, apiMinStartGapMs: 0,
        apiGlobalRequestsPerMinute: 1200, apiGetRequestsPerMinute: getPerMinute,
        apiPostRequestsPerMinute: 600, apiQueueTimeoutSeconds: 120 },
    })),
  ]) {
    it(`completes the 13-team ${scenario.name} workload without lost results or rate violations`, async () => {
      const api = await loadApi();
      api.configureApiPerformanceSettings(scenario.settings);
      const epoch = Date.now();
      const starts: Start[] = [];
      const foregroundWaits: number[] = [];
      const searchCompletion: number[] = [];
      const completedIds: string[] = [];
      const foregroundEnqueued = new Map<string, number>();
      let active = 0, peakActive = 0;
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const path = String(input);
        starts.push({ method: init?.method ?? "GET", path, at: Date.now() - epoch });
        if (foregroundEnqueued.has(path)) foregroundWaits.push(Date.now() - foregroundEnqueued.get(path)!);
        active += 1;
        peakActive = Math.max(peakActive, active);
        return {
          ok: true, status: 200,
          json: async () => {
            // Include body consumption in service time and slot accounting.
            await new Promise(resolve => setTimeout(resolve, 250));
            active -= 1;
            const id = path.replace(/\?.*$/, "");
            if (path.includes("/posts/search")) searchCompletion.push(Date.now() - epoch);
            return {
              order: [id], posts: { [id]: { id, user_id: "author", channel_id: "channel", create_at: 1, message: "@me result" } },
              total: 0, total_unread_threads: 0, total_unread_mentions: 0, threads: [],
            };
          },
        } as Response;
      });
      const work: Promise<unknown>[] = [];
      // Each team's read-state request fans out into two background thread
      // loads and a mention search, matching a multi-team mention refresh.
      for (let team = 0; team < 13; team++) {
        work.push(api.getUserThreads("me", `team-${team}`).then(async () => {
          const [first, second, search] = await Promise.all([
            api.getCachedPostThreadContext(`root-${team}-a`, 20),
            api.getCachedPostThreadContext(`root-${team}-b`, 20),
            api.searchPostsInTeam(`team-${team}`, "@me", 0, 20, { reason: "mention-team-search" }),
          ]);
          completedIds.push(...first.posts.map(p => p.id), ...second.posts.map(p => p.id), ...search.map(p => p.id));
        }));
      }
      // User searches arrive while the background refresh is already queued.
      for (let index = 0; index < 4; index++) {
        setTimeout(() => {
          const team = `foreground-${index}`;
          foregroundEnqueued.set(`/api/v4/teams/${team}/posts/search`, Date.now());
          work.push(api.searchPostsInTeam(team, "user query").then(posts => completedIds.push(...posts.map(p => p.id))));
        }, 2500 + index * 300);
      }
      await vi.advanceTimersByTimeAsync(120_000);
      await Promise.all(work);
      const report = {
        scenario: scenario.name, settings: scenario.settings, requests: starts.length, resultIds: completedIds.length,
        firstSearchCompleteMs: Math.min(...searchCompletion),
        lastSearchCompleteMs: Math.max(...searchCompletion),
        foregroundQueueWaitP95Ms: percentile95(foregroundWaits),
        totalCompletionMs: Math.max(...starts.map(start => start.at + 250)), peakActive,
      };
      if (process.env.SCHEDULER_BENCHMARK_REPORT) {
        const directory = process.env.SCHEDULER_BENCHMARK_REPORT;
        await mkdir(directory, { recursive: true });
        await writeFile(`${directory}/${scenario.name}.json`, `${JSON.stringify(report, null, 2)}\n`);
      }
      const expectedIds = Array.from({ length: 13 }, (_, team) => [
        `/api/v4/posts/root-${team}-a/thread`, `/api/v4/posts/root-${team}-b/thread`,
        `/api/v4/teams/team-${team}/posts/search`,
      ]).flat().concat(Array.from({ length: 4 }, (_, index) => `/api/v4/teams/foreground-${index}/posts/search`));
      expect(starts).toHaveLength(56);
      expect(completedIds).toHaveLength(43);
      expect(new Set(completedIds).size).toBe(43);
      expect(completedIds.slice().sort()).toEqual(expectedIds.sort());
      expect(foregroundWaits).toHaveLength(4);
      expect(peakActive).toBeLessThanOrEqual(scenario.settings.apiMaxConcurrentRequests);
      for (let index = 1; index < starts.length; index++) {
        expect(starts[index].at - starts[index - 1].at).toBeGreaterThanOrEqual(scenario.settings.apiMinStartGapMs);
      }
      expectRateEnvelope(starts, null, 24, scenario.settings.apiGlobalRequestsPerMinute);
      expectRateEnvelope(starts, "GET", 18, scenario.settings.apiGetRequestsPerMinute);
      expectRateEnvelope(starts, "POST", 10, scenario.settings.apiPostRequestsPerMinute);
      expect(api.getApiPerformanceSnapshot()).toMatchObject({ totalFailedRequests: 0, activeRequestSlots: 0, queuedRequests: 0 });
    });
  }
});
