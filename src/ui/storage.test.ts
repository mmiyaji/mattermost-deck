import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasStoredValue,
  loadDeckLayout,
  loadStoredString,
  normaliseColumns,
  saveStoredString,
} from "./storage";
import type { DeckColumn } from "./layout";

const layout: DeckColumn[] = [
  { id: "mentions", type: "mentions" },
  { id: "search-1", type: "search", teamId: "team-1", query: "release" },
];

function createLocalStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("normaliseColumns", () => {
  it("accepts legacy layout payload objects", () => {
    expect(normaliseColumns({ columns: layout })).toEqual(layout);
  });
});

describe("loadDeckLayout", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to window localStorage when chrome storage has no layout", async () => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorage({
        "mattermostDeck.layout.v1": JSON.stringify({ columns: layout }),
      }),
    });
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
        },
      },
    });

    await expect(loadDeckLayout("mattermostDeck.layout.v1")).resolves.toEqual(layout);
  });
});

describe("session-only storage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("never reads a session secret from persistent localStorage when session storage fails", async () => {
    const localStorage = createLocalStorage({ secret: "persistent-secret" });
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn(async () => {
            throw new Error("session unavailable");
          }),
        },
      },
    });

    await expect(loadStoredString("secret", "session")).resolves.toBeNull();
    await expect(hasStoredValue("secret", "session")).resolves.toBe(false);
    expect(localStorage.getItem).not.toHaveBeenCalled();
  });

  it("fails closed instead of persisting a session secret to localStorage", async () => {
    const localStorage = createLocalStorage();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          set: vi.fn(async () => {
            throw new Error("session quota exceeded");
          }),
          remove: vi.fn(async () => undefined),
        },
      },
    });

    await expect(saveStoredString("secret", "encrypted", "session"))
      .rejects.toThrow("session quota exceeded");
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
