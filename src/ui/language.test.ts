import { describe, expect, it } from "vitest";
import { normaliseDeckLanguage, resolveDeckLanguage } from "./language";

describe("Deck language resolution", () => {
  it.each([
    ["ja-JP", "ja"],
    ["en_US", "en"],
    ["de-AT", "de"],
    ["fr-CA", "fr"],
    ["zh-Hans-CN", "zh-CN"],
    ["zh-SG", "zh-CN"],
  ] as const)("normalises %s to %s", (input, expected) => {
    expect(normaliseDeckLanguage(input)).toBe(expected);
  });

  it("prefers a saved language over Chrome and navigator languages", () => {
    expect(resolveDeckLanguage("fr", "de-DE", ["ja-JP"])).toBe("fr");
  });

  it("uses the Chrome UI language before navigator for empty storage", () => {
    expect(resolveDeckLanguage(undefined, "de-DE", ["fr-FR"])).toBe("de");
  });

  it("uses navigator after an unsupported Chrome UI language and otherwise English", () => {
    expect(resolveDeckLanguage(undefined, "es-ES", ["ja-JP"])).toBe("ja");
    expect(resolveDeckLanguage(undefined, "es-ES", ["it-IT"])).toBe("en");
  });
});
