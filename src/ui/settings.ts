import { loadStoredEncryptedString, loadStoredString, saveStoredEncryptedString, saveStoredString, hasStoredValue } from "./storage";
import { getProfileStorageKey, loadCurrentDeckProfile, PROFILES_STORAGE_KEY } from "./profiles";

export type DeckTheme = "system" | "dark" | "light" | "mattermost";
export type DeckLanguage = "ja" | "en" | "de" | "zh-CN" | "fr";
export type PostClickAction = "navigate" | "none" | "ask";
export type ColumnColorKey =
  | "mentions"
  | "channelWatch"
  | "dmWatch"
  | "keywordWatch"
  | "search"
  | "saved"
  | "diagnostics";

export type ColumnColorSettings = Record<ColumnColorKey, string>;

export interface DeckSettings {
  serverUrl: string;
  teamSlug: string;
  wsPat: string;
  persistPat: boolean;
  pollingIntervalSeconds: number;
  allowedRouteKinds: string;
  healthCheckPath: string;
  theme: DeckTheme;
  language: DeckLanguage;
  fontScalePercent: number;
  preferredRailWidth: number;
  preferredColumnWidth: number;
  compactMode: boolean;
  columnColorEnabled: boolean;
  postClickAction: PostClickAction;
  highlightKeywords: string;
  columnColors: ColumnColorSettings;
  showImagePreviews: boolean;
  highZIndex: boolean;
  reversedPostOrder: boolean;
}

export const SETTINGS_KEYS = {
  serverUrl: "mattermostDeck.serverUrl.v1",
  teamSlug: "mattermostDeck.teamSlug.v1",
  wsPat: "mattermostDeck.wsPat.v1",
  persistPat: "mattermostDeck.persistPat.v1",
  pollingIntervalSeconds: "mattermostDeck.pollingIntervalSeconds.v1",
  allowedRouteKinds: "mattermostDeck.allowedRouteKinds.v1",
  healthCheckPath: "mattermostDeck.healthCheckPath.v1",
  theme: "mattermostDeck.theme.v1",
  language: "mattermostDeck.language.v1",
  fontScalePercent: "mattermostDeck.fontScalePercent.v1",
  preferredRailWidth: "mattermostDeck.preferredRailWidth.v1",
  preferredColumnWidth: "mattermostDeck.preferredColumnWidth.v1",
  compactMode: "mattermostDeck.compactMode.v1",
  columnColorEnabled: "mattermostDeck.columnColorEnabled.v1",
  columnIdentityMode: "mattermostDeck.columnIdentityMode.v1",
  postClickAction: "mattermostDeck.postClickAction.v1",
  highlightKeywords: "mattermostDeck.highlightKeywords.v1",
  columnColors: "mattermostDeck.columnColors.v1",
  showImagePreviews: "mattermostDeck.showImagePreviews.v1",
  highZIndex: "mattermostDeck.highZIndex.v1",
  reversedPostOrder: "mattermostDeck.reversedPostOrder.v1",
} as const;

export const DEFAULT_COLUMN_COLORS: ColumnColorSettings = {
  mentions: "#2f6fed",
  channelWatch: "#1f9d7a",
  dmWatch: "#8b5cf6",
  keywordWatch: "#d97706",
  search: "#0891b2",
  saved: "#c2410c",
  diagnostics: "#64748b",
};

export const DEFAULT_SETTINGS: DeckSettings = {
  serverUrl: "",
  teamSlug: "",
  wsPat: "",
  persistPat: false,
  pollingIntervalSeconds: 45,
  allowedRouteKinds: "channels,messages,pl",
  healthCheckPath: "/api/v4/users/me",
  theme: "mattermost",
  language: "ja",
  fontScalePercent: 100,
  preferredRailWidth: 720,
  preferredColumnWidth: 320,
  compactMode: false,
  columnColorEnabled: false,
  postClickAction: "ask",
  highlightKeywords: "",
  columnColors: DEFAULT_COLUMN_COLORS,
  showImagePreviews: true,
  highZIndex: false,
  reversedPostOrder: false,
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
    .filter((part) => part === "channels" || part === "messages" || part === "pl");

  return allowed.length > 0 ? [...new Set(allowed)].join(",") : DEFAULT_SETTINGS.allowedRouteKinds;
}

export function normaliseHealthCheckPath(value: string | null): string {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return DEFAULT_SETTINGS.healthCheckPath;
  }

  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://") ? new URL(raw) : null;
    const candidate = parsed ? parsed.pathname : raw;
    const path = candidate.startsWith("/") ? candidate : `/${candidate}`;
    return /^\/api\/v4(?:\/|$)/.test(path) ? path : DEFAULT_SETTINGS.healthCheckPath;
  } catch {
    return DEFAULT_SETTINGS.healthCheckPath;
  }
}

