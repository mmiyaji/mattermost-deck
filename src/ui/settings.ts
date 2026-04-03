import { loadStoredEncryptedString, loadStoredString, saveStoredEncryptedString, saveStoredString } from "./storage";

export type DeckTheme = "system" | "dark" | "light" | "mattermost";
export type DeckLanguage = "ja" | "en";

export interface DeckSettings {
  serverUrl: string;
  teamSlug: string;
  wsPat: string;
  pollingIntervalSeconds: number;
  allowedRouteKinds: string;
  healthCheckPath: string;
  theme: DeckTheme;
  language: DeckLanguage;
  fontScalePercent: number;
  preferredRailWidth: number;
  preferredColumnWidth: number;
}

export const SETTINGS_KEYS = {
  serverUrl: "mattermostDeck.serverUrl.v1",
  teamSlug: "mattermostDeck.teamSlug.v1",
  wsPat: "mattermostDeck.wsPat.v1",
  pollingIntervalSeconds: "mattermostDeck.pollingIntervalSeconds.v1",
  allowedRouteKinds: "mattermostDeck.allowedRouteKinds.v1",
  healthCheckPath: "mattermostDeck.healthCheckPath.v1",
  theme: "mattermostDeck.theme.v1",
  language: "mattermostDeck.language.v1",
  fontScalePercent: "mattermostDeck.fontScalePercent.v1",
  preferredRailWidth: "mattermostDeck.preferredRailWidth.v1",
  preferredColumnWidth: "mattermostDeck.preferredColumnWidth.v1",
} as const;

export const DEFAULT_SETTINGS: DeckSettings = {
  serverUrl: "",
  teamSlug: "",
  wsPat: "",
  pollingIntervalSeconds: 45,
  allowedRouteKinds: "channels,messages",
  healthCheckPath: "/api/v4/users/me",
  theme: "mattermost",
  language: "ja",
  fontScalePercent: 100,
  preferredRailWidth: 720,
  preferredColumnWidth: 320,
};
export const MIN_POLLING_INTERVAL_SECONDS = 15;
export const MAX_POLLING_INTERVAL_SECONDS = 300;
export const MIN_FONT_SCALE_PERCENT = 80;
export const MAX_FONT_SCALE_PERCENT = 140;
export const MIN_PREFERRED_RAIL_WIDTH = 360;
export const MAX_PREFERRED_RAIL_WIDTH = 1400;
export const MIN_PREFERRED_COLUMN_WIDTH = 260;
export const MAX_PREFERRED_COLUMN_WIDTH = 480;

export function normaliseServerUrl(value: string | null): string {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return "";
  }
}

export function normaliseTeamSlug(value: string | null): string {
  return value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
}

export function normalisePollingIntervalSeconds(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? DEFAULT_SETTINGS.pollingIntervalSeconds);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.pollingIntervalSeconds;
  }

  return Math.min(MAX_POLLING_INTERVAL_SECONDS, Math.max(MIN_POLLING_INTERVAL_SECONDS, Math.round(parsed)));
}

export function normaliseFontScalePercent(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? DEFAULT_SETTINGS.fontScalePercent);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.fontScalePercent;
  }

  return Math.min(MAX_FONT_SCALE_PERCENT, Math.max(MIN_FONT_SCALE_PERCENT, Math.round(parsed)));
}

export function normalisePreferredRailWidth(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? DEFAULT_SETTINGS.preferredRailWidth);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.preferredRailWidth;
  }

  return Math.min(MAX_PREFERRED_RAIL_WIDTH, Math.max(MIN_PREFERRED_RAIL_WIDTH, Math.round(parsed)));
}

export function normalisePreferredColumnWidth(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? DEFAULT_SETTINGS.preferredColumnWidth);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.preferredColumnWidth;
  }

  return Math.min(MAX_PREFERRED_COLUMN_WIDTH, Math.max(MIN_PREFERRED_COLUMN_WIDTH, Math.round(parsed)));
}

export function normaliseAllowedRouteKinds(value: string | null): string {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return DEFAULT_SETTINGS.allowedRouteKinds;
  }

  const allowed = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part === "channels" || part === "messages");

  return allowed.length > 0 ? [...new Set(allowed)].join(",") : DEFAULT_SETTINGS.allowedRouteKinds;
}

export function normaliseHealthCheckPath(value: string | null): string {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return DEFAULT_SETTINGS.healthCheckPath;
  }

  return raw.startsWith("/") ? raw : `/${raw}`;
}

