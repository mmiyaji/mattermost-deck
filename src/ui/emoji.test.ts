import { describe, expect, it } from "vitest";
import { replaceEmojiShortcodes } from "./emoji";

describe("replaceEmojiShortcodes", () => {
  it("converts known shortcodes and Mattermost aliases", () => {
    expect(replaceEmojiShortcodes("done :tada: :+1: :thumbsup: :white_check_mark:")).toBe("done 🎉 👍 👍 ✅");
  });
  it("keeps unknown and custom names, times and plain text unchanged", () => {
    expect(replaceEmojiShortcodes("at 10:30:45 :my_custom_emoji: :unknown:")).toBe("at 10:30:45 :my_custom_emoji: :unknown:");
    expect(replaceEmojiShortcodes("no codes here")).toBe("no codes here");
  });
});
