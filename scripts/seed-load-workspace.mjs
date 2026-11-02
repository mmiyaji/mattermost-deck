// Local Docker workload helper: node scripts/seed-load-workspace.mjs [resume-manifest.json]
// Reads ignored e2e/mm95-state.json; writes resumable output under .tmp-load-data/.
// Supply DECK_LOAD_PASSWORD for generated accounts; never embed credentials here.
import fs from "node:fs/promises";
import path from "node:path";

const fixture = JSON.parse(await fs.readFile("e2e/mm95-state.json", "utf8"));
// Keep this developer helper confined to the local Docker fixture.
const origin = "http://127.0.0.1:8066";
const loadPassword = process.env.DECK_LOAD_PASSWORD;
if (!loadPassword) throw new Error("Set DECK_LOAD_PASSWORD for the local load-writer accounts (use the same value when resuming).");
const output = path.resolve(".tmp-load-data");
await fs.mkdir(output, { recursive: true });
const resumePath = process.argv[2];
const resumed = resumePath ? JSON.parse(await fs.readFile(resumePath, "utf8")) : null;
const runId = resumed?.runId ?? Date.now().toString();
const manifestPath = resumePath ? path.resolve(resumePath) : path.join(output, `workspace-${runId}.json`);
const manifest = resumed ?? { runId, origin, targetUsername: fixture.memberUser.username, teams: [], authors: [], directChannels: [],
  postIds: [], counts: { roots: 0, threadRoots: 0, replies: 0, direct: 0, mentions: 0 }, startedAt: new Date().toISOString() };