function normaliseTheme(value: string | null): DeckTheme {
  return value === "dark" || value === "light" || value === "system" || value === "mattermost"
    ? value
    : DEFAULT_SETTINGS.theme;
}

function normaliseLanguage(value: string | null): DeckLanguage {
  return value === "ja" || value === "en" ? value : DEFAULT_SETTINGS.language;
}

export async function loadDeckSettings(): Promise<DeckSettings> {
  const [
    serverUrl,
    teamSlug,
    wsPatEncrypted,
    pollingIntervalSeconds,
    allowedRouteKinds,
    healthCheckPath,
    theme,
    language,
    fontScalePercent,
    preferredRailWidth,
    preferredColumnWidth,
  ] =
    await Promise.all([
    loadStoredString(SETTINGS_KEYS.serverUrl),
    loadStoredString(SETTINGS_KEYS.teamSlug),
    loadStoredEncryptedString(SETTINGS_KEYS.wsPat),
    loadStoredString(SETTINGS_KEYS.pollingIntervalSeconds),
    loadStoredString(SETTINGS_KEYS.allowedRouteKinds),
    loadStoredString(SETTINGS_KEYS.healthCheckPath),
    loadStoredString(SETTINGS_KEYS.theme),
    loadStoredString(SETTINGS_KEYS.language),
    loadStoredString(SETTINGS_KEYS.fontScalePercent),
    loadStoredString(SETTINGS_KEYS.preferredRailWidth),
    loadStoredString(SETTINGS_KEYS.preferredColumnWidth),
    ]);

  return {
    serverUrl: normaliseServerUrl(serverUrl),
    teamSlug: normaliseTeamSlug(teamSlug),
    wsPat: wsPatEncrypted ?? DEFAULT_SETTINGS.wsPat,
    pollingIntervalSeconds: normalisePollingIntervalSeconds(pollingIntervalSeconds),
    allowedRouteKinds: normaliseAllowedRouteKinds(allowedRouteKinds),
    healthCheckPath: normaliseHealthCheckPath(healthCheckPath),
    theme: normaliseTheme(theme),
    language: normaliseLanguage(language),
    fontScalePercent: normaliseFontScalePercent(fontScalePercent),
    preferredRailWidth: normalisePreferredRailWidth(preferredRailWidth),
    preferredColumnWidth: normalisePreferredColumnWidth(preferredColumnWidth),
  };
}

export async function saveDeckSettings(settings: DeckSettings): Promise<void> {
  await Promise.all([
    saveStoredString(SETTINGS_KEYS.serverUrl, normaliseServerUrl(settings.serverUrl)),
    saveStoredString(SETTINGS_KEYS.teamSlug, normaliseTeamSlug(settings.teamSlug)),
    saveStoredEncryptedString(SETTINGS_KEYS.wsPat, settings.wsPat),
    saveStoredString(SETTINGS_KEYS.pollingIntervalSeconds, String(normalisePollingIntervalSeconds(settings.pollingIntervalSeconds))),
    saveStoredString(SETTINGS_KEYS.allowedRouteKinds, normaliseAllowedRouteKinds(settings.allowedRouteKinds)),
    saveStoredString(SETTINGS_KEYS.healthCheckPath, normaliseHealthCheckPath(settings.healthCheckPath)),
    saveStoredString(SETTINGS_KEYS.theme, settings.theme),
    saveStoredString(SETTINGS_KEYS.language, settings.language),
    saveStoredString(SETTINGS_KEYS.fontScalePercent, String(normaliseFontScalePercent(settings.fontScalePercent))),
    saveStoredString(SETTINGS_KEYS.preferredRailWidth, String(normalisePreferredRailWidth(settings.preferredRailWidth))),
    saveStoredString(SETTINGS_KEYS.preferredColumnWidth, String(normalisePreferredColumnWidth(settings.preferredColumnWidth))),
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
      !(SETTINGS_KEYS.serverUrl in changes) &&
      !(SETTINGS_KEYS.teamSlug in changes) &&
      !(SETTINGS_KEYS.wsPat in changes) &&
      !(SETTINGS_KEYS.pollingIntervalSeconds in changes) &&
      !(SETTINGS_KEYS.allowedRouteKinds in changes) &&
      !(SETTINGS_KEYS.healthCheckPath in changes) &&
      !(SETTINGS_KEYS.theme in changes) &&
      !(SETTINGS_KEYS.language in changes) &&
      !(SETTINGS_KEYS.fontScalePercent in changes) &&
      !(SETTINGS_KEYS.preferredRailWidth in changes) &&
      !(SETTINGS_KEYS.preferredColumnWidth in changes)
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
