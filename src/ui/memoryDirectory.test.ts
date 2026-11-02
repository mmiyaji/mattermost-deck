import { describe, expect, it, vi } from "vitest";
import { MetadataDirectoryStore, MEMORY_METADATA_TTL_MS } from "./memoryDirectory";

describe("scoped display metadata", () => {
  it("coalesces lookups and refreshes expired labels", async () => {
    let now = 100;
    const fetch = vi.fn(async (ids: string[]) => ids.map(id => ({ id, label: now === 100 ? "old" : "renamed" })));
    const store = new MetadataDirectoryStore(null, fetch, () => now);
    await Promise.all([store.ensure(["a"]), store.ensure(["a"])]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await store.ensure(["a"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += MEMORY_METADATA_TTL_MS;
    await store.ensure(["a"]);
    expect(store.getSnapshot().a.label).toBe("renamed");
  });
  it("keeps a hard entry cap and preserves the current user", () => {
    const store = new MetadataDirectoryStore<{ id: string }>("self", async () => [], Date.now, 3);
    store.put(["self", "a", "b", "c", "d"].map(id => ({ id })));
    expect(Object.keys(store.getSnapshot())).toEqual(["self", "c", "d"]);
  });
  it("cannot publish an old account's delayed lookup into the new account store", async () => {
    let finish!: (rows: { id: string; label: string }[]) => void;
    const old = new MetadataDirectoryStore(null, () => new Promise<{ id: string; label: string }[]>(resolve => { finish = resolve; }));
    const current = new MetadataDirectoryStore(null, async () => [{ id: "a", label: "new account" }]);
    const pending = old.ensure(["a"]);
    await Promise.resolve();
    await current.ensure(["a"]);
    finish([{ id: "a", label: "old account" }]);
    await pending;
    expect(current.getSnapshot().a.label).toBe("new account");
  });
  it("rejects a lookup response older than a user-update event", async () => {
    let finish!: (rows: { id: string; label: string }[]) => void;
    const store = new MetadataDirectoryStore(null, () => new Promise<{ id: string; label: string }[]>(resolve => { finish = resolve; }));
    const pending = store.ensure(["a"]);
    await Promise.resolve();
    store.put([{ id: "a", label: "event name" }]);
    finish([{ id: "a", label: "old response" }]);
    await pending;
    expect(store.getSnapshot().a.label).toBe("event name");
  });
  it("applies renamed user event data immediately without a fetch", () => {
    const store = new MetadataDirectoryStore<{ id: string; label: string }>(null, async () => []);
    store.put([{ id: "a", label: "old" }]);
    store.put([{ id: "a", label: "new" }]);
    expect(store.getSnapshot().a.label).toBe("new");
  });
});