if (resumed?.completedAt) {
  console.log(JSON.stringify({ completed: true, manifestPath, layoutPath: resumed.layoutPath, totalPosts: resumed.totalPosts }, null, 2));
  process.exit(0);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(token, method, route, body) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${origin}/api/v4${route}`, { method, headers: {
      "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 429 && attempt < 8) {
      await pause(Math.max(1000, Number(response.headers.get("Retry-After") ?? 1) * 1000)); continue;
    }
    if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}
async function login(username, password) {
  const response = await fetch(`${origin}/api/v4/users/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: username, password }) });
  if (!response.ok || !response.headers.get("Token")) throw new Error(`Local fixture login failed: ${response.status}`);
  return response.headers.get("Token");
}
async function save() { await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2)); }
async function batch(items, run, concurrency = 6) {
  let cursor = 0;
  let error;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!error && cursor < items.length) { const index = cursor++; try { await run(items[index], index); } catch (e) { error = e; } }
  }));
  if (error) throw error;
}
const admin = await login(fixture.adminUser.username, fixture.adminUser.password);
const target = await login(fixture.memberUser.username, fixture.memberUser.password);
const targetUser = await api(target, "GET", "/users/me");
if (targetUser.username !== "mm95user") throw new Error("Unexpected target account; expected mm95user on local Docker");
manifest.targetUserId = targetUser.id;
await save();
console.log(`負荷用データ作成開始: ${origin}, @${targetUser.username}, manifest=${manifestPath}`);
try {
  const titles = ["開発", "運用", "品質", "企画", "基盤", "連携", "営業", "研究", "分析", "制作", "支援", "検証", "全社"];
  for (let i = manifest.authors.length; i < 4; i++) {
    const username = `loadwriter${runId}${i}`;
    const user = await api(admin, "POST", "/users", { username, email: `${username}@example.test`, password: loadPassword });
    manifest.authors.push({ id: user.id, username });
  }
  const tokens = await Promise.all(manifest.authors.map(author => login(author.username, loadPassword)));
  for (let i = manifest.teams.length; i < 13; i++) {
    const team = await api(admin, "POST", "/teams", { name: `deckload${runId}t${i}`, display_name: `[負荷TEST] ${String(i + 1).padStart(2, "0")} ${titles[i]}`, type: "O" });
    const entry = { id: team.id, name: team.name, display_name: team.display_name, channels: [] };
    manifest.teams.push(entry);
    for (const user of [targetUser, ...manifest.authors]) await api(admin, "POST", `/teams/${team.id}/members`, { team_id: team.id, user_id: user.id });
    for (const [j, name] of ["連絡", "障害・レビュー", "長文・会話"].entries()) {
      const channel = await api(admin, "POST", "/channels", { team_id: team.id, name: `load-${j + 1}`, display_name: `[負荷TEST] ${name}`, type: "O" });
      entry.channels.push({ id: channel.id, name: channel.name, display_name: channel.display_name, roots: [] });
      for (const user of [targetUser, ...manifest.authors]) await api(admin, "POST", `/channels/${channel.id}/members`, { user_id: user.id });
      await api(target, "POST", "/channels/members/me/view", { channel_id: channel.id, collapsed_threads_supported: true });
    }
    await save();
    console.log(`チーム準備 ${i + 1}/13: ${entry.display_name}`);
  }
  const text = (i, label, mention = "") => `${mention} [DECK-LOAD:${runId}] ${label} #${i}\n\n` +
    (i % 7 === 0 ? `### 負荷テスト用の長文\n${"取得・描画・検索・折りたたみ・確認状態の操作感を確認するためのダミーデータです。".repeat(14)}\n\n- 状態: 確認待ち\n- 対象: API / UI / queue\n\n\`\`\`json\n{"loadtest":true,"sample":${i},"status":"review"}\n\`\`\`` :
      `負荷テストのダミー投稿です。性能確認・レビュー・検索対象として使用してください。\n${"ログと件数バッジの更新を確認します。".repeat(i % 5 + 1)}`);
  const mention = i => ["", `@${targetUser.username}`, "@all", "@here", "", "@channel"][i % 6];
  const channels = manifest.teams.flatMap(team => team.channels.map(channel => ({ team, channel })));
  for (const [ci, { team, channel }] of channels.entries()) {
    if (channel.seeded) continue;
    await batch(Array.from({ length: 120 }, (_, i) => i), async i => {
      const token = tokens[i % tokens.length];
      const post = await api(token, "POST", "/posts", { channel_id: channel.id, message: text(i, `${team.display_name} ${channel.display_name}`, mention(i)) });
      manifest.postIds.push(post.id); manifest.counts.roots++; if (mention(i)) manifest.counts.mentions++;
    });
    for (let r = 0; r < 8; r++) {
      const root = await api(tokens[r % tokens.length], "POST", "/posts", { channel_id: channel.id, message: text(r, `会話・スレッド ${r + 1}`) });
      channel.roots.push(root.id); manifest.postIds.push(root.id); manifest.counts.threadRoots++;
      const addReply = async i => {
        const post = await api(tokens[(r + i) % tokens.length], "POST", "/posts", { channel_id: channel.id, root_id: root.id,
          message: text(i, `スレッド ${r + 1} の返信 ${i + 1}`, mention(i)) });
        manifest.postIds.push(post.id); manifest.counts.replies++; if (mention(i)) manifest.counts.mentions++;
      };
      // Mattermost 9.5 lazily inserts the Threads row on the first reply.
      // Serialize that reply to avoid racing the server's unique thread key.
      await addReply(0);
      await batch(Array.from({ length: 23 }, (_, i) => i + 1), addReply);
    }
    channel.seeded = true;
    await save();
    console.log(`投稿作成 ${ci + 1}/39: 投稿 ${manifest.postIds.length}, スレッド ${manifest.counts.threadRoots}`);
  }
  for (const [index, author] of manifest.authors.entries()) {
    const channel = await api(admin, "POST", "/channels/direct", [author.id, targetUser.id]);
    manifest.directChannels.push({ id: channel.id, author: author.username });
    await batch(Array.from({ length: 100 }, (_, i) => i), async i => {
      const post = await api(tokens[index], "POST", "/posts", { channel_id: channel.id, message: text(i, `DM 負荷 ${author.username}`) });
      manifest.postIds.push(post.id); manifest.counts.direct++;
    });
    await save();
  }
  const columns = [
    { id: "load-diagnostics", type: "diagnostics", customTitle: "負荷モニター", width: 320, row: 0 },
    { id: "load-all", type: "mentions", customTitle: "全チーム・未読", unreadOnly: true, width: 360, row: 0 },
    { id: "load-review", type: "mentions", customTitle: "全チーム・要確認", mentionReview: true, unreadOnly: true, width: 360, row: 0 },
    { id: "load-history", type: "mentions", customTitle: "全チーム・履歴", unreadOnly: false, width: 360, row: 1 },
  ];
  for (let i = 0; i < 3; i++) {
    const t = manifest.teams[i];
    columns.push({ id: `load-team-${i}`, type: "mentions", teamId: t.id, customTitle: `${titles[i]}・未読`, unreadOnly: true, width: 340, row: 0 });
    columns.push({ id: `load-team-review-${i}`, type: "mentions", teamId: t.id, customTitle: `${titles[i]}・要確認`, mentionReview: true, unreadOnly: true, width: 340, row: 1 });
    columns.push({ id: `load-channel-${i}`, type: "channelWatch", teamId: t.id, channelId: t.channels[0].id,
      teamLabel: t.display_name, channelLabel: t.channels[0].display_name, customTitle: `${titles[i]}・監視`, width: 340, row: 1 });
    columns.push({ id: `load-keyword-${i}`, type: "keywordWatch", teamId: t.id, query: `DECK-LOAD`, customTitle: `${titles[i]}・キーワード`, width: 340, row: 0 });
  }
  columns.push({ id: "load-dm", type: "dmWatch", channelId: manifest.directChannels[0].id, customTitle: "負荷DM", channelLabel: manifest.authors[0].username, width: 340, row: 1 });
  columns.push({ id: "load-operations-channel", type: "channelWatch", teamId: manifest.teams[0].id, channelId: manifest.teams[0].channels[1].id,
    teamLabel: manifest.teams[0].display_name, channelLabel: manifest.teams[0].channels[1].display_name, customTitle: "運用監視・負荷", width: 340, row: 1 });
  const layoutPath = path.join(output, `layout-${runId}.json`);
  if (new Set(columns.map(column => column.id)).size !== columns.length) throw new Error("Duplicate pane ID");
  await fs.writeFile(layoutPath, JSON.stringify({ columns, layoutMode: "twoRows", rowSplit: 50 }, null, 2));
  manifest.layoutPath = layoutPath; manifest.columnCount = columns.length;
  manifest.completedAt = new Date().toISOString();
  delete manifest.error;
  manifest.totalPosts = manifest.postIds.length;
  await save();
  await fs.writeFile(path.join(output, "latest.json"), JSON.stringify({ manifestPath, layoutPath }, null, 2));
  console.log(JSON.stringify({ manifestPath, layoutPath, teams: manifest.teams.length, channels: channels.length, counts: manifest.counts, totalPosts: manifest.totalPosts, panes: columns.length }, null, 2));
} catch (error) {
  manifest.error = String(error); await save(); throw error;
}
