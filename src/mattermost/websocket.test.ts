import { describe, expect, it } from "vitest";
import { mentionsPayloadIncludesUser } from "./websocket";

describe("mentionsPayloadIncludesUser", () => {
  it("matches exact usernames from a serialized mentions payload", () => {
    expect(mentionsPayloadIncludesUser('["alice","bob"]', "alice")).toBe(true);
    expect(mentionsPayloadIncludesUser("alice bob", "bob")).toBe(true);
  });

  it("does not match partial usernames", () => {
    expect(mentionsPayloadIncludesUser('["joann"]', "ann")).toBe(false);
    expect(mentionsPayloadIncludesUser("joann", "ann")).toBe(false);
  });

  it("returns false for empty usernames", () => {
    expect(mentionsPayloadIncludesUser('["alice"]', null)).toBe(false);
    expect(mentionsPayloadIncludesUser('["alice"]', "")).toBe(false);
  });
});
