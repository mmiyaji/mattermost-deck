import {
  TRACE_CAPTURE_STORAGE_KEY, TRACE_LOG_STORAGE_KEY, TRACE_STATE_STORAGE_KEY,
  TRACE_LOG_LIMIT, retainTraceEntries, sanitizeTraceEntry,
  type TraceLogEntry, type TraceStorageRequest, type TraceStorageSnapshot,
} from "./traceProtocol";

// This module is background-only. Never import traceLog here: recording our own
// persistence or notification operations would recursively append more traces.
let queue: Promise<unknown> = Promise.resolve();

export async function handleTraceStorageRequest(
  message: TraceStorageRequest,
  sender?: chrome.runtime.MessageSender,
): Promise<TraceStorageSnapshot> {
  if (!message || !["get", "append", "clear", "setCapture"].includes(message.operation) ||
      (message.operation === "append" && (typeof message.generation !== "string" || !Array.isArray(message.entries) || message.entries.length > TRACE_LOG_LIMIT)) ||
      (message.operation === "setCapture" && typeof message.enabled !== "boolean")) throw new Error("Invalid trace storage request");
  const task = queue.catch(() => undefined).then(async () => {
    const stored = await chrome.storage.local.get([TRACE_CAPTURE_STORAGE_KEY, TRACE_LOG_STORAGE_KEY, TRACE_STATE_STORAGE_KEY]);
    const state = stored[TRACE_STATE_STORAGE_KEY] as { generation?: unknown; revision?: unknown } | undefined;
    const generation = typeof state?.generation === "string" && state.generation ? state.generation : crypto.randomUUID();
    const revision = typeof state?.revision === "number" && Number.isSafeInteger(state.revision) && state.revision >= 0 ? state.revision : 0;
    const rawEntries = Array.isArray(stored[TRACE_LOG_STORAGE_KEY]) ? stored[TRACE_LOG_STORAGE_KEY] as TraceLogEntry[] : [];
    const now = Date.now();
    const entries = rawEntries.map((entry, index) => sanitizeTraceEntry({ ...entry, id: entry?.id ?? `legacy-${generation}-${index}` }, now))
      .filter((entry): entry is TraceLogEntry => entry !== null);
    const result: TraceStorageSnapshot = {
      captureEnabled: stored[TRACE_CAPTURE_STORAGE_KEY] === true,
      generation, revision, entries: stored[TRACE_CAPTURE_STORAGE_KEY] === true ? retainTraceEntries(entries, now) : [],
    };
    if (message.operation === "clear" || (message.operation === "setCapture" && !message.enabled)) {
      result.generation = crypto.randomUUID();
      result.entries = [];
    }
    if (message.operation === "setCapture") result.captureEnabled = message.enabled!;
    if (message.operation === "append" && result.captureEnabled && message.generation === result.generation) {
      const context: TraceLogEntry["context"] = {};
      try { if (sender?.url || sender?.origin) context.origin = new URL(sender.url ?? sender.origin!).origin; } catch { /* No page provenance available. */ }
      if (sender?.tab?.id !== undefined) context.tabId = sender.tab.id;
      const existingIds = new Set(result.entries.map(entry => entry.id));
      const incoming = message.entries!.map(entry => sanitizeTraceEntry({ ...entry, ...(Object.keys(context).length ? { context } : {}) }, now))
        .filter((entry): entry is TraceLogEntry => entry !== null && !existingIds.has(entry.id));
      result.entries = retainTraceEntries([...incoming, ...result.entries], now);
    }
    // A read only writes when it must migrate or prune. This prevents the
    // storage.onChanged -> read notification path from feeding back forever.
    const changed = stored[TRACE_CAPTURE_STORAGE_KEY] !== result.captureEnabled ||
      state?.generation !== result.generation || state?.revision !== result.revision ||
      JSON.stringify(rawEntries) !== JSON.stringify(result.entries);
    if (changed) {
      result.revision += 1;
      // One storage update and one writer keep generation, flag and ring coherent.
      await chrome.storage.local.set({
        [TRACE_CAPTURE_STORAGE_KEY]: result.captureEnabled,
        [TRACE_LOG_STORAGE_KEY]: result.entries,
        [TRACE_STATE_STORAGE_KEY]: { generation: result.generation, revision: result.revision },
      });
    }
    return result;
  });
  queue = task;
  return task;
}
