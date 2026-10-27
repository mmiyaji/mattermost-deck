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
  it("preserves review mode and source conditions in layout exports and restores", () => {
    const review = { id: "review", type: "mentions", teamId: "team", unreadOnly: true, mentionReview: true, row: 1 };
    expect(normaliseColumns(JSON.parse(JSON.stringify([review])))).toEqual([review]);
    expect(normaliseColumns([{ id: "ordinary", type: "search", mentionReview: true }])[0]).not.toHaveProperty("mentionReview");
  });
  it("retains valid individual widths, clamps bounds, and ignores invalid widths without dropping panes", () => {
    const widths = [360, 100, 9999, NaN, "400", undefined];
    const result = normaliseColumns(widths.map((width, index) => ({ id: String(index), type: "favorites", width })));
    expect(result).toHaveLength(6);
    expect(result.map(column => column.width)).toEqual([360, 200, 800, undefined, undefined, undefined]);
  });

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

it("retains valid pane rows and ignores invalid imported row assignments", () => {
  const result = normaliseColumns([
    {id:'top',type:'favorites',row:0}, {id:'bottom',type:'saved',row:1},
    {id:'invalid',type:'search',row:2}, {id:'legacy',type:'mentions'},
  ]);
  expect(result.map(column => column.row)).toEqual([0,1,undefined,undefined]);
});


describe("pane aliases in imported and saved layouts", () => {
  it("preserves aliases for all pane types and normalizes only the optional title", () => {
    const types = ["mentions", "channelWatch", "dmWatch", "search", "keywordWatch", "favorites", "saved", "diagnostics"];
    const columns = types.map((type, index) => ({ id: String(index), type, customTitle: "  Team\n  notes  " }));
    expect(normaliseColumns({ columns }).map(column => column.customTitle)).toEqual(types.map(() => "Team notes"));
    expect(normaliseColumns([{ id: "a", type: "favorites", customTitle: 123 }])).toHaveLength(1);
    expect(normaliseColumns([{ id: "a", type: "favorites", customTitle: "   " }])[0].customTitle).toBeUndefined();
    expect(normaliseColumns([{ id: "a", type: "favorites", customTitle: "x".repeat(120) }])[0].customTitle).toHaveLength(100);
  });
});