function normalisePersistPat(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normaliseBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }

  return value === true || value === "true" || value === 1 || value === "1";
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function normaliseColumnColors(value: unknown): ColumnColorSettings {
  const next = { ...DEFAULT_COLUMN_COLORS };
  if (!value || typeof value !== "object") {
    return next;
  }

  for (const key of Object.keys(DEFAULT_COLUMN_COLORS) as ColumnColorKey[]) {
    const candidate = (value as Record<string, unknown>)[key];
    if (isHexColor(candidate)) {
      next[key] = candidate.trim();
    }
  }

  return next;
}

function parseJsonObject(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function originToPermissionPattern(origin: string): string | null {
  const normalized = normaliseServerUrl(origin);
  if (!normalized) {
    return null;
  }

  return `${normalized}/*`;
}

function normaliseTheme(value: string | null): DeckTheme {
  return value === "dark" || value === "light" || value === "system" || value === "mattermost"
    ? value
    : DEFAULT_SETTINGS.theme;
}

function normaliseLanguage(value: string | null): DeckLanguage {
  return value === "ja" || value === "en" || value === "de" || value === "zh-CN" || value === "fr"
    ? value
    : DEFAULT_SETTINGS.language;
}

function normaliseColumnColorEnabled(value: unknown, legacyIdentityMode?: string | null): boolean {
  if (value !== undefined && value !== null && value !== "") {
    return normaliseBoolean(value, DEFAULT_SETTINGS.columnColorEnabled);
  }

  return legacyIdentityMode === "color";
}

function normalisePostClickAction(value: string | null): PostClickAction {
  return value === "none" || value === "ask" || value === "navigate" ? value : DEFAULT_SETTINGS.postClickAction;
}

function normaliseHighlightKeywords(value: string | null): string {
  return value?.trim() ?? "";
}

async function loadScopedStoredString(baseKey: string, area: "local" | "session" = "local", origin?: string): Promise<string | null> {
  const profile = await loadCurrentDeckProfile(origin);
  const profileKey = getProfileStorageKey(profile.id, baseKey);
  if (await hasStoredValue(profileKey, area)) {
    return await loadStoredString(profileKey, area);
  }

  return await loadStoredString(baseKey, area);
}

async function loadScopedStoredEncryptedString(baseKey: string, area: "local" | "session" = "local", origin?: string): Promise<string | null> {
  const profile = await loadCurrentDeckProfile(origin);
  const profileKey = getProfileStorageKey(profile.id, baseKey);
  if (await hasStoredValue(profileKey, area)) {
    return await loadStoredEncryptedString(profileKey, area);
  }

  return await loadStoredEncryptedString(baseKey, area);
}

export async function loadDeckSettings(origin?: string): Promise<DeckSettings> {
  const [
    serverUrl,
    teamSlug,
    wsPatPersistent,
    wsPatSession,
    persistPat,
    pollingIntervalSeconds,
    allowedRouteKinds,
    healthCheckPath,
    theme,
    language,
    fontScalePercent,
    preferredRailWidth,
    preferredColumnWidth,
    compactMode,
    columnColorEnabled,
    columnIdentityMode,
    postClickAction,
    highlightKeywords,
    columnColors,
    showImagePreviews,
    highZIndex,
    reversedPostOrder,
  ] = await Promise.all([
    loadScopedStoredString(SETTINGS_KEYS.serverUrl, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.teamSlug, "local", origin),
    loadScopedStoredEncryptedString(SETTINGS_KEYS.wsPat, "local", origin),
    loadScopedStoredEncryptedString(SETTINGS_KEYS.wsPat, "session", origin),
    loadScopedStoredString(SETTINGS_KEYS.persistPat, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.pollingIntervalSeconds, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.allowedRouteKinds, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.healthCheckPath, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.theme, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.language, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.fontScalePercent, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.preferredRailWidth, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.preferredColumnWidth, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.compactMode, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.columnColorEnabled, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.columnIdentityMode, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.postClickAction, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.highlightKeywords, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.columnColors, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.showImagePreviews, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.highZIndex, "local", origin),
    loadScopedStoredString(SETTINGS_KEYS.reversedPostOrder, "local", origin),
  ]);

  return {
    serverUrl: normaliseServerUrl(serverUrl),
    teamSlug: normaliseTeamSlug(teamSlug),
    wsPat: (normalisePersistPat(persistPat) ? wsPatPersistent : wsPatSession) ?? DEFAULT_SETTINGS.wsPat,
    persistPat: normalisePersistPat(persistPat),
    pollingIntervalSeconds: normalisePollingIntervalSeconds(pollingIntervalSeconds),
    allowedRouteKinds: normaliseAllowedRouteKinds(allowedRouteKinds),
    healthCheckPath: normaliseHealthCheckPath(healthCheckPath),
    theme: normaliseTheme(theme),
    language: normaliseLanguage(language),
    fontScalePercent: normaliseFontScalePercent(fontScalePercent),
    preferredRailWidth: normalisePreferredRailWidth(preferredRailWidth),
    preferredColumnWidth: normalisePreferredColumnWidth(preferredColumnWidth),
    compactMode: normaliseBoolean(compactMode, DEFAULT_SETTINGS.compactMode),
    columnColorEnabled: normaliseColumnColorEnabled(columnColorEnabled, columnIdentityMode),
    postClickAction: normalisePostClickAction(postClickAction),
    highlightKeywords: normaliseHighlightKeywords(highlightKeywords),
    columnColors: normaliseColumnColors(parseJsonObject(columnColors)),
    showImagePreviews: normaliseBoolean(showImagePreviews, DEFAULT_SETTINGS.showImagePreviews),
    highZIndex: normaliseBoolean(highZIndex, DEFAULT_SETTINGS.highZIndex),
    reversedPostOrder: normaliseBoolean(reversedPostOrder, DEFAULT_SETTINGS.reversedPostOrder),
  };
}

export async function saveDeckSettings(settings: DeckSettings, origin?: string): Promise<void> {
  const profile = await loadCurrentDeckProfile(origin);
  const profileKey = (baseKey: string) => getProfileStorageKey(profile.id, baseKey);
  const normalizedServerUrl = normaliseServerUrl(settings.serverUrl);
  const normalizedPat = settings.wsPat.trim();
  const persistPat = normalisePersistPat(settings.persistPat);

  await Promise.all([
    saveStoredString(profileKey(SETTINGS_KEYS.serverUrl), normalizedServerUrl),
    saveStoredString(profileKey(SETTINGS_KEYS.teamSlug), normaliseTeamSlug(settings.teamSlug)),
    saveStoredString(profileKey(SETTINGS_KEYS.persistPat), persistPat ? "true" : "false"),
    saveStoredEncryptedString(profileKey(SETTINGS_KEYS.wsPat), persistPat ? normalizedPat : "", "local"),
    saveStoredEncryptedString(profileKey(SETTINGS_KEYS.wsPat), persistPat ? "" : normalizedPat, "session"),
    saveStoredString(profileKey(SETTINGS_KEYS.pollingIntervalSeconds), String(normalisePollingIntervalSeconds(settings.pollingIntervalSeconds))),
    saveStoredString(profileKey(SETTINGS_KEYS.allowedRouteKinds), normaliseAllowedRouteKinds(settings.allowedRouteKinds)),
    saveStoredString(profileKey(SETTINGS_KEYS.healthCheckPath), normaliseHealthCheckPath(settings.healthCheckPath)),
    saveStoredString(profileKey(SETTINGS_KEYS.theme), settings.theme),
    saveStoredString(profileKey(SETTINGS_KEYS.language), settings.language),
    saveStoredString(profileKey(SETTINGS_KEYS.fontScalePercent), String(normaliseFontScalePercent(settings.fontScalePercent))),
    saveStoredString(profileKey(SETTINGS_KEYS.preferredRailWidth), String(normalisePreferredRailWidth(settings.preferredRailWidth))),
    saveStoredString(profileKey(SETTINGS_KEYS.preferredColumnWidth), String(normalisePreferredColumnWidth(settings.preferredColumnWidth))),
    saveStoredString(profileKey(SETTINGS_KEYS.compactMode), settings.compactMode ? "true" : "false"),
    saveStoredString(profileKey(SETTINGS_KEYS.columnColorEnabled), settings.columnColorEnabled ? "true" : "false"),
    saveStoredString(profileKey(SETTINGS_KEYS.columnIdentityMode), settings.columnColorEnabled ? "color" : "icon"),
    saveStoredString(profileKey(SETTINGS_KEYS.postClickAction), normalisePostClickAction(settings.postClickAction)),
    saveStoredString(profileKey(SETTINGS_KEYS.highlightKeywords), normaliseHighlightKeywords(settings.highlightKeywords)),
    saveStoredString(profileKey(SETTINGS_KEYS.columnColors), JSON.stringify(normaliseColumnColors(settings.columnColors))),
    saveStoredString(profileKey(SETTINGS_KEYS.showImagePreviews), settings.showImagePreviews ? "true" : "false"),
    saveStoredString(profileKey(SETTINGS_KEYS.highZIndex), settings.highZIndex ? "true" : "false"),
    saveStoredString(profileKey(SETTINGS_KEYS.reversedPostOrder), settings.reversedPostOrder ? "true" : "false"),
  ]);
}

function isSettingsChangeKey(key: string): boolean {
  return Object.values(SETTINGS_KEYS).some((baseKey) => key === baseKey || key === `${baseKey}.profile.` || key.startsWith(`${baseKey}.profile.`));
}

export function subscribeDeckSettings(listener: (settings: DeckSettings) => void): () => void {
  if (!chrome.storage?.onChanged) {
    return () => undefined;
  }

  const handleChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== "local" && areaName !== "session") {
      return;
    }

    const changedKeys = Object.keys(changes);
    if (!changedKeys.some((key) => key === PROFILES_STORAGE_KEY || isSettingsChangeKey(key))) {
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
