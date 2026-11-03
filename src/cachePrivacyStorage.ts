import { purgeMentionBodyCache as purgePersistentMentions, pruneMentionBodyCache as prunePersistentMentions } from "./mentionCacheDatabase";
import { purgeMentionBodyCache as purgeSessionMentions, pruneMentionBodyCache as pruneSessionMentions } from "./mentionCacheSession";
import { purgeFavoriteBodyCache, pruneFavoriteBodyCache } from "./favoriteCacheDatabase";
import {
  BODY_CACHE_PRIVACY_CHANGED_KEY, validateBodyCachePrivacyRequest,
  type BodyCachePrivacyChange, type BodyCachePrivacyRequest,
} from "./cachePrivacyProtocol";

// A clear and its change notification are one ordered operation across all body
// stores. Each store also serializes ordinary writes and retains its own cutoff.
let queue: Promise<unknown> = Promise.resolve();

/** Background-only entry point. The caller must additionally authorize sender. */
export async function handleBodyCachePrivacyRequest(message: BodyCachePrivacyRequest): Promise<{ change?: BodyCachePrivacyChange }> {
  validateBodyCachePrivacyRequest(message);
  const task = queue.catch(() => undefined).then(async () => {
    const clearedAt = Date.now();
    const results = await Promise.allSettled(message.operation === "clear"
      ? [purgePersistentMentions(message.scope, clearedAt), purgeSessionMentions(message.scope, clearedAt), purgeFavoriteBodyCache(message.scope, clearedAt)]
      : [prunePersistentMentions(), pruneSessionMentions(), pruneFavoriteBodyCache()]);
    const failures = results.flatMap(result => result.status === "rejected" ? [String(result.reason)] : []);
    if (failures.length) throw new Error(`Body cache ${message.operation} failed: ${failures.join("; ")}`);
    if (message.operation === "prune") return {};
    const change: BodyCachePrivacyChange = {
      scope: message.scope ?? null, reason: message.reason ?? "manual", clearedAt, revision: crypto.randomUUID(),
    };
    await chrome.storage.session.set({ [BODY_CACHE_PRIVACY_CHANGED_KEY]: change });
    return { change };
  });
  queue = task;
  return task;
}
