import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTraceEntry,
  clearTraceEntries,
  getTraceEntries,
  isTraceCaptureEnabled,
  setTraceCaptureEnabled,
} from "./traceLog";

describe("traceLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });
    clearTraceEntries();
    setTraceCaptureEnabled(false);
  });

  it("does not record entries when capture is disabled", () => {
    addTraceEntry({ source: "api", level: "info", event: "request" });
    expect(getTraceEntries()).toEqual([]);
  });

  it("records entries when capture is enabled", () => {
    setTraceCaptureEnabled(true);
    expect(isTraceCaptureEnabled()).toBe(true);

    addTraceEntry({ source: "api", level: "info", event: "request", payload: { path: "/api/v4/users/me" } });

    expect(getTraceEntries()).toEqual([
      expect.objectContaining({
        source: "api",
        level: "info",
        event: "request",
        payload: { path: "/api/v4/users/me" },
      }),
    ]);
  });

  it("clears stored entries when capture is turned off", () => {
    setTraceCaptureEnabled(true);
    addTraceEntry({ source: "api", level: "info", event: "request" });
    expect(getTraceEntries()).toHaveLength(1);

    setTraceCaptureEnabled(false);

    expect(getTraceEntries()).toEqual([]);
  });

  it("drops entries older than the ttl", () => {
    setTraceCaptureEnabled(true);
    addTraceEntry({
      source: "api",
      level: "info",
      event: "old-request",
      timestamp: Date.now() - (25 * 60 * 60 * 1000),
    });
    addTraceEntry({
      source: "api",
      level: "info",
      event: "fresh-request",
      timestamp: Date.now(),
    });

    expect(getTraceEntries()).toEqual([
      expect.objectContaining({
        event: "fresh-request",
      }),
    ]);
  });
});
