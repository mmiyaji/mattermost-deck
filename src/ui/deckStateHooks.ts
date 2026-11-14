import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createColumn, createDefaultLayout, STORAGE_KEY, type DeckColumn, type DeckColumnType } from "./layout";
import { loadDeckLayout, loadStoredJson, loadStoredNumber, saveDeckLayout, saveStoredJson, saveStoredNumber } from "./storage";
import { persistUiSetting } from "./storageFailure";
import { movePaneRelative } from "./paneOrder";
import { dedupeRecentTargets, type RecentChannelTarget } from "./recentTargets";
import { MAX_PREFERRED_RAIL_WIDTH, MIN_PREFERRED_RAIL_WIDTH } from "./settings";

export const RECENT_TARGETS_STORAGE_KEY = "mattermostDeck.recentTargets.v1";
export const SAVED_VIEWS_STORAGE_KEY = "mattermostDeck.savedViews.v1";
export const MAX_SAVED_VIEWS = 8;
export const MAX_RECENT_TARGETS = 6;
export const MIN_RAIL_WIDTH = MIN_PREFERRED_RAIL_WIDTH;
export const MAX_RAIL_WIDTH = MAX_PREFERRED_RAIL_WIDTH;
export interface SavedDeckView {
  rowSplit?: number;
  layoutMode?: "row" | "twoRows";
  id: string;
  name: string;
  columns: DeckColumn[];
}

export function useDeckLayout(): [
  DeckColumn[] | null,
  (type: DeckColumnType, defaults?: Partial<Pick<DeckColumn, "teamId" | "channelId" | "teamLabel" | "channelLabel" | "query" | "unreadOnly" | "mentionReview" | "width" | "row" | "customTitle">>, groupRows?: boolean) => string,
  (id: string) => void,
  (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId" | "teamLabel" | "channelLabel" | "query" | "unreadOnly" | "mentionReview" | "width" | "row" | "customTitle">>) => void,
  (id: string, direction: "left" | "right") => void,
  (nextColumns: DeckColumn[]) => void,
  (source: string, target: string | null, after: boolean, row?: 0 | 1) => void,
] {
  const [columns, setColumns] = useState<DeckColumn[] | null>(null);
  const layoutLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const layout = await loadDeckLayout(STORAGE_KEY);
      if (!cancelled) {
        layoutLoadedRef.current = true;
        setColumns(layout);
      }
    };

    void persistUiSetting(run().catch(error => { if (!cancelled) setColumns([]); throw error; }));

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((nextColumns: DeckColumn[]): void => {
    if (!layoutLoadedRef.current) { void persistUiSetting(Promise.reject(new Error("Layout is not loaded"))); return; }
    setColumns(nextColumns);
    void persistUiSetting(saveDeckLayout(STORAGE_KEY, nextColumns));
  }, []);

  const persistFromCurrent = useCallback((transform: (current: DeckColumn[]) => DeckColumn[]): void => {
    if (!layoutLoadedRef.current) { void persistUiSetting(Promise.reject(new Error("Layout is not loaded"))); return; }
    setColumns((current) => {
      const base = current ?? createDefaultLayout();
      const next = transform(base);
      void persistUiSetting(saveDeckLayout(STORAGE_KEY, next));
      return next;
    });
  }, []);

  const addColumn = useCallback(
    (
      type: DeckColumnType,
      defaults: Partial<Pick<DeckColumn, "teamId" | "channelId" | "teamLabel" | "channelLabel" | "query" | "unreadOnly" | "mentionReview" | "width" | "row" | "customTitle">> = {},
      groupRows = false,
    ): string => {
      const nextColumn = createColumn(type, defaults);
      persistFromCurrent((current) => {
        const next = [...current, nextColumn];
        return groupRows ? next.sort((a, b) => (a.row ?? 0) - (b.row ?? 0)) : next;
      });
      return nextColumn.id;
    },
    [persistFromCurrent],
  );

  const removeColumn = useCallback((id: string): void => {
    persistFromCurrent((current) => {
      const nextColumns = current.filter((column) => column.id !== id);
      return nextColumns.length > 0 ? nextColumns : [createColumn("mentions")];
    });
  }, [persistFromCurrent]);

  const updateColumn = useCallback((id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId" | "teamLabel" | "channelLabel" | "query" | "unreadOnly" | "mentionReview" | "width" | "row" | "customTitle">>): void => {
    persistFromCurrent((current) =>
      current.map((column) =>
        column.id === id
          ? {
              ...column,
              ...patch,
            }
          : column,
      ),
    );
  }, [persistFromCurrent]);

  const moveColumn = useCallback((id: string, direction: "left" | "right"): void => {
    persistFromCurrent((current) => {
      const index = current.findIndex((column) => column.id === id);
      if (index < 0) {
        return current;
      }

      const targetIndex = direction === "left" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [column] = next.splice(index, 1);
      next.splice(targetIndex, 0, column);
      return next;
    });
  }, [persistFromCurrent]);

  const reorderColumn = useCallback((source: string, target: string | null, after: boolean, row?: 0 | 1) => {
    persistFromCurrent(current => movePaneRelative(current, source, target, after, row));
  }, [persistFromCurrent]);
  return [columns, addColumn, removeColumn, updateColumn, moveColumn, persist, reorderColumn];
}

