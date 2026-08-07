export type DeckLanguage = "ja" | "en" | "de" | "zh-CN" | "fr";

export function normaliseDeckLanguage(value: unknown): DeckLanguage | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalised = value.trim().replaceAll("_", "-").toLowerCase();
  if (normalised === "ja" || normalised.startsWith("ja-")) return "ja";
  if (normalised === "en" || normalised.startsWith("en-")) return "en";
  if (normalised === "de" || normalised.startsWith("de-")) return "de";
  if (normalised === "fr" || normalised.startsWith("fr-")) return "fr";
  if (
    normalised === "zh" ||
    normalised === "zh-cn" ||
    normalised === "zh-sg" ||
    normalised.startsWith("zh-hans")
  ) {
    return "zh-CN";
  }
  return null;
}

export function getChromeUiLanguage(): string | undefined {
  try {
    return typeof chrome !== "undefined" && chrome.i18n?.getUILanguage
      ? chrome.i18n.getUILanguage()
      : undefined;
  } catch {
    return undefined;
  }
}

export function getNavigatorLanguages(): readonly string[] {
  if (typeof navigator === "undefined") {
    return [];
  }

  const languages = Array.isArray(navigator.languages)
    ? [...navigator.languages]
    : [];
  if (navigator.language && !languages.includes(navigator.language)) {
    languages.push(navigator.language);
  }
  return languages;
}

export function resolveDeckLanguage(
  storedLanguage?: unknown,
  chromeUiLanguage: unknown = getChromeUiLanguage(),
  navigatorLanguages: readonly unknown[] = getNavigatorLanguages(),
): DeckLanguage {
  const candidates = [storedLanguage, chromeUiLanguage, ...navigatorLanguages];
  for (const candidate of candidates) {
    const language = normaliseDeckLanguage(candidate);
    if (language) {
      return language;
    }
  }
  return "en";
}
