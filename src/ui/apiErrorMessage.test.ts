import { beforeEach, describe, expect, it } from "vitest";
import { MattermostApiError } from "../mattermost/errors";
import { getLocalizedApiErrorMessage, isMattermostSessionExpiredError } from "./apiErrorMessage";
import i18n from "./i18n";

describe("getLocalizedApiErrorMessage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each([
    [401, "deck.apiSessionExpired"],
    [403, "deck.apiPermissionDenied"],
    [429, "deck.apiRateLimited"],
    [500, "deck.apiServerUnavailable"],
    [503, "deck.apiServerUnavailable"],
  ] as const)("maps HTTP %i to %s", (status, key) => {
    const error = new MattermostApiError("GET", "/api/v4/test", status);

    expect(getLocalizedApiErrorMessage(error, "fallback")).toBe(i18n.t(key));
  });

  it("uses the localized generic API message for other HTTP statuses", () => {
    const error = new MattermostApiError("POST", "/api/v4/test", 418);

    expect(getLocalizedApiErrorMessage(error, "fallback")).toBe(
      i18n.t("deck.apiRequestFailed", { status: 418 }),
    );
  });

  it("uses the contextual fallback instead of exposing an unknown technical message", () => {
    const error = new Error("GET /api/v4/test failed with 0");

    expect(getLocalizedApiErrorMessage(error, "Could not load posts")).toBe("Could not load posts");
  });

  it("uses the currently selected Deck language", async () => {
    await i18n.changeLanguage("ja");
    const error = new MattermostApiError("GET", "/api/v4/test", 403);

    expect(getLocalizedApiErrorMessage(error, "fallback")).toBe(i18n.t("deck.apiPermissionDenied"));
    expect(getLocalizedApiErrorMessage(error, "fallback")).not.toContain("denied");
  });
});

describe("isMattermostSessionExpiredError", () => {
  it("only treats a typed HTTP 401 response as an expired session", () => {
    expect(isMattermostSessionExpiredError(new MattermostApiError("GET", "/api/v4/users/me", 401))).toBe(true);
    expect(isMattermostSessionExpiredError(new MattermostApiError("GET", "/api/v4/users/me", 403))).toBe(false);
    expect(isMattermostSessionExpiredError(new Error("request failed with 401"))).toBe(false);
  });
});
