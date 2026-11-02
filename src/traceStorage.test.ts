import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRACE_CAPTURE_STORAGE_KEY, TRACE_LOG_STORAGE_KEY, TRACE_STATE_STORAGE_KEY,
  TRACE_LOG_TTL_MS, TRACE_MAX_BYTES, TRACE_ENTRY_MAX_BYTES, traceBytes,
  type TraceLogEntry,
} from "./traceProtocol";

describe("central trace storage", () => {
  let values: Record<string, unknown>;
  let set: ReturnType<typeof vi.fn>;
  let handle: typeof import("./traceStorage").handleTraceStorageRequest;
  const entry = (id: string, timestamp = Date.now(), payload?: Record<string, unknown>): TraceLogEntry => ({ id, timestamp, source: "api", level: "info", event: id, ...(payload ? { payload } : {}) });

  beforeEach(async () => {
    vi.resetModules();
    values = {};
    set = vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, structuredClone(next)); });
    vi.stubGlobal("chrome", { storage: { local: {
      get: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone(values[key])])), set,
    } } });
    handle = (await import("./traceStorage")).handleTraceStorageRequest;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("retains concurrent tab batches and attaches trusted origin/tab provenance", async () => {
    const state = await handle({ operation: "setCapture", enabled: true });
    await Promise.all([
      handle({ operation: "append", generation: state.generation, entries: [entry("tab-a")] }, { url: "https://one.example/private?secret=1", tab: { id: 1 } } as chrome.runtime.MessageSender),
      handle({ operation: "append", generation: state.generation, entries: [entry("tab-b")] }, { url: "https://two.example/", tab: { id: 2 } } as chrome.runtime.MessageSender),
    ]);
    const result = await handle({ operation: "get" });
    expect(result.entries.map(value => value.id).sort()).toEqual(["tab-a", "tab-b"]);
    expect(result.entries.find(value => value.id === "tab-a")?.context).toEqual({ origin: "https://one.example", tabId: 1 });
    expect(result.entries.find(value => value.id === "tab-b")?.context).toEqual({ origin: "https://two.example", tabId: 2 });
  });

  it("makes retries idempotent by stable entry ID", async () => {
    const state = await handle({ operation: "setCapture", enabled: true });
    const batch = [entry("a"), entry("b")];
    await handle({ operation: "append", generation: state.generation, entries: batch });
    await handle({ operation: "append", generation: state.generation, entries: batch });
    await handle({ operation: "append", generation: state.generation, entries: [{ ...batch[0]!, event: "altered retry" }] });
    const result = await handle({ operation: "get" });
    expect(result.entries).toHaveLength(2);
    expect(result.entries.find(value => value.id === "a")?.event).toBe("a");
  });

  it("invalidates old batches on clear and capture-off, including after background restart", async () => {
    const initial = await handle({ operation: "setCapture", enabled: true });
    await handle({ operation: "append", generation: initial.generation, entries: [entry("before-clear")] });
    const cleared = await handle({ operation: "clear" });
    expect(cleared.generation).not.toBe(initial.generation);
    vi.resetModules();
    handle = (await import("./traceStorage")).handleTraceStorageRequest;
    expect((await handle({ operation: "append", generation: initial.generation, entries: [entry("delayed")] })).entries).toEqual([]);
    await handle({ operation: "append", generation: cleared.generation, entries: [entry("after-clear")] });
    const disabled = await handle({ operation: "setCapture", enabled: false });
    expect(disabled.entries).toEqual([]);
    const enabled = await handle({ operation: "setCapture", enabled: true });
    expect(enabled.generation).toBe(disabled.generation);
    expect((await handle({ operation: "append", generation: cleared.generation, entries: [entry("old-on-toggle")] })).entries).toEqual([]);
    expect((await handle({ operation: "append", generation: enabled.generation, entries: [entry("fresh")] })).entries).toHaveLength(1);
  });

  it("enforces 500 entries and a 24-hour TTL", async () => {
    const state = await handle({ operation: "setCapture", enabled: true });
    const batch = Array.from({ length: 500 }, (_, index) => entry(`event-${index}`, Date.now() - index));
    await handle({ operation: "append", generation: state.generation, entries: batch });
    const result = await handle({ operation: "append", generation: state.generation, entries: [entry("fresh"), entry("expired", Date.now() - TRACE_LOG_TTL_MS - 1)] });
    expect(result.entries).toHaveLength(500);
    expect(result.entries.some(value => value.id === "fresh")).toBe(true);
    expect(result.entries.some(value => value.id === "expired")).toBe(false);
    expect(result.entries.some(value => value.id === "event-499")).toBe(false);
  });

  it("bounds serialized UTF-8 bytes and truncates oversized or unserializable payloads", async () => {
    const state = await handle({ operation: "setCapture", enabled: true });
    const circular: Record<string, unknown> = {}; circular.self = circular;
    const batch = Array.from({ length: 500 }, (_, index) => entry(`large-${index}`, Date.now() - index, { message: "あ".repeat(3000) }));
    await handle({ operation: "append", generation: state.generation, entries: batch });
    const result = await handle({ operation: "append", generation: state.generation, entries: [entry("huge", Date.now(), { message: "あ".repeat(100_000) }), entry("circular", Date.now(), circular)] });
    expect(result.entries.length).toBeLessThan(500);
    expect(result.entries.find(value => value.id === "huge")?.payload?.truncated).toBe(true);
    expect(result.entries.find(value => value.id === "circular")?.payload?.truncated).toBe(true);
    expect(result.entries.every(value => traceBytes(value) <= TRACE_ENTRY_MAX_BYTES)).toBe(true);
    expect(traceBytes(values)).toBeLessThanOrEqual(TRACE_MAX_BYTES);
  });

  it("does not rewrite unchanged reads or stale appends", async () => {
    const state = await handle({ operation: "setCapture", enabled: true });
    set.mockClear();
    await handle({ operation: "get" });
    await handle({ operation: "get" });
    await handle({ operation: "append", generation: `${state.generation}-old`, entries: [entry("old")] });
    expect(set).not.toHaveBeenCalled();
  });

  it("migrates old entries, preserving capture opt-out and safe retention", async () => {
    values[TRACE_CAPTURE_STORAGE_KEY] = true;
    values[TRACE_LOG_STORAGE_KEY] = [{ timestamp: Date.now(), source: "content", level: "info", event: "legacy" }];
    const result = await handle({ operation: "get" });
    expect(result.entries[0]).toMatchObject({ event: "legacy", id: expect.any(String) });
    expect(values[TRACE_STATE_STORAGE_KEY]).toMatchObject({ generation: result.generation });
    values[TRACE_CAPTURE_STORAGE_KEY] = false;
    expect((await handle({ operation: "get" })).entries).toEqual([]);
    expect(values[TRACE_LOG_STORAGE_KEY]).toEqual([]);
  });

  it("preserves the previous durable ring if an append fails and retries safely", async () => {
    const state = await handle({ operation: "setCapture", enabled: true });
    set.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(handle({ operation: "append", generation: state.generation, entries: [entry("retry")] })).rejects.toThrow("quota exceeded");
    expect(values[TRACE_LOG_STORAGE_KEY]).toEqual([]);
    const result = await handle({ operation: "append", generation: state.generation, entries: [entry("retry")] });
    expect(result.entries.map(value => value.id)).toEqual(["retry"]);
  });
});
