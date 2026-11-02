import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock("./reviewDatabase"); });
const prefix = "mattermostDeck.mentionReview.v1:https%3A%2F%2Fchat.example:user:";
const otherPrefix = "mattermostDeck.mentionReview.v1:https%3A%2F%2Felsewhere.example:user:";

async function setup(failImport = false) {
  const records: Record<string, unknown> = {};
  const legacy: Record<string, unknown> = {
    [`${prefix}body:pending`]: { id: "pending", message: "keep this" },
    [`${prefix}confirmed:old`]: 42, unrelated: "keep",
  };
  const states = new Map<string, { cleanup: Record<string, string> }>();
  const fingerprint = async (value: unknown) => JSON.stringify(value) ?? "undefined";
  const isMigrated = vi.fn(async (scope: string) => states.has(scope));
  const imported = vi.fn(async (scope: string, values: Record<string, unknown>) => {
    if (failImport) throw new Error("disk unavailable");
    if (states.has(scope)) return;
    const cleanup: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (Object.prototype.hasOwnProperty.call(records, key)) continue;
      records[key] = value;
      cleanup[key] = await fingerprint(value);
    }
    states.set(scope, { cleanup });
  });
  const readCleanup = vi.fn(async (scope: string) => ({ ...states.get(scope)?.cleanup }));
  const completeCleanup = vi.fn(async (scope: string) => { states.set(scope, { cleanup: {} }); });
  const write = vi.fn(async (sets: Record<string, unknown>, removes: string[]) => {
    Object.assign(records, sets);
    for (const key of removes) delete records[key];
  });
  vi.doMock("./reviewDatabase", () => ({
    isReviewMigrated: isMigrated, importLegacyReviewRecords: imported,
    readReviewMigrationCleanup: readCleanup, completeReviewMigrationCleanup: completeCleanup, fingerprintReviewValue: fingerprint,
    readReviewRecords: async (scope: string) => Object.fromEntries(Object.entries(records).filter(([key]) => key.startsWith(scope))),
    writeReviewRecords: write,
  }));
  const get = vi.fn(async (keys: string[] | null): Promise<Record<string, unknown>> => keys === null ? { ...legacy }
    : Object.fromEntries(keys.filter(key => Object.prototype.hasOwnProperty.call(legacy, key)).map(key => [key, legacy[key]])));
  const remove = vi.fn(async (keys: string[]) => { for (const key of keys) delete legacy[key]; });
  const sendMessage = vi.fn(async (_tabId: number, _message: unknown) => undefined);
  const query = vi.fn(async () => [{ id: 1, url: "https://chat.example/team" }, { id: 2, url: "https://elsewhere.example/" }]);
  vi.stubGlobal("chrome", { storage: { local: { get, remove, set: vi.fn(() => { throw new Error("QUOTA_BYTES exceeded"); }) } }, tabs: { query, sendMessage } });
  const restart = async () => { vi.resetModules(); return await import("./reviewStorage"); };
  return { ...await restart(), restart, legacy, records, states, imported, isMigrated, readCleanup, completeCleanup, write, get, remove, query, sendMessage };
}

