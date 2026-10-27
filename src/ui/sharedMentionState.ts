import { useCallback, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

// One state cell per feed condition, regardless of how many views display it.
interface Cell<T> { value: T; listeners: Set<() => void>; cleanup?: ReturnType<typeof setTimeout> }
const cells = new Map<string, Cell<unknown>>();
export function useSharedMentionState<T>(context: string, name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const key = useMemo(() => JSON.stringify([context, name]), [context, name]);
  const cell = useMemo(() => {
    if (!cells.has(key)) cells.set(key, { value: typeof initial === "function" ? (initial as () => T)() : initial, listeners: new Set() });
    return cells.get(key)! as Cell<T>;
  }, [key]);
  const subscribe = useCallback((listener: () => void) => {
    clearTimeout(cell.cleanup);
    cell.listeners.add(listener);
    return () => {
      cell.listeners.delete(listener);
      clearTimeout(cell.cleanup);
      cell.cleanup = setTimeout(() => {
        if (!cell.listeners.size && cells.get(key) === cell) cells.delete(key);
      }, 1000);
    };
  }, [cell, key]);
  const value = useSyncExternalStore(subscribe, () => cell.value);
  const update = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    const next = typeof action === "function" ? (action as (previous: T) => T)(cell.value) : action;
    if (Object.is(next, cell.value)) return;
    cell.value = next;
    cell.listeners.forEach(listener => listener());
  }, [cell]);
  return [value, update];
}
