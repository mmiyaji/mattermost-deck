import { describe, expect, it } from "vitest";
import {
  getDeckRoutePath,
  getMattermostPostSelectors,
  resolveDeckCurrentRoute,
} from "./mattermostNavigation";

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

describe("resolveDeckCurrentRoute", () => {
  it("recognises the team Threads screen with and without a subroute", () => {
    expect(
      resolveDeckCurrentRoute(
        "/company/mattermost/team/threads",
        { teamName: null, channelName: null },
      ),
    ).toEqual({ teamName: "team", channelName: null });
    expect(
      resolveDeckCurrentRoute(
        "/company/mattermost/team/threads/thread-id",
        { teamName: "team", channelName: "thread-id" },
      ),
    ).toEqual({ teamName: "team", channelName: null });
  });

  it("does not reinterpret a channel named threads as the Threads screen", () => {
    expect(
      resolveDeckCurrentRoute(
        "/team/channels/threads",
        { teamName: "team", channelName: "threads" },
      ),
    ).toEqual({ teamName: "team", channelName: "threads" });
  });

  it("resolves canonical hash routes without pathname route context", () => {
    expect(
      resolveDeckCurrentRoute(
        getDeckRoutePath("/", "#/team/channels/town-square"),
        { teamName: null, channelName: null },
      ),
    ).toEqual({ teamName: "team", channelName: "town-square" });
    expect(
      resolveDeckCurrentRoute(
        getDeckRoutePath("/", "#/team/threads"),
        { teamName: null, channelName: null },
      ),
    ).toEqual({ teamName: "team", channelName: null });
  });
});
