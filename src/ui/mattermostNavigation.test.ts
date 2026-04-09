import { describe, expect, it } from "vitest";
import { getMattermostPostSelectors } from "./mattermostNavigation";

describe("getMattermostPostSelectors", () => {
  it("returns the known Mattermost post selector variants", () => {
    expect(getMattermostPostSelectors("post123")).toEqual([
      "#post_post123",
      "#postMessage_post123",
      "[data-postid=\"post123\"]",
      "[data-post-id=\"post123\"]",
      "[data-aid=\"post_post123\"]",
      "[id=\"post123\"]",
    ]);
  });
});
