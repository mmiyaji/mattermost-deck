import { useSyncExternalStore } from "react";

export const VIRTUAL_POST_LIST_KEY = "mattermostDeck.virtualPostListExperiment.v1";
let enabled = false;
let initialized = false;
const listeners = new Set<() => void>();
function publish(value: unknown) {
  const next = value === true;
  if (enabled === next) return;
  enabled = next;
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!initialized && typeof chrome !== "undefined" && chrome.storage?.local) {
    initialized = true;
    let changed = false;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && VIRTUAL_POST_LIST_KEY in changes) {
        changed = true;
        publish(changes[VIRTUAL_POST_LIST_KEY].newValue);
      }
    });
    void chrome.storage.local.get(VIRTUAL_POST_LIST_KEY).then(values => {
      if (!changed) publish(values[VIRTUAL_POST_LIST_KEY]);
    }).catch(() => {});
  }
  return () => { listeners.delete(listener); };
}
export function useVirtualPostListExperiment() {
  return useSyncExternalStore(subscribe, () => enabled, () => false);
}
export async function setVirtualPostListExperiment(value: boolean) {
  await chrome.storage.local.set({ [VIRTUAL_POST_LIST_KEY]: value });
}
