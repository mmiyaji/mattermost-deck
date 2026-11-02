import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock("./reviewDatabase"); });
const prefix = "mattermostDeck.mentionReview.v1:https%3A%2F%2Fchat.example:user:";
async function setup(failImport = false) {
  const records: Record<string, unknown> = {};
  const legacy = { [`${prefix}body:pending`]: { id: "pending", message: "keep this" }, [`${prefix}confirmed:old`]: 42, unrelated: "keep" };
  const remove = vi.fn(async (keys: string[]) => { for (const key of keys) delete (legacy as Record<string, unknown>)[key]; });
  const imported = vi.fn(async (_prefix: string, values: Record<string, unknown>) => { if (failImport) throw new Error("disk unavailable"); Object.assign(records, values); });
  vi.doMock("./reviewDatabase", () => ({
    isReviewMigrated: async () => false,
    importLegacyReviewRecords: imported,
    readReviewRecords: async () => ({ ...records }),
    writeReviewRecords: async (sets: Record<string, unknown>, removes: string[]) => { Object.assign(records, sets); for (const key of removes) delete records[key]; },
  }));
  const sendMessage = vi.fn(async () => undefined);
  vi.stubGlobal("chrome", { storage: { local: { get: async () => ({ ...legacy }), remove, set: vi.fn(() => { throw new Error("QUOTA_BYTES exceeded"); }) } },
    tabs: { query: async () => [{ id: 1, url: "https://chat.example/team" }, { id: 2, url: "https://elsewhere.example/" }], sendMessage } });
  const service = await import("./reviewStorage");
  return { ...service, legacy, records, imported, remove, sendMessage };
}
describe("review database migration", () => {
  it("does not remove any legacy data if the durable import fails", async () => {
    const s = await setup(true);
    await expect(s.handleReviewStorageRequest({ prefix, operation: "get" })).rejects.toThrow("disk unavailable");
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.legacy[`${prefix}confirmed:old`]).toBe(42);
  });
  it("retains pending data and decisions while freeing only migrated local keys", async () => {
    const s = await setup();
    const read = await s.handleReviewStorageRequest({ prefix, operation: "get" });
    expect(read.values?.[`${prefix}body:pending`]).toEqual({ id: "pending", message: "keep this" });
    expect(s.legacy).toEqual({ unrelated: "keep" });
    expect(s.imported.mock.invocationCallOrder[0]).toBeLessThan(s.remove.mock.invocationCallOrder[0]);
    await s.handleReviewStorageRequest({ prefix, operation: "write", sets: { [`${prefix}confirmed:pending`]: 123 } });
    expect(s.records[`${prefix}confirmed:pending`]).toBe(123);
    expect(s.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ changes: { [`${prefix}confirmed:pending`]: 123 } }));
    expect(s.sendMessage).toHaveBeenCalledTimes(1);
    await s.handleReviewStorageRequest({ prefix, operation: "write", removes: [`${prefix}confirmed:pending`] });
    expect(s.records).not.toHaveProperty([`${prefix}confirmed:pending`]);
    expect(s.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({ changes: { [`${prefix}confirmed:pending`]: null } }));
    expect(s.imported).toHaveBeenCalledTimes(1);
  });
  it("rejects writes outside the requested review scope", async () => {
    const s = await setup();
    await expect(s.handleReviewStorageRequest({ prefix, operation: "write", sets: { unrelated: "overwrite" } })).rejects.toThrow("Invalid review storage keys");
    expect(s.imported).not.toHaveBeenCalled();
  });
});
