import { afterEach, describe, expect, it, vi } from "vitest";
import type { MattermostPost } from "../mattermost/api";
import type { MentionReadState } from "./mentionFeed";
import {
  MENTION_CACHE_SOFT_TTL_MS,
  buildMentionCacheEntryId,
  createMentionCacheSnapshot,
  loadMentionCache,
  normaliseMentionCacheSnapshot,
  removeMentionCache,
  saveMentionCache,
  type MentionCacheContext,
} from "./mentionCache";

const NOW = 1_800_000_000_000;

function createContext(
  overrides: Partial<MentionCacheContext> = {},
): MentionCacheContext {
  return {
    serverScope: "https://mattermost.example.test/company/one/",
    userId: "user-1",
    scopeTeamId: null,
    teamIds: ["team-b", "team-a"],
    mentionSignature: "mention-signature-1",
    ...overrides,
  };
}

function createPost(
  id: string,
  overrides: Partial<MattermostPost> = {},
): MattermostPost {
  return {
    id,
    user_id: `author-${id}`,
    channel_id: "channel-1",
    create_at: 100,
    message: `message-${id}`,
    props: { addedUserId: "user-1", large: "not cached" },
    file_ids: ["file-1"],
    ...overrides,
  };
}

function createReadState(): MentionReadState {
  return {
    channelLastViewedAt: {
      "channel-1": 50,
      "unused-channel": 75,
    },
    threadLastViewedAt: {
      "root-1": 25,
      "unused-root": 60,
    },
    activeChannelIds: {
      "channel-1": true,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mention cache snapshot", () => {
  it("separates server base paths, users, and team scopes", () => {
    const base = createContext();
    expect(buildMentionCacheEntryId(base)).not.toBe(
      buildMentionCacheEntryId(
        createContext({
          serverScope:
            "https://mattermost.example.test/company/two/",
        }),
      ),
    );
    expect(buildMentionCacheEntryId(base)).not.toBe(
      buildMentionCacheEntryId(createContext({ userId: "user-2" })),
    );
    expect(buildMentionCacheEntryId(base)).not.toBe(
      buildMentionCacheEntryId(
        createContext({ scopeTeamId: "team-a", teamIds: ["team-a"] }),
      ),
    );
  });

  it("stores only active compact posts and their read markers", () => {
    const snapshot = createMentionCacheSnapshot(
      createContext(),
      [
        createPost("active", { root_id: "root-1" }),
        createPost("inactive", { channel_id: "unused-channel" }),
        createPost("deleted", { delete_at: 10 }),
      ],
      createReadState(),
      NOW,
    );

    expect(snapshot.posts.map((post) => post.id)).toEqual(["active"]);
    expect(snapshot.posts[0]).not.toHaveProperty("props");
    expect(snapshot.posts[0]).not.toHaveProperty("file_ids");
    expect(snapshot.readState).toEqual({
      channelLastViewedAt: { "channel-1": 50 },
      threadLastViewedAt: { "root-1": 25 },
      activeChannelIds: { "channel-1": true },
    });
    expect(snapshot.teamIds).toEqual(["team-a", "team-b"]);
    expect(snapshot.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects stale, mismatched, future, and incomplete snapshots", () => {
    const context = createContext();
    const snapshot = createMentionCacheSnapshot(
      context,
      [createPost("cached")],
      createReadState(),
      NOW,
    );

    expect(
      normaliseMentionCacheSnapshot(snapshot, context, NOW),
    ).not.toBeNull();
    expect(
      normaliseMentionCacheSnapshot(
        snapshot,
        createContext({ userId: "other-user" }),
        NOW,
      ),
    ).toBeNull();
    expect(
      normaliseMentionCacheSnapshot(
        snapshot,
        createContext({ teamIds: ["team-a"] }),
        NOW,
      ),
    ).toBeNull();
    expect(
      normaliseMentionCacheSnapshot(
        snapshot,
        createContext({ mentionSignature: "changed" }),
        NOW,
      ),
    ).toBeNull();
    expect(
      normaliseMentionCacheSnapshot(
        snapshot,
        context,
        NOW + MENTION_CACHE_SOFT_TTL_MS + 1,
      ),
    ).toBeNull();
    expect(
      normaliseMentionCacheSnapshot(
        { ...snapshot, savedAt: NOW + 6 * 60_000 },
        context,
        NOW,
      ),
    ).toBeNull();
    expect(
      normaliseMentionCacheSnapshot(
        { ...snapshot, readState: undefined },
        context,
        NOW,
      ),
    ).toBeNull();
  });

  it("limits a scope to the newest 100 valid posts", () => {
    const posts = Array.from({ length: 120 }, (_, index) =>
      createPost(`post-${index}`, { create_at: index }),
    );
    const snapshot = createMentionCacheSnapshot(
      createContext(),
      posts,
      createReadState(),
      NOW,
    );

    expect(snapshot.posts).toHaveLength(100);
    expect(snapshot.posts[0].id).toBe("post-119");
    expect(snapshot.posts.at(-1)?.id).toBe("post-20");
  });

  it("keeps the compact snapshot below its post byte budget", () => {
    const message = "x".repeat(130 * 1024);
    const snapshot = createMentionCacheSnapshot(
      createContext(),
      [
        createPost("large-3", { create_at: 3, message }),
        createPost("large-2", { create_at: 2, message }),
        createPost("large-1", { create_at: 1, message }),
      ],
      createReadState(),
      NOW,
    );

    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.posts[0].id).toBe("large-3");
  });
});

describe("mention cache session storage", () => {
  it("round-trips through extension session storage", async () => {
    const stored: Record<string, unknown> = {};
    const session = {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (payload: Record<string, unknown>) => {
        Object.assign(stored, payload);
      }),
    };
    vi.stubGlobal("chrome", {
      storage: { session },
    });
    const context = createContext();

    await saveMentionCache(
      context,
      [createPost("cached")],
      createReadState(),
      NOW,
    );
    await saveMentionCache(
      context,
      [createPost("cached")],
      createReadState(),
      NOW + 1,
    );
    const loaded = await loadMentionCache(context, NOW + 1);

    expect(loaded?.posts.map((post) => post.id)).toEqual(["cached"]);
    expect(session.set).toHaveBeenCalledTimes(1);
  });

  it("retains only the four most recently verified scopes", async () => {
    const stored: Record<string, unknown> = {};
    const session = {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (payload: Record<string, unknown>) => {
        Object.assign(stored, payload);
      }),
    };
    vi.stubGlobal("chrome", {
      storage: { session },
    });

    const contexts = Array.from({ length: 5 }, (_, index) =>
      createContext({ userId: `user-${index}` }),
    );
    for (const [index, context] of contexts.entries()) {
      await saveMentionCache(
        context,
        [createPost(`cached-${index}`)],
        createReadState(),
        NOW + index,
      );
    }

    expect(await loadMentionCache(contexts[0], NOW + 10)).toBeNull();
    expect(
      (await loadMentionCache(contexts[4], NOW + 10))?.posts[0].id,
    ).toBe("cached-4");
  });

  it("loads only the snapshot owned by the requested user", async () => {
    const stored: Record<string, unknown> = {};
    const session = {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (payload: Record<string, unknown>) => {
        Object.assign(stored, payload);
      }),
    };
    vi.stubGlobal("chrome", {
      storage: { session },
    });
    const userA = createContext({ userId: "user-a" });
    const userB = createContext({ userId: "user-b" });

    await saveMentionCache(
      userA,
      [createPost("only-a")],
      createReadState(),
      NOW,
    );
    await saveMentionCache(
      userB,
      [createPost("only-b")],
      createReadState(),
      NOW + 1,
    );

    expect(
      (await loadMentionCache(userA, NOW + 2))?.posts.map(
        (post) => post.id,
      ),
    ).toEqual(["only-a"]);
    expect(
      (await loadMentionCache(userB, NOW + 2))?.posts.map(
        (post) => post.id,
      ),
    ).toEqual(["only-b"]);
  });

  it("does not fall back to page storage when session storage fails", async () => {
    const localSet = vi.fn();
    vi.stubGlobal("window", {
      localStorage: { setItem: localSet },
    });
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn(async () => {
            throw new Error("session storage unavailable");
          }),
          set: vi.fn(),
        },
      },
    });

    await expect(
      saveMentionCache(
        createContext(),
        [createPost("cached")],
        createReadState(),
        NOW,
      ),
    ).resolves.toBeUndefined();
    expect(localSet).not.toHaveBeenCalled();
  });

  it("removes an invalidated cache entry", async () => {
    const stored: Record<string, unknown> = {};
    const session = {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (payload: Record<string, unknown>) => {
        Object.assign(stored, payload);
      }),
    };
    vi.stubGlobal("chrome", {
      storage: { session },
    });
    const context = createContext();
    await saveMentionCache(
      context,
      [createPost("cached")],
      createReadState(),
      NOW,
    );

    await removeMentionCache(context, NOW + 1);

    expect(await loadMentionCache(context, NOW + 2)).toBeNull();
  });
});
