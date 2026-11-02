import { afterEach, describe, expect, it, vi } from "vitest";
import { isReviewContextInvalidated, reviewStorageClient } from "./reviewStorageClient";
afterEach(() => vi.unstubAllGlobals());
describe("review storage adapter recovery", () => {
  it("distinguishes invalidated page contexts from transient worker failures", () => {
    expect(isReviewContextInvalidated("Extension context invalidated.")).toBe(true);
    expect(isReviewContextInvalidated("Could not establish connection. Receiving end does not exist.")).toBe(false);
    expect(isReviewContextInvalidated(null)).toBe(false);
  });
  it("does not accept a malformed successful read as an empty decision registry", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn(async () => ({ success: true })) } });
    await expect(reviewStorageClient("prefix").get(null)).rejects.toThrow("Invalid review storage response");
  });
});
