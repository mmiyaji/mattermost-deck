import { describe, expect, it } from "vitest";
import { detectBrowser, getInstallMessages, resolveInstallLocale, type BrowserKind, type InstallLocale } from "./installGuide";

describe("PWA install guide localization", () => {
  it.each([
    [["ja-JP", "en-US"], "ja"],
    [["de-DE"], "de"],
    [["fr-CA"], "fr"],
    [["zh-Hans-CN"], "zh-CN"],
    [["en-GB"], "en"],
    [["es-ES"], "en"],
  ] satisfies Array<[string[], InstallLocale]>)('resolves %j to "%s"', (languages, expected) => {
    expect(resolveInstallLocale(languages)).toBe(expected);
  });

  it("provides a localized instruction for every supported browser", () => {
    const locales: InstallLocale[] = ["de", "en", "fr", "ja", "zh-CN"];
    const browsers: BrowserKind[] = ["chrome", "edge", "firefox", "safari", "chromium", "other"];

    for (const locale of locales) {
      const messages = getInstallMessages(locale);
      expect(messages.manualTitle.length).toBeGreaterThan(0);
      for (const browser of browsers) {
        expect(messages.manualInstructions[browser].length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps English guidance free of the previous Japanese-only fallback", () => {
    const messages = getInstallMessages("en");
    expect(messages.manualInstructions.chrome).toContain("Install page as app");
    expect(messages.manualInstructions.chrome).not.toContain("インストール");
  });
});

describe("browser-specific PWA instructions", () => {
  it.each([
    ["Mozilla/5.0 Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0", [], "edge"],
    ["Mozilla/5.0 Chrome/146.0.0.0 Safari/537.36", ["Google Chrome", "Chromium"], "chrome"],
    ["Mozilla/5.0 Firefox/140.0", [], "firefox"],
    ["Mozilla/5.0 Version/26.0 Safari/619.1", [], "safari"],
    ["Mozilla/5.0 Chrome/146.0.0.0 Safari/537.36 OPR/118.0", [], "chromium"],
    ["Mozilla/5.0 Chromium/146.0.0.0 Safari/537.36", ["Chromium"], "chromium"],
    ["custom-browser", [], "other"],
  ] satisfies Array<[string, string[], BrowserKind]>)('detects "%s" as %s', (userAgent, brands, expected) => {
    expect(detectBrowser(userAgent, brands)).toBe(expected);
  });
});
