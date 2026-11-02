const REQUEST = "mattermost-deck:review-storage";
export const REVIEW_CHANGED_MESSAGE = "mattermost-deck:review-changed";
export function usesReviewDatabase(): boolean {
  return typeof chrome !== "undefined" && typeof chrome.runtime?.sendMessage === "function";
}
/** A disposed extension world requires a page reload; a sleeping worker can retry. */
export function isReviewContextInvalidated(error: string | null): boolean {
  return typeof error === "string" && /extension context invalidated/i.test(error);
}
export function reviewStorageClient(prefix: string) {
  const request = async (operation: "get" | "write", sets?: Record<string, unknown>, removes?: string[]) => {
    const response = await chrome.runtime.sendMessage({ type: REQUEST, prefix, operation, sets, removes });
    if (!response?.success) throw new Error(response?.error ?? "Review storage is unavailable");
    if (operation === "get" && (!response.values || typeof response.values !== "object" || Array.isArray(response.values))) {
      throw new Error("Invalid review storage response");
    }
    return response;
  };
  return {
    get: async (_keys: null): Promise<Record<string, unknown>> => (await request("get")).values ?? {},
    set: async (sets: Record<string, unknown>) => { await request("write", sets); },
    remove: async (removes: string[]) => { await request("write", {}, removes); },
  };
}
