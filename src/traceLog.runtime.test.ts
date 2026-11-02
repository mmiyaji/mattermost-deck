import { afterEach, describe, expect, it, vi } from "vitest";
import { TRACE_CAPTURE_STORAGE_KEY, TRACE_LOG_STORAGE_KEY, TRACE_STATE_STORAGE_KEY, type TraceStorageRequest, type TraceStorageSnapshot } from "./traceProtocol";

type Client = typeof import("./traceLog");
const clients: Client[] = [];

async function setup() {
  vi.useFakeTimers();
  vi.resetModules();
  const values: Record<string, unknown> = { [TRACE_CAPTURE_STORAGE_KEY]: true };
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
  const get = vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone(values[key])])));
  const set = vi.fn(async (next: Record<string, unknown>) => {
    const changes = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(values[key]) !== JSON.stringify(value))
      .map(([key, value]) => [key, { oldValue: values[key], newValue: structuredClone(value) }]));
    Object.assign(values, structuredClone(next));
    if (Object.keys(changes).length) for (const listener of listeners) listener(changes, "local");
  });
  const addListener = vi.fn((listener) => listeners.add(listener));
  const removeListener = vi.fn((listener) => listeners.delete(listener));
  const sendMessage = vi.fn(async (_message: TraceStorageRequest): Promise<TraceStorageSnapshot & { success: boolean }> => { throw new Error("Not connected"); });
  vi.stubGlobal("chrome", { storage: { local: { get, set }, onChanged: { addListener, removeListener } }, runtime: { sendMessage } });
  const backend = (await import("./traceStorage")).handleTraceStorageRequest;
  sendMessage.mockImplementation(async (message: TraceStorageRequest) => ({ success: true, ...await backend(message) }));
  const client = async () => {
    vi.resetModules();
    const result = await import("./traceLog");
    clients.push(result);
    await vi.advanceTimersByTimeAsync(0);
    return result;
  };
  return { values, backend, client, sendMessage, set, addListener, removeListener, listeners };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.disposeTraceLogRuntime();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("central trace client lifecycle", () => {
  it("retains both contexts' concurrent flushes and only appends local pending entries", async () => {
    const service = await setup();
    const a = await service.client(), b = await service.client();
    a.addTraceEntry({ source: "api", level: "info", event: "tab-a" });
    b.addTraceEntry({ source: "content", level: "info", event: "tab-b" });
    await vi.advanceTimersByTimeAsync(300);
    const stored = service.values[TRACE_LOG_STORAGE_KEY] as Array<{ event: string }>;
    expect(stored.map(entry => entry.event).sort()).toEqual(["tab-a", "tab-b"]);
    expect(a.getTraceEntries().map(entry => entry.event).sort()).toEqual(["tab-a", "tab-b"]);
    expect(b.getTraceEntries().map(entry => entry.event).sort()).toEqual(["tab-a", "tab-b"]);
    const appends = service.sendMessage.mock.calls.map(([message]) => message).filter(message => message.operation === "append");
    expect(appends).toHaveLength(2);
    expect(appends.every(message => message.entries?.length === 1)).toBe(true);
  });

  it("does not overwrite unflushed local entries when another tab changes storage", async () => {
    const service = await setup();
    const a = await service.client();
    a.addTraceEntry({ source: "api", level: "info", event: "local-pending" });
    const state = await service.backend({ operation: "get" });
    await service.backend({ operation: "append", generation: state.generation, entries: [{ id: "remote", timestamp: Date.now(), source: "ws", level: "info", event: "remote" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.getTraceEntries().map(entry => entry.event).sort()).toEqual(["local-pending", "remote"]);
    await vi.advanceTimersByTimeAsync(300);
    expect((service.values[TRACE_LOG_STORAGE_KEY] as unknown[])).toHaveLength(2);
  });

  it("consumes atomic notifications without rereading the full ring or losing pending IDs", async () => {
    const service = await setup();
    const a = await service.client();
    service.sendMessage.mockClear();
    a.addTraceEntry({ source: "api", level: "info", event: "local-pending" });
    const state = await service.backend({ operation: "get" });
    await service.backend({ operation: "append", generation: state.generation, entries: [{ id: "remote", timestamp: Date.now(), source: "ws", level: "info", event: "remote" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.getTraceEntries().map(entry => entry.event).sort()).toEqual(["local-pending", "remote"]);
    expect(service.sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(service.sendMessage.mock.calls.map(([message]) => message.operation)).toEqual(["append"]);
    expect((service.values[TRACE_LOG_STORAGE_KEY] as unknown[])).toHaveLength(2);
  });

  it("applies a generation-only clear notification without rereading or resurrecting pending logs", async () => {
    const service = await setup();
    const a = await service.client();
    service.sendMessage.mockClear();
    a.addTraceEntry({ source: "api", level: "info", event: "not-flushed" });
    // The durable ring is already empty, so Chrome emits only the state change.
    await service.backend({ operation: "clear" });
    await vi.advanceTimersByTimeAsync(300);
    expect(a.getTraceEntries()).toEqual([]);
    expect(a.isTraceCaptureEnabled()).toBe(true);
    expect(service.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to a full read for partial legacy changes and missed revisions", async () => {
    const service = await setup();
    const a = await service.client();
    service.sendMessage.mockClear();
    service.values[TRACE_CAPTURE_STORAGE_KEY] = false;
    for (const listener of service.listeners) listener({ [TRACE_CAPTURE_STORAGE_KEY]: { newValue: false } }, "local");
    await vi.advanceTimersByTimeAsync(0);
    expect(service.sendMessage.mock.calls.some(([message]) => message.operation === "get")).toBe(true);
    expect(a.isTraceCaptureEnabled()).toBe(false);
    service.sendMessage.mockClear();
    const state = service.values[TRACE_STATE_STORAGE_KEY] as { generation: string; revision: number };
    for (const listener of service.listeners) listener({ [TRACE_STATE_STORAGE_KEY]: { newValue: { ...state, revision: state.revision + 2 } } }, "local");
    await vi.advanceTimersByTimeAsync(0);
    expect(service.sendMessage.mock.calls.map(([message]) => message.operation)).toEqual(["get"]);
  });

  it.each(["clear", "off"])("rejects a delayed old-generation batch after remote %s", async operation => {
    const service = await setup();
    const a = await service.client();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    service.sendMessage.mockImplementation(async (message: TraceStorageRequest) => {
      if (message.operation === "append") await gate;
      return { success: true, ...await service.backend(message) };
    });
    a.addTraceEntry({ source: "api", level: "info", event: "stale" });
    await vi.advanceTimersByTimeAsync(300);
    await service.backend(operation === "clear" ? { operation: "clear" } : { operation: "setCapture", enabled: false });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.values[TRACE_LOG_STORAGE_KEY]).toEqual([]);
    expect(a.getTraceEntries()).toEqual([]);
    if (operation === "off") expect(a.isTraceCaptureEnabled()).toBe(false);
  });

  it("keeps bounded pending logs on transport failure and recovers without duplicates", async () => {
    const service = await setup();
    const a = await service.client();
    service.sendMessage.mockRejectedValue(new Error("context unavailable"));
    for (let index = 0; index < 2000; index++) a.addTraceEntry({ source: "api", level: "info", event: `request-${index}` });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(a.getTraceEntries()).toHaveLength(500);
    expect(a.getTraceEntries()[0]?.event).toBe("request-1999");
    expect(vi.getTimerCount()).toBe(0);
    service.sendMessage.mockImplementation(async (message: TraceStorageRequest) => ({ success: true, ...await service.backend(message) }));
    a.addTraceEntry({ source: "api", level: "info", event: "recovered" });
    await vi.advanceTimersByTimeAsync(300);
    expect((service.values[TRACE_LOG_STORAGE_KEY] as Array<{ event: string }>)[0]?.event).toBe("recovered");
    expect(a.getTraceEntries()).toHaveLength(500);
    a.setTraceCaptureEnabled(false);
    expect(a.getTraceEntries()).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.values[TRACE_LOG_STORAGE_KEY]).toEqual([]);
  });

  it("preserves immediate enable/clear actions and entries while initialization is pending", async () => {
    const service = await setup();
    service.values[TRACE_CAPTURE_STORAGE_KEY] = false;
    vi.resetModules();
    const a = await import("./traceLog"); clients.push(a);
    a.setTraceCaptureEnabled(true);
    a.addTraceEntry({ source: "api", level: "info", event: "after-enable" });
    await vi.advanceTimersByTimeAsync(300);
    expect(a.getTraceEntries().map(entry => entry.event)).toEqual(["after-enable"]);
    a.clearTraceEntries();
    a.addTraceEntry({ source: "api", level: "info", event: "after-clear" });
    await vi.advanceTimersByTimeAsync(300);
    expect(a.getTraceEntries().map(entry => entry.event)).toEqual(["after-clear"]);
  });

  it("removes its storage listener and pending flush when disposed", async () => {
    const service = await setup();
    const a = await service.client();
    a.addTraceEntry({ source: "content", level: "info", event: "runtime-test" });
    const beforeDispose = service.sendMessage.mock.calls.length;
    a.disposeTraceLogRuntime();
    expect(service.removeListener).toHaveBeenCalledWith(service.addListener.mock.calls[0]?.[0]);
    await vi.advanceTimersByTimeAsync(300);
    expect(service.sendMessage).toHaveBeenCalledTimes(beforeDispose);
    a.addTraceEntry({ source: "content", level: "info", event: "ignored" });
    expect(a.getTraceEntries()).toEqual([]);
  });
});
