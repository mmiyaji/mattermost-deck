import { hasStoredValue, loadStoredJson, loadStoredString, saveStoredJson, saveStoredString } from "./storage";

export interface DeckProfileSummary {
  id: string;
  name: string;
  origin: string;
  createdAt: number;
  updatedAt: number;
}

interface DeckProfileRegistry {
  version: 1;
  profiles: DeckProfileSummary[];
  activeProfileIdByOrigin: Record<string, string>;
  lastActiveProfileId: string | null;
}

export const PROFILES_STORAGE_KEY = "mattermostDeck.profiles.v1";
const DEFAULT_PROFILE_NAME = "Default";
const DEFAULT_PROFILE_ORIGIN = "default";
const PROFILE_SCOPED_STORAGE_KEYS = [
  "mattermostDeck.serverUrl.v1",
  "mattermostDeck.teamSlug.v1",
  "mattermostDeck.wsPat.v1",
  "mattermostDeck.persistPat.v1",
  "mattermostDeck.pollingIntervalSeconds.v1",
  "mattermostDeck.allowedRouteKinds.v1",
  "mattermostDeck.healthCheckPath.v1",
  "mattermostDeck.theme.v1",
  "mattermostDeck.language.v1",
  "mattermostDeck.fontScalePercent.v1",
  "mattermostDeck.preferredRailWidth.v1",
  "mattermostDeck.preferredColumnWidth.v1",
  "mattermostDeck.compactMode.v1",
  "mattermostDeck.columnColorEnabled.v1",
  "mattermostDeck.columnIdentityMode.v1",
  "mattermostDeck.postClickAction.v1",
  "mattermostDeck.highlightKeywords.v1",
  "mattermostDeck.mentionsLastReadAt.v1",
  "mattermostDeck.columnColors.v1",
  "mattermostDeck.showImagePreviews.v1",
  "mattermostDeck.highZIndex.v1",
  "mattermostDeck.reversedPostOrder.v1"
] as const;

function normaliseServerOrigin(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
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

function getCurrentPageOrigin(): string | null {
  const origin = normaliseServerOrigin(window.location.origin);
  return origin || null;
}

function normaliseProfileName(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed.slice(0, 60) : DEFAULT_PROFILE_NAME;
}

function isDeckProfileSummary(value: unknown): value is DeckProfileSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DeckProfileSummary>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.origin === "string" &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt)
  );
}

function createProfile(name: string, origin: string): DeckProfileSummary {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: normaliseProfileName(name),
    origin: origin || DEFAULT_PROFILE_ORIGIN,
    createdAt: now,
    updatedAt: now,
  };
}

function getProfileById(registry: DeckProfileRegistry, profileId: string | null | undefined): DeckProfileSummary | undefined {
  return profileId ? registry.profiles.find((profile) => profile.id === profileId) : undefined;
}

function normaliseProfileRegistry(value: unknown): DeckProfileRegistry {
  const registry = value as Partial<DeckProfileRegistry> | null | undefined;
  const profiles = Array.isArray(registry?.profiles)
    ? registry.profiles.filter(isDeckProfileSummary).map((profile) => ({
        ...profile,
        name: normaliseProfileName(profile.name),
        origin: profile.origin || DEFAULT_PROFILE_ORIGIN,
      }))
    : [];

  const activeProfileIdByOrigin: Record<string, string> = {};
  if (registry?.activeProfileIdByOrigin && typeof registry.activeProfileIdByOrigin === "object") {
    for (const [origin, profileId] of Object.entries(registry.activeProfileIdByOrigin)) {
      if (typeof profileId === "string" && profiles.some((profile) => profile.id === profileId)) {
        activeProfileIdByOrigin[origin] = profileId;
      }
    }
  }

  const lastActiveProfileId = typeof registry?.lastActiveProfileId === "string" && profiles.some((profile) => profile.id === registry.lastActiveProfileId)
    ? registry.lastActiveProfileId
    : null;

  return {
    version: 1,
    profiles,
    activeProfileIdByOrigin,
    lastActiveProfileId,
  };
}

