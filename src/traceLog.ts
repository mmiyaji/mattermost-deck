export type TraceLogLevel = "info" | "warn" | "error";
export type TraceLogSource = "app" | "content" | "api" | "ws";

export interface TraceLogEntry {
  timestamp: number;
  source: TraceLogSource;
  level: TraceLogLevel;
  event: string;
  payload?: Record<string, unknown>;
}

const TRACE_CAPTURE_STORAGE_KEY = "mattermostDeck.traceCapture.v1";
const TRACE_LOG_STORAGE_KEY = "mattermostDeck.traceEntries.v1";
const TRACE_LOG_LIMIT = 500;
const TRACE_FLUSH_DELAY_MS = 250;
const TRACE_LOG_TTL_MS = 24 * 60 * 60 * 1000;

let captureEnabled = false;
let entries: TraceLogEntry[] = [];
let initPromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let storageChangeListener:
  | ((
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => void)
  | null = null;
let runtimeDisposed = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function pruneExpiredEntries(nextEntries: TraceLogEntry[], now = Date.now()): TraceLogEntry[] {
  return nextEntries.filter((entry) => now - entry.timestamp <= TRACE_LOG_TTL_MS);
}

function applyEntryRetention(nextEntries: TraceLogEntry[], now = Date.now()): TraceLogEntry[] {
  return pruneExpiredEntries(nextEntries, now).slice(0, TRACE_LOG_LIMIT);
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

async function readStorage<T>(key: string, fallback: T): Promise<T> {
  if (hasChromeStorage()) {
    const payload = await chrome.storage.local.get(key);
    return (payload[key] as T | undefined) ?? fallback;
  }

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeStorage<T>(key: string, value: T): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function ensureBoundStorageListener(): void {
  if (
    runtimeDisposed ||
    !hasChromeStorage() ||
    storageChangeListener
  ) {
    return;
  }

  storageChangeListener = (changes, areaName) => {
    if (runtimeDisposed || areaName !== "local") {
      return;
    }

    if (TRACE_CAPTURE_STORAGE_KEY in changes) {
      captureEnabled = changes[TRACE_CAPTURE_STORAGE_KEY]?.newValue === true;
      notify();
    }

    if (TRACE_LOG_STORAGE_KEY in changes) {
      entries = Array.isArray(changes[TRACE_LOG_STORAGE_KEY]?.newValue)
        ? applyEntryRetention(changes[TRACE_LOG_STORAGE_KEY].newValue as TraceLogEntry[])
        : [];
      notify();
    }
  };
  chrome.storage.onChanged.addListener(storageChangeListener);
}

async function initTraceLog(): Promise<void> {
  const nextCaptureEnabled = await readStorage<boolean>(
    TRACE_CAPTURE_STORAGE_KEY,
    false,
  );
  const nextEntries = applyEntryRetention(
    await readStorage<TraceLogEntry[]>(
      TRACE_LOG_STORAGE_KEY,
      [],
    ),
  );
  if (runtimeDisposed) {
    return;
  }
  captureEnabled = nextCaptureEnabled;
  entries = nextEntries;
  await writeStorage(TRACE_LOG_STORAGE_KEY, entries);
  if (runtimeDisposed) {
    return;
  }
  ensureBoundStorageListener();
  notify();
}

function ensureInitialised(): void {
  if (runtimeDisposed || initPromise) {
    return;
  }
  initPromise = initTraceLog().catch(() => undefined);
}

async function flushEntries(): Promise<void> {
  flushTimer = null;
  if (runtimeDisposed) {
    return;
  }
  await writeStorage(TRACE_LOG_STORAGE_KEY, entries);
}

function scheduleFlush(): void {
  if (runtimeDisposed || flushTimer !== null) {
    return;
  }

  flushTimer = globalThis.setTimeout(() => {
    void flushEntries();
  }, TRACE_FLUSH_DELAY_MS);
}

export function isTraceCaptureEnabled(): boolean {
  if (runtimeDisposed) {
    return false;
  }
  ensureInitialised();
  return captureEnabled;
}

export function setTraceCaptureEnabled(enabled: boolean): void {
  if (runtimeDisposed) {
    return;
  }
  ensureInitialised();
  captureEnabled = enabled;
  if (!enabled) {
    entries = [];
  }
  notify();
  if (!enabled && flushTimer !== null) {
    globalThis.clearTimeout(flushTimer);
    flushTimer = null;
  }
  void writeStorage(TRACE_CAPTURE_STORAGE_KEY, enabled);
  if (!enabled) {
    void writeStorage(TRACE_LOG_STORAGE_KEY, entries);
  }
}

export function clearTraceEntries(): void {
  if (runtimeDisposed) {
    return;
  }
  ensureInitialised();
  entries = [];
  notify();
  if (flushTimer !== null) {
    globalThis.clearTimeout(flushTimer);
    flushTimer = null;
  }
  void writeStorage(TRACE_LOG_STORAGE_KEY, entries);
}

export function addTraceEntry(entry: Omit<TraceLogEntry, "timestamp"> & { timestamp?: number }): void {
  if (runtimeDisposed) {
    return;
  }
  ensureInitialised();
  if (!captureEnabled) {
    return;
  }

  entries = applyEntryRetention([
    {
      timestamp: entry.timestamp ?? Date.now(),
      source: entry.source,
      level: entry.level,
      event: entry.event,
      payload: entry.payload,
    },
    ...entries,
  ]);
  notify();
  scheduleFlush();
}

export function getTraceEntries(): TraceLogEntry[] {
  if (runtimeDisposed) {
    return [];
  }
  ensureInitialised();
  const nextEntries = applyEntryRetention(entries);
  if (nextEntries.length !== entries.length) {
    entries = nextEntries;
    notify();
    scheduleFlush();
  }
  return entries.slice();
}

export function subscribeTraceEntries(listener: () => void): () => void {
  if (runtimeDisposed) {
    return () => undefined;
  }
  ensureInitialised();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function disposeTraceLogRuntime(): void {
  if (runtimeDisposed) {
    return;
  }
  runtimeDisposed = true;
  if (flushTimer !== null) {
    globalThis.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (storageChangeListener && hasChromeStorage()) {
    chrome.storage.onChanged.removeListener(
      storageChangeListener,
    );
  }
  storageChangeListener = null;
  listeners.clear();
  entries = [];
  captureEnabled = false;
}

ensureInitialised();
