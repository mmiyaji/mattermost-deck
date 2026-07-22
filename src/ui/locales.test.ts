import { describe, expect, it } from "vitest";
import de from "./locales/de.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import zhCn from "./locales/zh-CN.json";

interface LocaleTree {
  [key: string]: string | LocaleTree;
}

function flattenLocale(value: LocaleTree, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof child === "string" ? [[path, child]] : Object.entries(flattenLocale(child, path));
    }),
  );
}

const locales = { ja, de, fr, "zh-CN": zhCn } as const;
const english = flattenLocale(en);

describe("UI locale coverage", () => {
  it.each(Object.entries(locales))("keeps %s keys in parity with English", (_locale, resource) => {
    const translated = flattenLocale(resource);
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    expect(Object.values(translated).every((value) => value.trim().length > 0)).toBe(true);
  });

  it.each(Object.entries(locales))("does not fall back to English for critical %s guidance", (_locale, resource) => {
    const translated = flattenLocale(resource);
    for (const key of [
      "deck.startWithChannel",
      "deck.failedToLoadPosts",
      "deck.loadingSearchResults",
      "deck.noSavedPosts",
      "deck.diagnosticsTitle",
      "options.performanceTitle",
      "options.releaseNotesOpen",
    ]) {
      expect(translated[key]).not.toBe(english[key]);
    }
  });
});