describe("review database migration and per-scope ordering", () => {
  it("does not remove legacy data or commit a marker if the durable import fails", async () => {
    const s = await setup(true);
    await expect(s.handleReviewStorageRequest({ prefix, operation: "get" })).rejects.toThrow("disk unavailable");
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.states.has(prefix)).toBe(false);
    expect(s.legacy[`${prefix}confirmed:old`]).toBe(42);
    expect(s.isMigrated.mock.invocationCallOrder[0]).toBeLessThan(s.get.mock.invocationCallOrder[0]!);
  });

  it("retains all pending data and decisions while freeing only proven imported keys", async () => {
    const s = await setup();
    s.records[`${prefix}confirmed:old`] = 99;
    const read = await s.handleReviewStorageRequest({ prefix, operation: "get" });
    expect(read.values?.[`${prefix}body:pending`]).toEqual({ id: "pending", message: "keep this" });
    expect(read.values?.[`${prefix}confirmed:old`]).toBe(99);
    expect(s.legacy).toEqual({ [`${prefix}confirmed:old`]: 42, unrelated: "keep" });
    expect(s.imported.mock.invocationCallOrder[0]).toBeLessThan(s.remove.mock.invocationCallOrder[0]!);
    expect(s.states.get(prefix)?.cleanup).toEqual({});
    await s.handleReviewStorageRequest({ prefix, operation: "write", sets: { [`${prefix}confirmed:pending`]: 123 } });
    expect(s.records[`${prefix}confirmed:pending`]).toBe(123);
    await vi.waitFor(() => expect(s.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ changes: { [`${prefix}confirmed:pending`]: 123 } })));
    await s.handleReviewStorageRequest({ prefix, operation: "write", removes: [`${prefix}confirmed:pending`] });
    await vi.waitFor(() => expect(s.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({ changes: { [`${prefix}confirmed:pending`]: null } })));
    expect(s.records).not.toHaveProperty([`${prefix}confirmed:pending`]);
    expect(s.imported).toHaveBeenCalledTimes(1);
  });

  it("does not scan, import or delete later legacy writes after a completed migration and worker restart", async () => {
    const s = await setup();
    await s.handleReviewStorageRequest({ prefix, operation: "get" });
    s.legacy[`${prefix}body:pending`] = { id: "pending", message: "downgraded writer" };
    s.legacy[`${prefix}confirmed:new-downgraded`] = 444;
    s.get.mockClear(); s.remove.mockClear(); s.imported.mockClear();
    const restarted = await s.restart();
    const result = await restarted.handleReviewStorageRequest({ prefix, operation: "get" });
    expect(s.get).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.imported).not.toHaveBeenCalled();
    expect(result.values?.[`${prefix}body:pending`]).toEqual({ id: "pending", message: "keep this" });
    expect(result.values?.[`${prefix}confirmed:new-downgraded`]).toBeUndefined();
    expect(s.legacy[`${prefix}confirmed:new-downgraded`]).toBe(444);
  });

  it("retries failed cleanup by targeted keys and preserves rewritten legacy records", async () => {
    const s = await setup();
    s.remove.mockRejectedValueOnce(new Error("storage cleanup unavailable"));
    const initial = await s.handleReviewStorageRequest({ prefix, operation: "get" });
    expect(initial.values?.[`${prefix}confirmed:old`]).toBe(42);
    expect(Object.keys(s.states.get(prefix)!.cleanup)).toHaveLength(2);
    s.legacy[`${prefix}body:pending`] = { id: "pending", message: "new legacy value after failed cleanup" };
    s.get.mockClear(); s.remove.mockClear();
    const restarted = await s.restart();
    await restarted.handleReviewStorageRequest({ prefix, operation: "get" });
    expect(s.get.mock.calls).toEqual([[expect.arrayContaining([`${prefix}body:pending`, `${prefix}confirmed:old`])]]);
    expect(s.get.mock.calls.some(([keys]) => keys === null)).toBe(false);
    expect(s.remove).toHaveBeenCalledWith([`${prefix}confirmed:old`]);
    expect(s.legacy[`${prefix}body:pending`]).toEqual({ id: "pending", message: "new legacy value after failed cleanup" });
    expect(s.states.get(prefix)?.cleanup).toEqual({});
    s.get.mockClear(); s.remove.mockClear();
    const restartedAgain = await s.restart();
    await restartedAgain.handleReviewStorageRequest({ prefix, operation: "get" });
    expect(s.get).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
  });

  it("does not block another prefix while one legacy scan is stalled", async () => {
    const s = await setup();
    s.legacy[`${otherPrefix}confirmed:other`] = 7;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    s.get.mockImplementationOnce(async () => { await gate; return { ...s.legacy }; });
    const blocked = s.handleReviewStorageRequest({ prefix, operation: "get" });
    await vi.waitFor(() => expect(s.get).toHaveBeenCalledWith(null));
    const independent = await s.handleReviewStorageRequest({ prefix: otherPrefix, operation: "get" });
    expect(independent.values?.[`${otherPrefix}confirmed:other`]).toBe(7);
    release(); await blocked;
  });

  it("orders a shared prefix, recovers after rejection and does not lose later writes", async () => {
    const s = await setup();
    s.states.set(prefix, { cleanup: {} });
    let rejectFirst!: (error: Error) => void;
    s.write.mockImplementationOnce(async () => { await new Promise<void>((_resolve, reject) => { rejectFirst = reject; }); });
    const first = s.handleReviewStorageRequest({ prefix, operation: "write", sets: { [`${prefix}confirmed:a`]: 1 } });
    const firstExpectation = expect(first).rejects.toThrow("first write failed");
    const second = s.handleReviewStorageRequest({ prefix, operation: "write", sets: { [`${prefix}confirmed:b`]: 2 } });
    const third = s.handleReviewStorageRequest({ prefix, operation: "write", sets: { [`${prefix}confirmed:c`]: 3 } });
    await vi.waitFor(() => expect(s.write).toHaveBeenCalledTimes(1));
    rejectFirst(new Error("first write failed"));
    await firstExpectation; await Promise.all([second, third]);
    const result = await s.handleReviewStorageRequest({ prefix, operation: "get" });
    expect(result.values).toEqual({ [`${prefix}confirmed:b`]: 2, [`${prefix}confirmed:c`]: 3 });
  });

  it("delivers ordered notifications without blocking persistence, reads or other prefixes", async () => {
    const s = await setup();
    s.states.set(prefix, { cleanup: {} }); s.states.set(otherPrefix, { cleanup: {} });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    s.query.mockImplementationOnce(async () => { await gate; return [{ id: 1, url: "https://chat.example/" }]; });
    await s.handleReviewStorageRequest({ prefix, operation: "write", sets: { [`${prefix}confirmed:first`]: 1 } });
    await s.handleReviewStorageRequest({ prefix, operation: "write", sets: { [`${prefix}confirmed:second`]: 2 } });
    expect((await s.handleReviewStorageRequest({ prefix, operation: "get" })).values?.[`${prefix}confirmed:second`]).toBe(2);
    await s.handleReviewStorageRequest({ prefix: otherPrefix, operation: "write", sets: { [`${otherPrefix}confirmed:independent`]: 3 } });
    await vi.waitFor(() => expect(s.sendMessage).toHaveBeenCalledWith(2, expect.objectContaining({ prefix: otherPrefix })));
    expect(s.sendMessage.mock.calls.some(([, message]) => (message as { prefix: string }).prefix === prefix)).toBe(false);
    release();
    await vi.waitFor(() => expect(s.sendMessage.mock.calls.filter(([, message]) => (message as { prefix: string }).prefix === prefix)).toHaveLength(2));
    const ordered = s.sendMessage.mock.calls.filter(([, message]) => (message as { prefix: string }).prefix === prefix)
      .map(([, message]) => Object.keys((message as { changes: Record<string, unknown> }).changes)[0]);
    expect(ordered).toEqual([`${prefix}confirmed:first`, `${prefix}confirmed:second`]);
    s.sendMessage.mockRejectedValueOnce(new Error("tab disappeared"));
    await expect(s.handleReviewStorageRequest({ prefix, operation: "write", sets: { [`${prefix}confirmed:still-saved`]: 4 } })).resolves.toEqual({});
  });

  it("rejects writes outside the requested review scope", async () => {
    const s = await setup();
    await expect(s.handleReviewStorageRequest({ prefix, operation: "write", sets: { unrelated: "overwrite" } })).rejects.toThrow("Invalid review storage keys");
    expect(s.imported).not.toHaveBeenCalled();
  });
});
