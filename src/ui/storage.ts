import { createDefaultLayout, type DeckColumn } from "./layout";

interface LayoutPayload {
  columns: DeckColumn[];
}

function isDeckColumn(value: unknown): value is DeckColumn {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DeckColumn>;
  return (
    typeof candidate.id === "string" &&
    (candidate.type === "mentions" || candidate.type === "channelWatch") &&
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
