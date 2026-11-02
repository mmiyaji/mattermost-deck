import {
  TRACE_STORAGE_MESSAGE, TRACE_CAPTURE_STORAGE_KEY, TRACE_LOG_STORAGE_KEY, TRACE_STATE_STORAGE_KEY,
  retainTraceEntries, sanitizeTraceEntry,
  type TraceLogEntry, type TraceStorageRequest, type TraceStorageSnapshot,
} from "./traceProtocol";
export type { TraceLogEntry, TraceLogLevel, TraceLogSource } from "./traceProtocol";

const TRACE_FLUSH_DELAY_MS = 250;
let captureEnabled = false;
let acknowledgedCaptureEnabled: boolean | null = null;
let confirmed: TraceLogEntry[] = [];
let generation: string | null = null;
let revision = -1;
let initPromise: Promise<void> | null = null;
let operations: Promise<unknown> = Promise.resolve();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let refreshPending = false;
let refreshAgain = false;
let controlsPending = 0;
let runtimeDisposed = false;
let storageChangeListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | null = null;
const pending = new Map<string, { entry: TraceLogEntry; generation: string | null }>();
const listeners = new Set<() => void>();
const contextId = typeof globalThis.crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
let sequence = 0;

function hasRuntime(): boolean {
  return typeof chrome !== "undefined" && typeof chrome.runtime?.sendMessage === "function";
}
function notify(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* A diagnostics view must not break the app. */ }
  }
}
function view(): TraceLogEntry[] { return retainTraceEntries([...pending.values()].reverse().map(value => value.entry).concat(confirmed)); }
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const task = operations.catch(() => undefined).then(operation);
  operations = task.catch(() => undefined);
  return task;
}
async function send(message: TraceStorageRequest): Promise<TraceStorageSnapshot> {
  const response = await chrome.runtime.sendMessage({ type: TRACE_STORAGE_MESSAGE, ...message }) as TraceStorageSnapshot & { success?: boolean };
  if (!response?.success || typeof response.generation !== "string" || !Number.isSafeInteger(response.revision) ||
      typeof response.captureEnabled !== "boolean" || !Array.isArray(response.entries)) throw new Error("Trace storage unavailable");
  return response;
}
function accept(snapshot: TraceStorageSnapshot): void {
  if (runtimeDisposed || snapshot.revision < revision) return;
  revision = snapshot.revision;
  acknowledgedCaptureEnabled = snapshot.captureEnabled;
  // A local clear/toggle stays optimistic until its serialized control request
  // acknowledges. An older read must not undo that action or its new entries.
  if (controlsPending) return;
  if (generation !== snapshot.generation) {
    for (const [id, item] of pending) if (item.generation !== null && item.generation !== snapshot.generation) pending.delete(id);
  }
  generation = snapshot.generation;
  for (const item of pending.values()) if (item.generation === null) item.generation = generation;
  captureEnabled = snapshot.captureEnabled;
  if (!captureEnabled) pending.clear();
  confirmed = retainTraceEntries(snapshot.entries);
  for (const entry of confirmed) if (entry.id) pending.delete(entry.id);
  notify();
}
function refresh(): void {
  if (runtimeDisposed || !hasRuntime()) return;
  if (refreshPending) { refreshAgain = true; return; }
  refreshPending = true;
  void enqueue(async () => {
    try {
      do {
        refreshAgain = false;
        if (!runtimeDisposed) accept(await send({ operation: "get" }));
      } while (refreshAgain && !runtimeDisposed);
    }
    finally { refreshPending = false; }
  }).catch(() => undefined);
}
function acceptStorageChanges(changes: Record<string, chrome.storage.StorageChange>): boolean {
  const state = changes[TRACE_STATE_STORAGE_KEY]?.newValue as { generation?: unknown; revision?: unknown } | undefined;
  if (!state || typeof state.generation !== "string" || !state.generation ||
      typeof state.revision !== "number" || !Number.isSafeInteger(state.revision) || state.revision < 0) return false;
  if (state.revision < revision) return true;
  const hasEntries = TRACE_LOG_STORAGE_KEY in changes;
  const hasCapture = TRACE_CAPTURE_STORAGE_KEY in changes;
  const entries = changes[TRACE_LOG_STORAGE_KEY]?.newValue;
  const capture = changes[TRACE_CAPTURE_STORAGE_KEY]?.newValue;
  if (hasEntries && (!Array.isArray(entries) || !entries.every(entry => entry && typeof entry === "object" &&
      typeof entry.id === "string" && typeof entry.timestamp === "number"))) return false;
  if (hasCapture && typeof capture !== "boolean") return false;
  // Omitted keys are unchanged in the writer's atomic update. Reuse only an
  // acknowledged baseline; missed revisions or startup still need a full read.
  if ((!hasCapture && acknowledgedCaptureEnabled === null) ||
      (state.revision > revision + 1 && (!hasEntries || !hasCapture))) return false;
  accept({
    generation: state.generation, revision: state.revision,
    captureEnabled: hasCapture ? capture as boolean : acknowledgedCaptureEnabled!,
    entries: hasEntries ? entries as TraceLogEntry[] : generation !== null && generation !== state.generation ? [] : confirmed,
  });
  return true;
}
function ensureInitialised(): void {
  if (runtimeDisposed || initPromise) return;
  if (!hasRuntime()) { initPromise = Promise.resolve(); return; }
  if (chrome.storage?.onChanged) {
    storageChangeListener = (changes, areaName) => {
      if (areaName === "local" && [TRACE_CAPTURE_STORAGE_KEY, TRACE_LOG_STORAGE_KEY, TRACE_STATE_STORAGE_KEY].some(key => key in changes) &&
          !acceptStorageChanges(changes)) refresh();
    };
    chrome.storage.onChanged.addListener(storageChangeListener);
  }
  initPromise = enqueue(async () => { if (!runtimeDisposed) accept(await send({ operation: "get" })); }).catch(() => undefined);
}
function cancelFlush(): void {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
}
function scheduleFlush(): void {
  if (runtimeDisposed || flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void enqueue(async () => {
      if (runtimeDisposed || !captureEnabled || !pending.size) return;
      if (!hasRuntime()) {
        confirmed = view(); pending.clear(); notify(); return;
      }
      if (generation === null) accept(await send({ operation: "get" }));
      if (generation === null || !captureEnabled || !pending.size) return;
      const batch = [...pending.values()].reverse().map(value => value.entry);
      accept(await send({ operation: "append", generation, entries: batch }));
      // A successful append also acknowledges entries evicted by the global
      // bounds. Retrying a failed/unknown delivery preserves their stable IDs.
      for (const entry of batch) pending.delete(entry.id!);
      notify();
    }).catch(() => undefined);
  }, TRACE_FLUSH_DELAY_MS);
}
function control(message: TraceStorageRequest): void {
  if (!hasRuntime()) { generation = `${contextId}-${++sequence}`; return; }
  controlsPending += 1;
  void enqueue(async () => {
    let snapshot: TraceStorageSnapshot | undefined;
    try {
      if (runtimeDisposed) return;
      snapshot = await send(message);
    } catch { /* Diagnostics remain best-effort after persistence failures. */ }
    finally { controlsPending -= 1; }
    if (snapshot) accept(snapshot);
  }).catch(() => undefined);
}

