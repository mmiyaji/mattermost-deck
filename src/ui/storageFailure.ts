export const STORAGE_ERROR_EVENT = "mattermost-deck:storage-error";

/** Handle fire-and-forget UI persistence without exposing stored values in errors. */
export async function persistUiSetting(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Browser/storage errors can contain values; only publish a fixed user-facing message.
    try {
      window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, {
        detail: { message: "Settings could not be saved. Please try again." },
      }));
    } catch {
      // A closing page cannot receive the notification; never create another rejected promise.
    }
  }
}
