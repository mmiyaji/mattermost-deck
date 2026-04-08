import { loadStoredJson, saveStoredJson } from "./storage";

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
