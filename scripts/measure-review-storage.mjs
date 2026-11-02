import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

// Isolated storage only: never touches a browser profile or Mattermost data.
const results = [];
const baselineRef = process.env.PERF_BASELINE_REF ?? "HEAD";
for (const baseline of [true, false]) {
  const values = {};
  globalThis.chrome = { storage: { local: {
    get: async () => ({ ...values }),
    set: async next => Object.assign(values, next),
    remove: async keys => { for (const key of keys) delete values[key]; },
  } } };
  const bundle = await build({ stdin: { contents: 'export * from "./src/ui/mentionReview.ts";', resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "esm", plugins: baseline ? [{ name: "baseline", setup(b) {
      b.onLoad({ filter: /src[/\\]ui[/\\]mentionReview\.ts$/ }, () => ({
        contents: execFileSync("git", ["show", `${baselineRef}:src/ui/mentionReview.ts`], { encoding: "utf8" }), loader: "ts", resolveDir: path.resolve("src/ui") }));
    } }] : [] });
  const review = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#${baseline}`);
  const prefix = review.reviewPrefix("local-benchmark", "fixture");
  const posts = Array.from({ length: 8400 }, (_, i) => ({ id: `p${i}`, channel_id: `c${i % 39}`, user_id: "author", create_at: i + 1,
    message: `@all 負荷確認 ${i}\n${"取得・描画・確認状態を確認するためのダミーデータです。".repeat(i % 7 === 0 ? 14 : 3)}` }));
  await review.ingestReview(prefix, "*", posts);
  await review.ingestReview(prefix, "team", posts);
  await review.writeReview(prefix, { [`${prefix}confirmed:p0`]: 123 });
  const entries = review.selectReview(values, prefix, "*");
  if (entries.length !== posts.length || entries.find(e => e.post.id === "p0")?.confirmedAt !== 123) throw new Error("Review state changed");
  results.push({ version: baseline ? baselineRef : "working-tree", posts: posts.length, scopes: 2,
    bytes: Buffer.byteLength(JSON.stringify(values)), pending: entries.filter(e => e.confirmedAt === null).length });
}
await fs.mkdir("test-results", { recursive: true });
await fs.writeFile("test-results/review-storage-measurement.json", JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results, null, 2));
