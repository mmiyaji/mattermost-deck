import { describe, expect, it } from "vitest";
import { extractHighlightKeywords, tokenizePostText } from "./postText";

describe("extractHighlightKeywords", () => {
  it("splits on Japanese and ASCII delimiters", () => {
    expect(extractHighlightKeywords("alpha、beta;gamma；delta epsilon")).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
    ]);
  });
});

describe("tokenizePostText", () => {
  it("detects URLs even when multibyte text is immediately before https", () => {
    const tokens = tokenizePostText("日本語https://example.com/path?x=1");

    expect(tokens).toEqual([
      { type: "text", raw: "日本語", display: "日本語" },
      {
        type: "url",
        raw: "https://example.com/path?x=1",
        display: "https://example.com/path?x=1",
        href: "https://example.com/path?x=1",
      },
    ]);
  });

  it("truncates long non-url tokens for display only", () => {
    const longToken = "a".repeat(80);
    const [token] = tokenizePostText(longToken);

    expect(token).toMatchObject({
      type: "text",
      raw: longToken,
    });
    expect(token.display.endsWith("...")).toBe(true);
    expect(token.display.length).toBeLessThan(longToken.length);
  });

  it("keeps full href while truncating displayed URLs", () => {
    const longUrl = "https://example.com/" + "path/".repeat(20);
    const [token] = tokenizePostText(longUrl);

    expect(token).toMatchObject({
      type: "url",
      raw: longUrl,
      href: longUrl,
    });
    expect(token.display.endsWith("...")).toBe(true);
    expect(token.display.length).toBeLessThan(longUrl.length);
  });

  it("keeps trailing punctuation outside the detected URL", () => {
    const tokens = tokenizePostText("詳細はこちらhttps://example.com/path)。");

    expect(tokens).toEqual([
      { type: "text", raw: "詳細はこちら", display: "詳細はこちら" },
      {
        type: "url",
        raw: "https://example.com/path",
        display: "https://example.com/path",
        href: "https://example.com/path",
      },
      { type: "text", raw: ")。", display: ")。" },
    ]);
  });
});