export function isTraceCaptureEnabled(): boolean {
  if (runtimeDisposed) return false;
  ensureInitialised(); return captureEnabled;
}
export function setTraceCaptureEnabled(enabled: boolean): void {
  if (runtimeDisposed) return;
  ensureInitialised();
  captureEnabled = enabled;
  if (!enabled) { pending.clear(); confirmed = []; generation = null; cancelFlush(); }
  notify();
  control({ operation: "setCapture", enabled });
}
export function clearTraceEntries(): void {
  if (runtimeDisposed) return;
  ensureInitialised();
  pending.clear(); confirmed = []; generation = null; cancelFlush(); notify();
  control({ operation: "clear" });
}
export function addTraceEntry(entry: Omit<TraceLogEntry, "timestamp"> & { timestamp?: number }): void {
  if (runtimeDisposed) return;
  ensureInitialised();
  if (!captureEnabled) return;
  const value = sanitizeTraceEntry({ ...entry, id: `${contextId}-${++sequence}`, timestamp: entry.timestamp ?? Date.now() });
  if (!value) return;
  pending.set(value.id!, { entry: value, generation });
  const retainedIds = new Set(view().map(entry => entry.id));
  for (const id of pending.keys()) if (!retainedIds.has(id)) pending.delete(id);
  notify(); scheduleFlush();
}
export function getTraceEntries(): TraceLogEntry[] {
  if (runtimeDisposed) return [];
  ensureInitialised(); return view();
}
export function subscribeTraceEntries(listener: () => void): () => void {
  if (runtimeDisposed) return () => undefined;
  ensureInitialised(); listeners.add(listener); return () => listeners.delete(listener);
}
export function disposeTraceLogRuntime(): void {
  if (runtimeDisposed) return;
  runtimeDisposed = true; cancelFlush();
  if (storageChangeListener && typeof chrome !== "undefined" && chrome.storage?.onChanged) chrome.storage.onChanged.removeListener(storageChangeListener);
  storageChangeListener = null; listeners.clear(); pending.clear(); confirmed = []; captureEnabled = false;
}

ensureInitialised();
