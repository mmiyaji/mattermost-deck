const REQUEST = "mattermost-deck:review-storage";
export const REVIEW_CHANGED_MESSAGE = "mattermost-deck:review-changed";
export function usesReviewDatabase(): boolean {
  return typeof chrome !== "undefined" && typeof chrome.runtime?.sendMessage === "function";
}
export function reviewStorageClient(prefix: string) {
  const request = async (operation: "get" | "write", sets?: Record<string, unknown>, removes?: string[]) => {
    const response = await chrome.runtime.sendMessage({ type: REQUEST, prefix, operation, sets, removes });
    if (!response?.success) throw new Error(response?.error ?? "Review storage is unavailable");
    return response;
  };
  return {
    get: async (_keys: null): Promise<Record<string, unknown>> => (await request("get")).values ?? {},
    set: async (sets: Record<string, unknown>) => { await request("write", sets); },
    remove: async (removes: string[]) => { await request("write", {}, removes); },
  };
}
