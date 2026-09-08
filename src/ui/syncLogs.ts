import { useEffect, useMemo, useSyncExternalStore } from "react";

export interface SyncLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

// Owned by one App instance: keep recent logs even when diagnostics is closed,
// but only notify the diagnostics components that actually display them.
export function createSyncLogStore() {
  let logs: SyncLogEntry[] = [];
  const listeners = new Set<() => void>();
  const receive = (event: Event) => {
    logs = [(event as CustomEvent<SyncLogEntry>).detail, ...logs].slice(0, 20);
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => logs,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    connect: (target: EventTarget) => {
      target.addEventListener("mattermost-deck-ws-log", receive);
      target.addEventListener("mattermost-deck-api-log", receive);
      return () => {
        target.removeEventListener("mattermost-deck-ws-log", receive);
        target.removeEventListener("mattermost-deck-api-log", receive);
      };
    },
  };
}

export type SyncLogStore = ReturnType<typeof createSyncLogStore>;

export function useSyncLogStore(): SyncLogStore {
  const store = useMemo(createSyncLogStore, []);
  useEffect(() => store.connect(window), [store]);
  return store;
}

export function useSyncLogs(store: SyncLogStore): SyncLogEntry[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
