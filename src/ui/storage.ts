import { createDefaultLayout, type DeckColumn } from "./layout";

interface LayoutPayload {
  columns: DeckColumn[];
}

const ENCRYPTION_PREFIX = "enc:v1:";
const STORAGE_SALT = "mattermost-deck.local-storage.v1";
let cachedEncryptionKey: Promise<CryptoKey> | null = null;
type StorageAreaName = "local" | "session";

function isDeckColumn(value: unknown): value is DeckColumn {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DeckColumn>;
  return (
    typeof candidate.id === "string" &&
    (candidate.type === "mentions" || candidate.type === "channelWatch" || candidate.type === "dmWatch") &&
    (candidate.teamId === undefined || typeof candidate.teamId === "string") &&
    (candidate.channelId === undefined || typeof candidate.channelId === "string")
  );
}

function normaliseColumns(value: unknown): DeckColumn[] {
  if (!Array.isArray(value)) {
    return createDefaultLayout();
  }

  const columns = value.filter(isDeckColumn).map((column) => ({
    id: column.id,
    type: column.type,
    teamId: column.teamId,
    channelId: column.channelId,
  }));

  return columns.length > 0 ? columns : createDefaultLayout();
}

function readLocalStorage(storageKey: string): DeckColumn[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return createDefaultLayout();
    }

    const payload = JSON.parse(raw) as Partial<LayoutPayload>;
    return normaliseColumns(payload.columns);
  } catch {
    return createDefaultLayout();
  }
}

function writeLocalStorage(storageKey: string, columns: DeckColumn[]): void {
  window.localStorage.setItem(storageKey, JSON.stringify({ columns } satisfies LayoutPayload));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(input: string): Uint8Array {
  const binary = atob(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function getStorageArea(area: StorageAreaName): chrome.storage.StorageArea | null {
  if (!chrome.storage) {
    return null;
  }

  return area === "session" ? chrome.storage.session ?? null : chrome.storage.local ?? null;
}

async function getRawStoredString(storageKey: string, area: StorageAreaName = "local"): Promise<string | null> {
  const storageArea = getStorageArea(area);
  if (!storageArea) {
    const raw = window.localStorage.getItem(storageKey);
    return raw && raw.length > 0 ? raw : null;
  }

  try {
    const payload = await storageArea.get(storageKey);
    const value = payload[storageKey];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    const raw = window.localStorage.getItem(storageKey);
    return raw && raw.length > 0 ? raw : null;
  }
}

async function setRawStoredString(storageKey: string, value: string, area: StorageAreaName = "local"): Promise<void> {
  const normalized = value.trim();
  const storageArea = getStorageArea(area);
  if (!storageArea) {
    if (normalized) {
      window.localStorage.setItem(storageKey, normalized);
    } else {
      window.localStorage.removeItem(storageKey);
    }
    return;
  }

  try {
    if (normalized) {
      await storageArea.set({ [storageKey]: normalized });
    } else {
      await storageArea.remove(storageKey);
    }
  } catch {
    if (normalized) {
      window.localStorage.setItem(storageKey, normalized);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  }
}

async function deriveEncryptionKey(): Promise<CryptoKey> {
  if (cachedEncryptionKey) {
    return await cachedEncryptionKey;
  }

  cachedEncryptionKey = (async () => {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(chrome.runtime?.id ?? window.location.origin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(STORAGE_SALT),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
  })();

  return await cachedEncryptionKey;
}

async function encryptString(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );

  return `${ENCRYPTION_PREFIX}${encodeBase64(iv)}:${encodeBase64(new Uint8Array(encrypted))}`;
}

async function decryptString(value: string): Promise<string | null> {
  if (!value.startsWith(ENCRYPTION_PREFIX)) {
    return value;
  }

  const payload = value.slice(ENCRYPTION_PREFIX.length);
  const [ivRaw, cipherRaw] = payload.split(":");
  if (!ivRaw || !cipherRaw) {
    return null;
  }

  try {
    const key = await deriveEncryptionKey();
    const ivBytes = new Uint8Array(decodeBase64(ivRaw));
    const cipherBytes = new Uint8Array(decodeBase64(cipherRaw));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      key,
      cipherBytes,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

export async function loadDeckLayout(storageKey: string): Promise<DeckColumn[]> {
  if (!chrome.storage?.local) {
    return readLocalStorage(storageKey);
  }

  try {
    const payload = await chrome.storage.local.get(storageKey);
    return normaliseColumns(payload[storageKey]);
  } catch {
    return readLocalStorage(storageKey);
  }
}

export async function saveDeckLayout(storageKey: string, columns: DeckColumn[]): Promise<void> {
  if (!chrome.storage?.local) {
    writeLocalStorage(storageKey, columns);
    return;
  }

  try {
    await chrome.storage.local.set({ [storageKey]: columns });
  } catch {
    writeLocalStorage(storageKey, columns);
  }
}

export async function loadStoredNumber(storageKey: string): Promise<number | null> {
  if (!chrome.storage?.local) {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  try {
    const payload = await chrome.storage.local.get(storageKey);
    const value = payload[storageKey];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

export async function saveStoredNumber(storageKey: string, value: number): Promise<void> {
  if (!chrome.storage?.local) {
    window.localStorage.setItem(storageKey, String(value));
    return;
  }

  try {
    await chrome.storage.local.set({ [storageKey]: value });
  } catch {
    window.localStorage.setItem(storageKey, String(value));
  }
}

export async function loadStoredString(storageKey: string, area: StorageAreaName = "local"): Promise<string | null> {
  return await getRawStoredString(storageKey, area);
}

export async function saveStoredString(storageKey: string, value: string, area: StorageAreaName = "local"): Promise<void> {
  await setRawStoredString(storageKey, value, area);
}

export async function loadStoredEncryptedString(storageKey: string, area: StorageAreaName = "local"): Promise<string | null> {
  const raw = await getRawStoredString(storageKey, area);
  if (!raw) {
    return null;
  }

  return await decryptString(raw);
}

export async function saveStoredEncryptedString(
  storageKey: string,
  value: string,
  area: StorageAreaName = "local",
): Promise<void> {
  const normalized = value.trim();
  if (!normalized) {
    await setRawStoredString(storageKey, "", area);
    return;
  }

  await setRawStoredString(storageKey, await encryptString(normalized), area);
}

export async function loadStoredJson<T>(storageKey: string, fallback: T): Promise<T> {
  if (!chrome.storage?.local) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  try {
    const payload = await chrome.storage.local.get(storageKey);
    const value = payload[storageKey];
    return value !== undefined ? (value as T) : fallback;
  } catch {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }
}

export async function saveStoredJson<T>(storageKey: string, value: T): Promise<void> {
  if (!chrome.storage?.local) {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
    return;
  }

  try {
    await chrome.storage.local.set({ [storageKey]: value });
  } catch {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  }
}
