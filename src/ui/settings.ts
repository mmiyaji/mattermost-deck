import { loadStoredString, saveStoredString } from "./storage";

export type DeckTheme = "system" | "dark" | "light" | "mattermost";
export type DeckLanguage = "ja" | "en";

export interface DeckSettings {
  wsPat: string;
  theme: DeckTheme;
  language: DeckLanguage;
}

export const SETTINGS_KEYS = {
  wsPat: "mattermostDeck.wsPat.v1",
  theme: "mattermostDeck.theme.v1",
  language: "mattermostDeck.language.v1",
} as const;

export const DEFAULT_SETTINGS: DeckSettings = {
  wsPat: "",
  theme: "system",
  language: "ja",
};

function normaliseTheme(value: string | null): DeckTheme {
  return value === "dark" || value === "light" || value === "system" || value === "mattermost"
    ? value
    : DEFAULT_SETTINGS.theme;
}

function normaliseLanguage(value: string | null): DeckLanguage {
  return value === "ja" || value === "en" ? value : DEFAULT_SETTINGS.language;
}

export async function loadDeckSettings(): Promise<DeckSettings> {
  const [wsPat, theme, language] = await Promise.all([
    loadStoredString(SETTINGS_KEYS.wsPat),
    loadStoredString(SETTINGS_KEYS.theme),
    loadStoredString(SETTINGS_KEYS.language),
  ]);

  return {
    wsPat: wsPat ?? DEFAULT_SETTINGS.wsPat,
    theme: normaliseTheme(theme),
    language: normaliseLanguage(language),
  };
}

export async function saveDeckSettings(settings: DeckSettings): Promise<void> {
  await Promise.all([
    saveStoredString(SETTINGS_KEYS.wsPat, settings.wsPat),
    saveStoredString(SETTINGS_KEYS.theme, settings.theme),
    saveStoredString(SETTINGS_KEYS.language, settings.language),
  ]);
}

export function subscribeDeckSettings(listener: (settings: DeckSettings) => void): () => void {
  if (!chrome.storage?.onChanged) {
    return () => undefined;
  }

  const handleChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== "local") {
      return;
    }

    if (
      !(SETTINGS_KEYS.wsPat in changes) &&
      !(SETTINGS_KEYS.theme in changes) &&
      !(SETTINGS_KEYS.language in changes)
    ) {
      return;
    }

    void loadDeckSettings().then(listener).catch(() => undefined);
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => {
    chrome.storage.onChanged.removeListener(handleChange);
  };
}

export function resolveTheme(theme: DeckTheme): Exclude<DeckTheme, "system"> {
  if (theme !== "system") {
    return theme;
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
