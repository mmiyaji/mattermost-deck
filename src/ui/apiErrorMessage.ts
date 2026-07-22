import { getMattermostApiErrorStatus } from "../mattermost/errors";
import i18n from "./i18n";

/**
 * Converts an API failure into a user-facing message in the active Deck
 * language. Unknown (non-API) failures deliberately use the supplied
 * contextual fallback instead of exposing a technical Error.message.
 */
export function getLocalizedApiErrorMessage(error: unknown, fallback: string): string {
  const status = getMattermostApiErrorStatus(error);
  if (status === null) {
    return fallback;
  }
  if (status === 401) {
    return i18n.t("deck.apiSessionExpired");
  }
  if (status === 403) {
    return i18n.t("deck.apiPermissionDenied");
  }
  if (status === 429) {
    return i18n.t("deck.apiRateLimited");
  }
  if (status >= 500 && status <= 599) {
    return i18n.t("deck.apiServerUnavailable");
  }
  return i18n.t("deck.apiRequestFailed", { status });
}

export function isMattermostSessionExpiredError(error: unknown): boolean {
  return getMattermostApiErrorStatus(error) === 401;
}
