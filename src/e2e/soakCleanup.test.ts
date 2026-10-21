import { describe, expect, it } from "vitest";
import { cleanupPostsInBatches } from "../../e2e/soak-cleanup.js";

describe("cleanupPostsInBatches", () => {
  it("waits for replies before deleting their roots", async () => {
    const calls: string[] = [];
    const replyDeletes: Array<() => void> = [];
    const cleanup = cleanupPostsInBatches(
      ["root-a", "reply-a", "root-b", "reply-b"],
      ["root-a", "root-b"],
      4,
      (postId) => {
        calls.push(postId);
        if (postId.startsWith("reply")) {
          return new Promise<void>((resolve) => replyDeletes.push(resolve));
        }
        return Promise.resolve();
      },
    );

    expect(calls).toEqual(["reply-b", "reply-a"]);
    replyDeletes.forEach((resolve) => resolve());
    await cleanup;
    expect(calls).toEqual(["reply-b", "reply-a", "root-b", "root-a"]);
  });

  it("reports failed post deletions", async () => {
    const failures = await cleanupPostsInBatches(
      ["root", "reply"],
      ["root"],
      4,
      (postId) => postId === "reply"
        ? Promise.reject(new Error("delete failed"))
        : Promise.resolve(),
    );

    expect(failures).toBe(2);
  });
});