async function loadProfileRegistry(): Promise<DeckProfileRegistry> {
  const stored = await loadStoredJson<DeckProfileRegistry | null>(PROFILES_STORAGE_KEY, null);
  return normaliseProfileRegistry(stored);
}

async function saveProfileRegistry(registry: DeckProfileRegistry): Promise<void> {
  await saveStoredJson(PROFILES_STORAGE_KEY, registry);
}

async function ensureProfileRegistry(): Promise<DeckProfileRegistry> {
  const currentOrigin = getCurrentPageOrigin();
  const registry = await loadProfileRegistry();
  let changed = false;

  if (registry.profiles.length === 0) {
    const initialProfile = createProfile(DEFAULT_PROFILE_NAME, currentOrigin ?? DEFAULT_PROFILE_ORIGIN);
    registry.profiles.push(initialProfile);
    registry.activeProfileIdByOrigin[initialProfile.origin] = initialProfile.id;
    registry.lastActiveProfileId = initialProfile.id;
    changed = true;
  }

  if (currentOrigin && !registry.profiles.some((profile) => profile.origin === currentOrigin)) {
    const originProfile = createProfile(DEFAULT_PROFILE_NAME, currentOrigin);
    registry.profiles.push(originProfile);
    registry.activeProfileIdByOrigin[currentOrigin] = originProfile.id;
    registry.lastActiveProfileId = originProfile.id;
    changed = true;
  }

  const origins = new Set(registry.profiles.map((profile) => profile.origin));
  for (const origin of origins) {
    const activeId = registry.activeProfileIdByOrigin[origin];
    if (!registry.profiles.some((profile) => profile.origin === origin && profile.id === activeId)) {
      registry.activeProfileIdByOrigin[origin] = registry.profiles.find((profile) => profile.origin === origin)?.id ?? registry.profiles[0].id;
      changed = true;
    }
  }

  if (!getProfileById(registry, registry.lastActiveProfileId)) {
    registry.lastActiveProfileId = currentOrigin
      ? registry.activeProfileIdByOrigin[currentOrigin] ?? registry.profiles[0].id
      : registry.profiles[0].id;
    changed = true;
  }

  if (changed) {
    await saveProfileRegistry(registry);
  }

  return registry;
}

function resolveProfileOrigin(registry: DeckProfileRegistry, origin?: string, allowUnknown = false): string {
  const requestedOrigin = normaliseServerOrigin(origin);
  if (requestedOrigin && (allowUnknown || registry.profiles.some((profile) => profile.origin === requestedOrigin))) {
    return requestedOrigin;
  }

  const currentOrigin = getCurrentPageOrigin();
  if (currentOrigin && registry.profiles.some((profile) => profile.origin === currentOrigin)) {
    return currentOrigin;
  }

  return getProfileById(registry, registry.lastActiveProfileId)?.origin ?? registry.profiles[0]?.origin ?? DEFAULT_PROFILE_ORIGIN;
}

async function copyScopedProfileStorage(sourceProfileId: string, targetProfileId: string): Promise<void> {
  for (const baseKey of PROFILE_SCOPED_STORAGE_KEYS) {
    const sourceKey = getProfileStorageKey(sourceProfileId, baseKey);
    const targetKey = getProfileStorageKey(targetProfileId, baseKey);

    if (await hasStoredValue(sourceKey, "local")) {
      await saveStoredString(targetKey, (await loadStoredString(sourceKey, "local")) ?? "", "local");
    } else {
      await saveStoredString(targetKey, "", "local");
    }

    if (await hasStoredValue(sourceKey, "session")) {
      await saveStoredString(targetKey, (await loadStoredString(sourceKey, "session")) ?? "", "session");
    } else {
      await saveStoredString(targetKey, "", "session");
    }
  }
}

export function getProfileStorageKey(profileId: string, storageKey: string): string {
  return `${storageKey}.profile.${profileId}`;
}

