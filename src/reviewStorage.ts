import { importLegacyReviewRecords, isReviewMigrated, readReviewRecords, writeReviewRecords } from "./reviewDatabase";

export const REVIEW_STORAGE_MESSAGE = "mattermost-deck:review-storage";
export const REVIEW_CHANGED_MESSAGE = "mattermost-deck:review-changed";
let queue: Promise<unknown> = Promise.resolve();
const migratedPrefixes = new Set<string>();

export async function handleReviewStorageRequest(message: {
  prefix: string; operation: "get" | "write"; sets?: Record<string, unknown>; removes?: string[];
}): Promise<{ values?: Record<string, unknown> }> {
  const { prefix, operation, sets = {}, removes = [] } = message;
  if (typeof prefix !== "string" || !/^mattermostDeck\.mentionReview\.v1:[^:]*:[^:]*:$/.test(prefix)) throw new Error("Invalid review storage scope");
  if (operation !== "get" && operation !== "write") throw new Error("Invalid review storage operation");
  if (!sets || typeof sets !== "object" || Array.isArray(sets) || !Array.isArray(removes) ||
    [...Object.keys(sets), ...removes].some(key => typeof key !== "string" || !key.startsWith(prefix))) throw new Error("Invalid review storage keys");
  const task = queue.catch(() => undefined).then(async () => {
    if (!migratedPrefixes.has(prefix)) {
      const local = await chrome.storage.local.get(null);
      const legacy = Object.fromEntries(Object.entries(local).filter(([key]) => key.startsWith(prefix)));
      if (!await isReviewMigrated(prefix)) await importLegacyReviewRecords(prefix, legacy);
      // IndexedDB's import transaction has committed before legacy records are
      // removed. A failed import leaves every old record intact for a retry.
      if (Object.keys(legacy).length) await chrome.storage.local.remove(Object.keys(legacy));
      migratedPrefixes.add(prefix);
    }
    if (operation === "get") return { values: await readReviewRecords(prefix) };
    await writeReviewRecords(sets, removes);
    const changes = { ...sets, ...Object.fromEntries(removes.map(key => [key, null])) };
    if (Object.keys(changes).length) {
      let origin: string | undefined;
      try { origin = new URL(decodeURIComponent(prefix.split(":")[1])).origin; } catch { /* Empty startup scope has no tabs. */ }
      if (origin) {
        // Notification failure must not turn a committed decision into a
        // reported save failure (for example when a tab closes mid-write).
        const tabs = await chrome.tabs.query({}).catch(() => []);
        await Promise.all(tabs.filter(tab => {
          try { return tab.id !== undefined && new URL(tab.url ?? "").origin === origin; } catch { return false; }
        }).map(tab => chrome.tabs.sendMessage(tab.id!, { type: REVIEW_CHANGED_MESSAGE, prefix, changes }).catch(() => undefined)));
      }
    }
    return {};
  });
  queue = task;
  return await task;
}
