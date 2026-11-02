import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

// Read-only workload against the Docker fixture. Tokens stay in memory.
const state = JSON.parse(await fs.readFile(process.env.MM95_STATE_FILE ?? "e2e/mm95-state.json", "utf8"));
const origin = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use a local Mattermost fixture");
const nativeFetch = globalThis.fetch;
let calls = 0;
globalThis.document = { cookie: "" };
globalThis.window = { location: { origin, pathname: "/testteam/channels/town-square" }, setTimeout, dispatchEvent() {} };
globalThis.fetch = (url, options = {}) => {
  calls++;
  return nativeFetch(new URL(url, origin), { ...options, headers: { ...options.headers, Authorization: `Bearer ${state.memberUser.token}` } });
};
const channelsResponse = await fetch(`/api/v4/users/me/teams/${state.team.id}/channels`);
if (!channelsResponse.ok) throw new Error(`Fixture authentication failed: ${channelsResponse.status}`);
const channels = await channelsResponse.json();
const channel = channels.find(c => c.name === "town-square") ?? channels[0];
const postsResponse = await fetch(`/api/v4/channels/${channel.id}/posts?page=0&per_page=200`);
const posts = await postsResponse.json();
const root = Object.values(posts.posts).find(p => !p.root_id && !p.delete_at);
if (!root) throw new Error("The fixture needs a root post");
const thread = { id: root.id, post: root, reply_count: 1, last_reply_at: root.create_at,
  last_viewed_at: 0, unread_mentions: 1, unread_replies: 1 };
const results = [];
const baselineRef = process.env.PERF_BASELINE_REF ?? "HEAD";
for (const baseline of [true, false]) {
  const bundle = await build({ stdin: { contents: 'export * from "./src/mattermost/api.ts";', resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "esm", plugins: baseline ? [{ name: "baseline", setup(b) {
      b.onLoad({ filter: /src[/\\]mattermost[/\\]api\.ts$/ }, () => ({
        contents: execFileSync("git", ["show", `${baselineRef}:src/mattermost/api.ts`], { encoding: "utf8" }), loader: "ts", resolveDir: path.resolve("src/mattermost") }));
    } }] : [] });
  const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#${baseline}`);
  api.configureMattermostBaseUrl(origin);
  const queueSamples = [];
  for (let round = 0; round < 3; round++) {
    const started = performance.now();
    const background = Array.from({ length: 8 }, (_, i) => api.getRecentPosts(channel.id, i + 1 + round * 10, 20));
    await api.getRecentPosts(channel.id, 0, 21 + round, "interactive");
    queueSamples.push(Math.round(performance.now() - started));
    await Promise.all(background);
  }
  calls = 0;
  const load = () => api.getMentionThreadPosts ? api.getMentionThreadPosts(thread, 200) : api.getPostThreadSince(thread.id, 0, 200, 200);
  await load();
  const firstScanRequests = calls;
  await new Promise(resolve => setTimeout(resolve, 1100));
  calls = 0;
  const started = performance.now();
  await load();
  results.push({ version: baseline ? baselineRef : "working-tree", visibleChannelMs: queueSamples,
    firstScanRequests, unchangedThreadScanRequests: calls, unchangedThreadScanMs: Math.round(performance.now() - started) });
}
await fs.mkdir("test-results", { recursive: true });
await fs.writeFile("test-results/api-queue-measurement.json", JSON.stringify({ capturedAt: new Date().toISOString(), origin, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
