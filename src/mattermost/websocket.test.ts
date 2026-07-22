import { describe, expect, it } from "vitest";
import { hasMentionForDeck, mentionsPayloadIncludesUser } from "./websocket";

describe("mentionsPayloadIncludesUser", () => {
  it("matches exact user IDs from a serialized mentions payload", () => {
    expect(mentionsPayloadIncludesUser('["userida123","useridb456"]', "userida123")).toBe(true);
    expect(mentionsPayloadIncludesUser("userida123 useridb456", "useridb456")).toBe(true);
  });

  it("does not match partial usernames", () => {
    expect(mentionsPayloadIncludesUser('["joann"]', "ann")).toBe(false);
    expect(mentionsPayloadIncludesUser("joann", "ann")).toBe(false);
  });

  it("returns false for empty user IDs", () => {
    expect(mentionsPayloadIncludesUser('["alice"]', null)).toBe(false);
    expect(mentionsPayloadIncludesUser('["alice"]', "")).toBe(false);
  });
});

describe("hasMentionForDeck", () => {
  it("uses Mattermost username boundaries", () => {
    expect(hasMentionForDeck("hello @alice", "alice")).toBe(true);
    expect(hasMentionForDeck("hello @alice.smith", "alice")).toBe(false);
    expect(hasMentionForDeck("hello @here-bot", "alice")).toBe(false);
    expect(hasMentionForDeck("hello @alice-", "alice-")).toBe(true);
  });
});