export function useRecentTargets(): [RecentChannelTarget[], (target: RecentChannelTarget) => void] {
  const [targets, setTargets] = useState<RecentChannelTarget[]>([]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredJson<RecentChannelTarget[]>(RECENT_TARGETS_STORAGE_KEY, []);
      if (!cancelled) {
        const filtered = Array.isArray(stored)
          ? stored.filter(
              (entry) =>
                Boolean(entry) &&
                (entry.type === "channelWatch" || entry.type === "dmWatch") &&
                typeof entry.teamId === "string" &&
                typeof entry.teamLabel === "string" &&
                typeof entry.channelId === "string" &&
                typeof entry.channelLabel === "string",
            )
          : [];
        const deduped = dedupeRecentTargets(filtered);
        setTargets(deduped);
        if (filtered.length !== deduped.length) {
          void persistUiSetting(saveStoredJson(RECENT_TARGETS_STORAGE_KEY, deduped));
        }
      }
    };

    void persistUiSetting(run());
    return () => {
      cancelled = true;
    };
  }, []);

  const remember = useCallback((target: RecentChannelTarget) => {
    setTargets((current) => {
      const next = dedupeRecentTargets([
        target,
        ...current,
      ]);
      void persistUiSetting(saveStoredJson(RECENT_TARGETS_STORAGE_KEY, next));
      return next;
    });
  }, []);

  return [targets, remember];
}

export function isSavedView(value: unknown): value is SavedDeckView {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SavedDeckView>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && Array.isArray(candidate.columns);
}

export function useSavedViews(): [
  SavedDeckView[],
  (name: string, columns: DeckColumn[], layoutMode: "row" | "twoRows", rowSplit: number) => void,
  (id: string) => void,
  (id: string) => SavedDeckView | undefined,
] {
  const [views, setViews] = useState<SavedDeckView[]>([]);
  const viewsLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredJson<SavedDeckView[]>(SAVED_VIEWS_STORAGE_KEY, []);
      if (!cancelled) {
        viewsLoadedRef.current = true;
        setViews(Array.isArray(stored) ? stored.filter(isSavedView).slice(0, MAX_SAVED_VIEWS) : []);
      }
    };

    void persistUiSetting(run());
    return () => {
      cancelled = true;
    };
  }, []);

  const saveView = useCallback((name: string, columns: DeckColumn[], layoutMode: "row" | "twoRows", rowSplit: number) => {
    if (!viewsLoadedRef.current) { void persistUiSetting(Promise.reject(new Error("Views are not loaded"))); return; }
    const normalized = name.trim();
    if (!normalized) {
      return;
    }

    setViews((current) => {
      const existing = current.find((entry) => entry.name.toLowerCase() === normalized.toLowerCase());
      const nextEntry: SavedDeckView = existing
        ? { ...existing, columns, layoutMode, rowSplit }
        : { id: crypto.randomUUID(), name: normalized, columns, layoutMode, rowSplit };
      const next = [nextEntry, ...current.filter((entry) => entry.id !== nextEntry.id)].slice(0, MAX_SAVED_VIEWS);
      void persistUiSetting(saveStoredJson(SAVED_VIEWS_STORAGE_KEY, next));
      return next;
    });
  }, []);

  const removeView = useCallback((id: string) => {
    if (!viewsLoadedRef.current) { void persistUiSetting(Promise.reject(new Error("Views are not loaded"))); return; }
    setViews((current) => {
      const next = current.filter((entry) => entry.id !== id);
      void persistUiSetting(saveStoredJson(SAVED_VIEWS_STORAGE_KEY, next));
      return next;
    });
  }, []);

  const getView = useCallback((id: string) => views.find((entry) => entry.id === id), [views]);

  return [views, saveView, removeView, getView];
}

export function clampRailWidth(nextWidth: number): number {
  return Math.min(Math.max(nextWidth, MIN_RAIL_WIDTH), MAX_RAIL_WIDTH);
}

export function useStoredBoolean(storageKey: string, defaultValue: boolean): [boolean, (nextValue: boolean) => void] {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredNumber(storageKey);
      if (!cancelled && stored !== null) {
        setValue(stored !== 0);
      }
    };

    void persistUiSetting(run());
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const update = useCallback((nextValue: boolean) => {
    setValue(nextValue);
    void persistUiSetting(saveStoredNumber(storageKey, nextValue ? 1 : 0));
  }, [storageKey]);
  return [value, update];
}

