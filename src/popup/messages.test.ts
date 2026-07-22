import { describe, expect, it } from "vitest";
import { getPopupMessages, resolvePopupLocale } from "./messages";

describe("popup messages", () => {
  it.each([
    ["ja-JP", "ja"],
    ["de-DE", "de"],
    ["fr-FR", "fr"],
    ["zh-Hans-CN", "zh-CN"],
    ["en-US", "en"],
  ] as const)("resolves %s", (input, expected) => {
    expect(resolvePopupLocale(input)).toBe(expected);
  });

  it("prefers the configured language over the browser language", () => {
    expect(resolvePopupLocale("fr", ["ja-JP"])).toBe("fr");
  });

  it("falls back to English for unsupported languages", () => {
    expect(resolvePopupLocale("es-ES")).toBe("en");
    expect(getPopupMessages("en").installApp).toBe("Install Mattermost app");
    expect(getPopupMessages("ja").installFailed).toContain("Server URL");
  });
});
