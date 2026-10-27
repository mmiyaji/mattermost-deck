import { useCallback, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

// One state cell per feed condition, regardless of how many views display it.
export interface SharedMentionCell<T> { value: T; listeners: Set<() => void>; cleanup?: ReturnType<typeof setTimeout> }
const cells = new Map<string, SharedMentionCell<unknown>>();
export const sharedMentionStateKey = (context: string, name: string) => JSON.stringify([context, name]);
export function sharedMentionCell<T>(key: string, initial: T | (() => T)): SharedMentionCell<T> {
  if (!cells.has(key)) cells.set(key, { value: typeof initial === "function" ? (initial as () => T)() : initial, listeners: new Set() });
  return cells.get(key)! as SharedMentionCell<T>;
}
// A cell outlives its last view by a moment so a remount reuses its state. Clearing the pending
// timer and checking identity stop a stale one from dropping a cell that has been re-subscribed.
export function subscribeToSharedMentionCell(key: string, cell: SharedMentionCell<unknown>, listener: () => void): () => void {
  clearTimeout(cell.cleanup);
  cell.listeners.add(listener);
  return () => {
    cell.listeners.delete(listener);
    clearTimeout(cell.cleanup);
    cell.cleanup = setTimeout(() => {
      if (!cell.listeners.size && cells.get(key) === cell) cells.delete(key);
    }, 1000);
  };
}
export function setSharedMentionCell<T>(cell: SharedMentionCell<T>, action: SetStateAction<T>): void {
  const next = typeof action === "function" ? (action as (previous: T) => T)(cell.value) : action;
  if (Object.is(next, cell.value)) return;
  cell.value = next;
  cell.listeners.forEach(listener => listener());
}
export function useSharedMentionState<T>(context: string, name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const key = useMemo(() => sharedMentionStateKey(context, name), [context, name]);
  const cell = useMemo(() => sharedMentionCell(key, initial), [key]);
  const subscribe = useCallback((listener: () => void) => subscribeToSharedMentionCell(key, cell, listener), [cell, key]);
  const value = useSyncExternalStore(subscribe, () => cell.value);
  const update = useCallback<Dispatch<SetStateAction<T>>>((action) => setSharedMentionCell(cell, action), [cell]);
  return [value, update];
}
