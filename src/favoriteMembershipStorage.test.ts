import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { favoriteStorageKey } from "./ui/favorites";

const NOW = 1_800_000_000_000;
const scope = JSON.stringify(["https://chat.example/", "user"]);
const key = favoriteStorageKey("https://chat.example/", "user");
const member = (id: string, revision = `revision-${id}`) => ({ id, revision, addedAt: NOW });

describe("worker-owned favorite membership mutations", () => {
  let stored: Record<string, unknown>;
  let set: Mock<(values: Record<string, unknown>) => Promise<void>>;
  beforeEach(() => {
    vi.resetModules(); stored = {};
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); });
    vi.stubGlobal("chrome", { storage: { local: {
      get: vi.fn(async (key: string) => { await Promise.resolve(); return { [key]: structuredClone(stored[key]) }; }), set,
    } } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("serializes concurrent tabs' additions and stores only new membership metadata", async () => {
    const { handleFavoriteMembershipRequest: request } = await import("./favoriteMembershipStorage");
    await Promise.all(Array.from({ length: 25 }, (_, index) => request({ operation: "toggle", scope, member: member(`post-${index}`) })));
    expect(stored[key]).toHaveLength(25);
    expect((stored[key] as object[]).every(value => Object.keys(value).sort().join(",") === "addedAt,id,revision")).toBe(true);
    expect(new Set((stored[key] as { id: string }[]).map(value => value.id)).size).toBe(25);
  });

  it("preserves unaffected legacy bodies until migration explicitly strips them", async () => {
    const { handleFavoriteMembershipRequest: request } = await import("./favoriteMembershipStorage");
    const legacy = { ...member("old"), checkedAt: NOW, post: { id: "old", message: "legacy body" } };
    stored[key] = [legacy];
    const added = await request({ operation: "toggle", scope, member: member("new") });
    expect(added.selected).toBe(true);
    expect(added.members).toEqual([member("new"), member("old")]);
    expect(stored[key]).toEqual([member("new"), legacy]);
    await request({ operation: "strip-legacy", scope });
    expect(stored[key]).toEqual([member("new"), member("old")]);
  });

  it("shares its lock with privacy redaction so a queued registration cannot be lost", async () => {
    const { handleFavoriteMembershipRequest: request, withFavoriteMembershipLock } = await import("./favoriteMembershipStorage");
    stored[key] = [{ ...member("old"), post: { message: "legacy body" }, checkedAt: NOW }];
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const cleanup = withFavoriteMembershipLock(key, async () => {
      const snapshot = structuredClone(stored[key]) as Array<ReturnType<typeof member>>;
      entered(); await new Promise<void>(resolve => { finish = resolve; });
      await set({ [key]: snapshot.map(({ id, revision, addedAt }) => ({ id, revision, addedAt })) });
    });
    await started;
    const addition = request({ operation: "toggle", scope, member: member("new") });
    finish(); await Promise.all([cleanup, addition]);
    expect(stored[key]).toEqual([member("new"), member("old")]);
  });

  it("toggles against latest membership and gives a re-added favorite a new revision", async () => {
    const { handleFavoriteMembershipRequest: request } = await import("./favoriteMembershipStorage");
    const result = await Promise.all([
      request({ operation: "toggle", scope, member: member("post", "one") }),
      request({ operation: "toggle", scope, member: member("post", "two") }),
    ]);
    expect(result.map(value => value.selected)).toEqual([true, false]);
    expect(stored[key]).toEqual([]);
    await request({ operation: "toggle", scope, member: member("post", "three") });
    expect(stored[key]).toEqual([member("post", "three")]);
    await request({ operation: "remove", scope, id: "post" });
    expect(stored[key]).toEqual([]);
  });

  it("enforces the registration limit without changing existing data and still allows removal", async () => {
    const { handleFavoriteMembershipRequest: request } = await import("./favoriteMembershipStorage");
    const original = Array.from({ length: 100 }, (_, index) => member(`post-${index}`));
    stored[key] = original;
    await expect(request({ operation: "toggle", scope, member: member("extra") })).rejects.toThrow("favorites-limit");
    expect(stored[key]).toEqual(original);
    await request({ operation: "toggle", scope, member: member("post-0") });
    expect(stored[key]).toHaveLength(99);
  });

  it("does not poison subsequent mutations after a storage failure", async () => {
    const { handleFavoriteMembershipRequest: request } = await import("./favoriteMembershipStorage");
    set.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(request({ operation: "toggle", scope, member: member("first") })).rejects.toThrow("quota exceeded");
    expect(stored[key]).toBeUndefined();
    await request({ operation: "toggle", scope, member: member("second") });
    expect(stored[key]).toEqual([member("second")]);
  });

  it("keeps other account mutations independent and rejects invalid requests before writing", async () => {
    const { handleFavoriteMembershipRequest: request, favoriteMembershipScope } = await import("./favoriteMembershipStorage");
    await request({ operation: "toggle", scope: JSON.stringify(["https://chat.example/", "other"]), member: member("other") });
    expect(stored[key]).toBeUndefined();
    expect(stored[favoriteStorageKey("https://chat.example/", "other")]).toEqual([member("other")]);
    await expect(request({ operation: "toggle", scope, member: member("invalid id") })).rejects.toThrow("membership");
    expect(() => favoriteMembershipScope(JSON.stringify(["file:///private", "user"]))).toThrow();
    expect(() => favoriteMembershipScope(JSON.stringify(["https://name:secret@chat.example/", "user"]))).toThrow();
    expect(set).toHaveBeenCalledOnce();
  });
});
