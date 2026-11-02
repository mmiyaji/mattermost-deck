export const TRACE_STORAGE_MESSAGE = "mattermost-deck:trace-storage";
export const TRACE_CAPTURE_STORAGE_KEY = "mattermostDeck.traceCapture.v1";
export const TRACE_LOG_STORAGE_KEY = "mattermostDeck.traceEntries.v1";
export const TRACE_STATE_STORAGE_KEY = "mattermostDeck.traceState.v1";
export const TRACE_LOG_LIMIT = 500;
export const TRACE_LOG_TTL_MS = 24 * 60 * 60_000;
export const TRACE_MAX_BYTES = 1024 * 1024;
export const TRACE_ENTRY_MAX_BYTES = 16 * 1024;

export type TraceLogLevel = "info" | "warn" | "error";
export type TraceLogSource = "app" | "content" | "api" | "ws";
export interface TraceLogEntry {
  id?: string;
  timestamp: number;
  source: TraceLogSource;
  level: TraceLogLevel;
  event: string;
  payload?: Record<string, unknown>;
  context?: { origin?: string; tabId?: number };
}
export interface TraceStorageSnapshot {
  captureEnabled: boolean;
  generation: string;
  revision: number;
  entries: TraceLogEntry[];
}
export interface TraceStorageRequest {
  operation: "get" | "append" | "clear" | "setCapture";
  generation?: string;
  entries?: TraceLogEntry[];
  enabled?: boolean;
}

const encoder = new TextEncoder();
export const traceBytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).byteLength;

function truncateUtf8(value: string, maxBytes: number): string {
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let low = 0, high = Math.min(value.length, maxBytes);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
}

export function sanitizeTraceEntry(value: unknown, now = Date.now()): TraceLogEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as TraceLogEntry;
  if (!Number.isSafeInteger(entry.timestamp) || entry.timestamp < 0 || entry.timestamp > now + 5 * 60_000 ||
      now - entry.timestamp > TRACE_LOG_TTL_MS || !["app", "content", "api", "ws"].includes(entry.source) ||
      !["info", "warn", "error"].includes(entry.level) || typeof entry.event !== "string" ||
      typeof entry.id !== "string" || !entry.id || entry.id.length > 128) return null;
  const result: TraceLogEntry = { id: entry.id, timestamp: entry.timestamp, source: entry.source, level: entry.level, event: truncateUtf8(entry.event, 512) };
  if (entry.payload && typeof entry.payload === "object" && !Array.isArray(entry.payload)) {
    try {
      const serialized = JSON.stringify(entry.payload);
      const bytes = encoder.encode(serialized).byteLength;
      result.payload = bytes <= 12 * 1024 ? JSON.parse(serialized) as Record<string, unknown>
        : { truncated: true, originalBytes: bytes, preview: truncateUtf8(serialized, 8 * 1024) };
    } catch { result.payload = { truncated: true, reason: "Payload is not JSON serializable" }; }
  }
  if (entry.context && typeof entry.context === "object") {
    result.context = {};
    if (typeof entry.context.origin === "string") result.context.origin = truncateUtf8(entry.context.origin, 512);
    if (Number.isSafeInteger(entry.context.tabId)) result.context.tabId = entry.context.tabId;
  }
  // Escaping a truncated preview can make the JSON larger than its raw text.
  if (traceBytes(result) > TRACE_ENTRY_MAX_BYTES) result.payload = { truncated: true, reason: "Entry size limit" };
  return result;
}

export function retainTraceEntries(values: TraceLogEntry[], now = Date.now()): TraceLogEntry[] {
  const seen = new Set<string>();
  const result: TraceLogEntry[] = [];
  let bytes = 2;
  // Reserve space for the capture flag, generation/revision and storage keys.
  const budget = TRACE_MAX_BYTES - 1024;
  for (const entry of values.filter(entry => Number.isFinite(entry.timestamp) && now - entry.timestamp <= TRACE_LOG_TTL_MS)
    .sort((a, b) => b.timestamp - a.timestamp)) {
    if (!entry.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const nextBytes = traceBytes(entry) + (result.length ? 1 : 0);
    if (bytes + nextBytes > budget) break;
    result.push(entry);
    bytes += nextBytes;
    if (result.length >= TRACE_LOG_LIMIT) break;
  }
  return result;
}
