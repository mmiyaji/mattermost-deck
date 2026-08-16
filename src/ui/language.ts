export interface DeckLanguageDefinition {
  /** i18next resource key and the value persisted in settings. */
  readonly code: string;
  /** Directory name under src/_locales for Chrome store metadata. */
  readonly chromeLocale: string;
  /** Translation key that renders this language's name in Settings. */
  readonly labelKey: string;
  /** BCP 47 subtags matched verbatim. */
  readonly exact: readonly string[];
  /** BCP 47 subtags matched verbatim or as a `<tag>-*` prefix. */
  readonly prefixed: readonly string[];
}

export const SUPPORTED_LANGUAGES = [
  { code: "ja",    chromeLocale: "ja",    labelKey: "options.languageJa",   exact: [],      prefixed: ["ja"] },
  { code: "en",    chromeLocale: "en",    labelKey: "options.languageEn",   exact: [],      prefixed: ["en"] },
  { code: "de",    chromeLocale: "de",    labelKey: "options.languageDe",   exact: [],      prefixed: ["de"] },
  { code: "zh-CN", chromeLocale: "zh_CN", labelKey: "options.languageZhCn", exact: ["zh"],  prefixed: ["zh-cn", "zh-sg", "zh-hans"] },
  { code: "fr",    chromeLocale: "fr",    labelKey: "options.languageFr",   exact: [],      prefixed: ["fr"] },
  { code: "ru",    chromeLocale: "ru",    labelKey: "options.languageRu",   exact: [],      prefixed: ["ru"] },
  { code: "uk",    chromeLocale: "uk",    labelKey: "options.languageUk",   exact: [],      prefixed: ["uk"] },
] as const satisfies readonly DeckLanguageDefinition[];

export type DeckLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const DECK_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map(
  (definition) => definition.code,
) as readonly DeckLanguage[];

export const DEFAULT_DECK_LANGUAGE: DeckLanguage = "en";

export function normaliseDeckLanguage(value: unknown): DeckLanguage | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalised = value.trim().replaceAll("_", "-").toLowerCase();
  if (!normalised) {
    return null;
  }

  for (const definition of SUPPORTED_LANGUAGES) {
    if (definition.exact.some((tag) => normalised === tag)) {
      return definition.code;
    }
    if (
      definition.prefixed.some(
        (tag) => normalised === tag || normalised.startsWith(`${tag}-`),
      )
    ) {
      return definition.code;
    }
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
  return DEFAULT_DECK_LANGUAGE;
}
