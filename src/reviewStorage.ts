import {
  completeReviewMigrationCleanup, fingerprintReviewValue, importLegacyReviewRecords, isReviewMigrated,
  readReviewMigrationCleanup, readReviewRecords, writeReviewRecords,
} from "./reviewDatabase";

export const REVIEW_STORAGE_MESSAGE = "mattermost-deck:review-storage";
export const REVIEW_CHANGED_MESSAGE = "mattermost-deck:review-changed";
const queues = new Map<string, Promise<unknown>>();
const notificationQueues = new Map<string, Promise<void>>();
const migratedPrefixes = new Set<string>();

async function migrate(prefix: string): Promise<void> {
  if (migratedPrefixes.has(prefix)) return;
  // The persistent marker is checked first, including after worker restart.
  // A completed migration must never rescan or consume downgraded-tab writes.
  if (!await isReviewMigrated(prefix)) {
    const local = await chrome.storage.local.get(null);
    const legacy = Object.fromEntries(Object.entries(local).filter(([key]) => key.startsWith(prefix)));
    await importLegacyReviewRecords(prefix, legacy);
  }
  try {
    const cleanup = await readReviewMigrationCleanup(prefix);
    const keys = Object.keys(cleanup);
    if (keys.length) {
      const local = await chrome.storage.local.get(keys);
      const matching = (await Promise.all(keys.map(async key =>
        Object.prototype.hasOwnProperty.call(local, key) && await fingerprintReviewValue(local[key]) === cleanup[key] ? key : null)))
        .filter((key): key is string => key !== null);
      // Only proven imports with unchanged values are eligible. Chrome storage
      // has no compare-and-delete transaction; changed legacy values are kept.
      if (matching.length) await chrome.storage.local.remove(matching);
      // Missing and rewritten keys also finish the plan. Once complete, no
      // future legacy data can be silently imported or removed by this worker.
      await completeReviewMigrationCleanup(prefix);
    }
    migratedPrefixes.add(prefix);
  } catch {
    // Import is already committed. Cleanup is best-effort and remains pending
    // for a targeted, fingerprint-checked retry without blocking review work.
  }
}

function notifyChanges(prefix: string, changes: Record<string, unknown>): void {
  let origin: string;
  try { origin = new URL(decodeURIComponent(prefix.split(":")[1])).origin; } catch { return; }
  const task = (notificationQueues.get(prefix) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    try {
      const tabs = await chrome.tabs.query({});
      await Promise.all(tabs.filter(tab => {
        try { return tab.id !== undefined && new URL(tab.url ?? "").origin === origin; } catch { return false; }
      }).map(async tab => {
        try { await chrome.tabs.sendMessage(tab.id!, { type: REVIEW_CHANGED_MESSAGE, prefix, changes }); }
        catch { /* Closed or unloaded views do not undo a committed decision. */ }
      }));
    } catch { /* Notifications are best-effort, including synchronous API failures. */ }
  });
  notificationQueues.set(prefix, task);
  const cleanup = () => { if (notificationQueues.get(prefix) === task) notificationQueues.delete(prefix); };
  void task.then(cleanup, cleanup);
}

export async function handleReviewStorageRequest(message: {
  prefix: string; operation: "get" | "write"; sets?: Record<string, unknown>; removes?: string[];
}): Promise<{ values?: Record<string, unknown> }> {
  const { prefix, operation, sets = {}, removes = [] } = message;
  if (typeof prefix !== "string" || !/^mattermostDeck\.mentionReview\.v1:[^:]*:[^:]*:$/.test(prefix)) throw new Error("Invalid review storage scope");
  if (operation !== "get" && operation !== "write") throw new Error("Invalid review storage operation");
  if (!sets || typeof sets !== "object" || Array.isArray(sets) || !Array.isArray(removes) ||
    [...Object.keys(sets), ...removes].some(key => typeof key !== "string" || !key.startsWith(prefix))) throw new Error("Invalid review storage keys");
  const task = (queues.get(prefix) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await migrate(prefix);
    if (operation === "get") return { values: await readReviewRecords(prefix) };
    await writeReviewRecords(sets, removes);
    const changes = { ...sets, ...Object.fromEntries(removes.map(key => [key, null])) };
    if (Object.keys(changes).length) notifyChanges(prefix, changes);
    return {};
  });
  queues.set(prefix, task);
  const cleanup = () => { if (queues.get(prefix) === task) queues.delete(prefix); };
  void task.then(cleanup, cleanup);
  return task;
}
