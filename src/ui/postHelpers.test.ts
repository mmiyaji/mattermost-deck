import { describe, expect, it } from "vitest";
import { buildDefaultHighlightTerms, resolveHighlightTerms } from "./postHelpers";

describe("buildDefaultHighlightTerms", () => {
  it("returns mention-oriented defaults for the current user", () => {
    expect(buildDefaultHighlightTerms("alice")).toEqual(["@alice", "@all", "@here", "@channel"]);
  });

  it("returns no defaults when the username is missing", () => {
    expect(buildDefaultHighlightTerms(null)).toEqual([]);
    expect(buildDefaultHighlightTerms("")).toEqual([]);
  });
});

describe("resolveHighlightTerms", () => {
  it("prefers configured keywords when present", () => {
    expect(resolveHighlightTerms("deploy,error", "alice")).toEqual(["deploy", "error"]);
  });

  it("falls back to mention-oriented defaults when no keywords are configured", () => {
    expect(resolveHighlightTerms("", "alice")).toEqual(["@alice", "@all", "@here", "@channel"]);
  });
});
