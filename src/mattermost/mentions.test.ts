import { describe, expect, it } from "vitest";
import { hasMattermostMention, hasSpecialMattermostMention } from "./mentions";

describe("hasSpecialMattermostMention", () => {
  it.each(["@all", "hello @here!", "(@channel)"])("accepts the special mention in %j", (message) => {
    expect(hasSpecialMattermostMention(message)).toBe(true);
  });

  it.each(["@all-hands", "@here.bot", "@channel_name", "email@here"])("rejects mention-like text in %j", (message) => {
    expect(hasSpecialMattermostMention(message)).toBe(false);
  });
});

describe("hasMattermostMention", () => {
  it("uses the same Mattermost token boundaries for usernames", () => {
    expect(hasMattermostMention("hello @alice", "alice")).toBe(true);
    expect(hasMattermostMention("hello @alice-bot", "alice")).toBe(false);
    expect(hasMattermostMention("email@alice", "alice")).toBe(false);
  });

  it("still recognizes special mentions when no username is available", () => {
    expect(hasMattermostMention("hello @channel", null)).toBe(true);
  });
});
