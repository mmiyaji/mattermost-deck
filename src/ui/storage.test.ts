import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDeckLayout, normaliseColumns } from "./storage";
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