export async function loadDeckProfiles(origin?: string): Promise<{ profiles: DeckProfileSummary[]; activeProfileId: string }> {
  const registry = await ensureProfileRegistry();
  const targetOrigin = resolveProfileOrigin(registry, origin, true);
  let profiles = registry.profiles.filter((profile) => profile.origin === targetOrigin);
  if (profiles.length === 0) {
    const profile = createProfile(DEFAULT_PROFILE_NAME, targetOrigin);
    registry.profiles.push(profile);
    registry.activeProfileIdByOrigin[targetOrigin] = profile.id;
    registry.lastActiveProfileId = profile.id;
    await saveProfileRegistry(registry);
    profiles = [profile];
  }
  const activeProfileId = registry.activeProfileIdByOrigin[targetOrigin] ?? profiles[0].id;
  return { profiles, activeProfileId };
}

export async function loadCurrentDeckProfile(origin?: string): Promise<DeckProfileSummary> {
  const { profiles, activeProfileId } = await loadDeckProfiles(origin);
  return profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
}

export async function switchDeckProfile(profileId: string): Promise<void> {
  const registry = await ensureProfileRegistry();
  const profile = getProfileById(registry, profileId);
  if (!profile) {
    return;
  }

  registry.activeProfileIdByOrigin[profile.origin] = profile.id;
  registry.lastActiveProfileId = profile.id;
  profile.updatedAt = Date.now();
  await saveProfileRegistry(registry);
}

export async function createDeckProfile(name: string, origin?: string): Promise<DeckProfileSummary> {
  const registry = await ensureProfileRegistry();
  const targetOrigin = resolveProfileOrigin(registry, origin, true);
  const profile = createProfile(name, targetOrigin);
  registry.profiles.push(profile);
  registry.activeProfileIdByOrigin[targetOrigin] = profile.id;
  registry.lastActiveProfileId = profile.id;
  await saveProfileRegistry(registry);
  return profile;
}

export async function renameDeckProfile(profileId: string, name: string): Promise<DeckProfileSummary | null> {
  const registry = await ensureProfileRegistry();
  const profile = getProfileById(registry, profileId);
  if (!profile) {
    return null;
  }

  profile.name = normaliseProfileName(name);
  profile.updatedAt = Date.now();
  await saveProfileRegistry(registry);
  return profile;
}

export async function duplicateDeckProfile(profileId: string, name?: string): Promise<DeckProfileSummary | null> {
  const registry = await ensureProfileRegistry();
  const sourceProfile = getProfileById(registry, profileId);
  if (!sourceProfile) {
    return null;
  }

  const duplicate = createProfile(name ?? `${sourceProfile.name} Copy`, sourceProfile.origin);
  registry.profiles.push(duplicate);
  registry.activeProfileIdByOrigin[sourceProfile.origin] = duplicate.id;
  registry.lastActiveProfileId = duplicate.id;
  await saveProfileRegistry(registry);
  await copyScopedProfileStorage(sourceProfile.id, duplicate.id);
  return duplicate;
}

export async function deleteDeckProfile(profileId: string): Promise<{ deleted: boolean; nextActiveProfileId: string | null }> {
  const registry = await ensureProfileRegistry();
  const profile = getProfileById(registry, profileId);
  if (!profile) {
    return { deleted: false, nextActiveProfileId: registry.lastActiveProfileId };
  }

  const siblingProfiles = registry.profiles.filter((entry) => entry.origin === profile.origin);
  if (siblingProfiles.length <= 1) {
    return { deleted: false, nextActiveProfileId: profile.id };
  }

  registry.profiles = registry.profiles.filter((entry) => entry.id !== profile.id);
  const nextActiveProfile = registry.profiles.find((entry) => entry.origin === profile.origin) ?? registry.profiles[0] ?? null;
  if (nextActiveProfile) {
    registry.activeProfileIdByOrigin[profile.origin] = nextActiveProfile.id;
    registry.lastActiveProfileId = nextActiveProfile.id;
  } else {
    delete registry.activeProfileIdByOrigin[profile.origin];
    registry.lastActiveProfileId = null;
  }
  await saveProfileRegistry(registry);

  for (const baseKey of PROFILE_SCOPED_STORAGE_KEYS) {
    await saveStoredString(getProfileStorageKey(profile.id, baseKey), "", "local");
    await saveStoredString(getProfileStorageKey(profile.id, baseKey), "", "session");
  }

  return { deleted: true, nextActiveProfileId: nextActiveProfile?.id ?? null };
}
