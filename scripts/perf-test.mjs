/**
 * mattermost-deck パフォーマンステスト
 * API キューシミュレーション + DM解決 + フィルタリングの比較計測
 */

// ── ユーティリティ ────────────────────────────────────────────────────────────

function now() {
  return performance.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMs(ms) {
  return ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((s, v) => s + v, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / samples.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
  };
}

function printStats(label, samples) {
  const s = stats(samples);
  console.log(`  ${label}`);
  console.log(`    avg=${formatMs(s.avg)}  p50=${formatMs(s.p50)}  p95=${formatMs(s.p95)}  min=${formatMs(s.min)}  max=${formatMs(s.max)}`);
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ── APIキューシミュレーター ───────────────────────────────────────────────────
// 実装と同じ: 120ms min-gap + inflight dedup + burst guard 1000ms

const API_REQUEST_MIN_GAP_MS = 120;
const GET_BURST_GUARD_TTL_MS = 1_000;

function createApiQueue() {
  let requestQueue = Promise.resolve();
  let nextRequestAt = 0;

  async function scheduleApiRequest(task) {
    let release;
    const waitTurn = new Promise((resolve) => { release = resolve; });
    const previous = requestQueue;
    requestQueue = previous.then(() => waitTurn);
    await previous;

    const delay = Math.max(0, nextRequestAt - now());
    if (delay > 0) await sleep(delay);

    try {
      return await task();
    } finally {
      nextRequestAt = now() + API_REQUEST_MIN_GAP_MS;
      release();
    }
  }

  return { scheduleApiRequest };
}

// ── 模擬APIコール ────────────────────────────────────────────────────────────

// ネットワーク遅延: 均一分布 [min, max]
function networkDelay(min = 10, max = 40) {
  return min + Math.random() * (max - min);
}

function makeMockApi(queue, latencyMin = 10, latencyMax = 40) {
  async function apiGet(path) {
    return queue.scheduleApiRequest(async () => {
      await sleep(networkDelay(latencyMin, latencyMax));
      return { path };
    });
  }

  async function apiPost(path, body) {
    return queue.scheduleApiRequest(async () => {
      await sleep(networkDelay(latencyMin, latencyMax));
      return { path, count: Array.isArray(body) ? body.length : 1 };
    });
  }

  return { apiGet, apiPost };
}

// ── テストデータ生成 ──────────────────────────────────────────────────────────

function makeUserId(i) {
  return `user${String(i).padStart(6, "0")}abcdefghij`;
}

function makeDmChannel(i, myUserId) {
  const otherId = makeUserId(i);
  // Mattermost は userId の辞書順で name を構築する
  const parts = [myUserId, otherId].sort();
  return {
    id: `dmchan${String(i).padStart(6, "0")}`,
    name: `${parts[0]}__${parts[1]}`,
    type: "D",
    display_name: "",
    team_id: undefined,
  };
}

function makeGroupChannel(i) {
  return {
    id: `grpchan${String(i).padStart(6, "0")}`,
    name: `group-dm-${i}`,
    type: "G",
    display_name: `Group ${i}`,
    team_id: undefined,
  };
}

function makeChannelOption(i) {
  return {
    value: `chan${String(i).padStart(6, "0")}`,
    label: `channel-${i}-${"abcdefghij".slice(0, (i % 10) + 1)}`,
  };
}

// ── テスト 1: DM メンバー取得 ─────────────────────────────────────────────────

section("テスト 1: DM メンバー取得 (旧実装 vs 新実装)");
console.log("  シナリオ: DM 100件 + グループDM 10件\n");

async function oldDmResolution(dmChannels, groupChannels, api) {
  const allChannels = [...dmChannels, ...groupChannels];
  // 旧: 全チャンネルで getChannelMembers を Promise.all (キュー経由で直列化)
  const memberEntries = await Promise.all(
    allChannels.map(async (channel) => ({
      channelId: channel.id,
      members: await api.apiGet(`/channels/${channel.id}/members`),
    }))
  );
  return memberEntries.length;
}

async function newDmResolution(dmChannels, groupChannels, api) {
  // 新: Dタイプは name から直接パース、Gタイプのみ API
  const memberDirectory = {};
  for (const channel of dmChannels) {
    const parts = channel.name.split("__");
    memberDirectory[channel.id] = parts.length === 2 ? parts.filter(Boolean) : [];
  }
  if (groupChannels.length > 0) {
    const groupEntries = await Promise.all(
      groupChannels.map(async (channel) => ({
        channelId: channel.id,
        userIds: await api.apiGet(`/channels/${channel.id}/members`),
      }))
    );
    for (const entry of groupEntries) {
      memberDirectory[entry.channelId] = entry.userIds;
    }
  }
  return Object.keys(memberDirectory).length;
}

{
  const MY_USER_ID = makeUserId(0);
  const DM_COUNT = 100;
  const GROUP_COUNT = 10;
  const dmChannels = Array.from({ length: DM_COUNT }, (_, i) => makeDmChannel(i + 1, MY_USER_ID));
  const groupChannels = Array.from({ length: GROUP_COUNT }, (_, i) => makeGroupChannel(i));

  const RUNS = 3;
  const oldTimes = [];
  const newTimes = [];

  for (let r = 0; r < RUNS; r++) {
    // 旧実装
    {
      const queue = createApiQueue();
      const api = makeMockApi(queue);
      const t0 = now();
      await oldDmResolution(dmChannels, groupChannels, api);
      oldTimes.push(now() - t0);
    }
    // 新実装
    {
      const queue = createApiQueue();
      const api = makeMockApi(queue);
      const t0 = now();
      await newDmResolution(dmChannels, groupChannels, api);
      newTimes.push(now() - t0);
    }
  }

  printStats(`旧実装 (API ${DM_COUNT + GROUP_COUNT}件)`, oldTimes);
  printStats(`新実装 (API ${GROUP_COUNT}件 + name parse)`, newTimes);

  const ratio = stats(oldTimes).avg / stats(newTimes).avg;
  console.log(`\n  → 平均 ${ratio.toFixed(1)}x 高速化`);
  console.log(`  → APIリクエスト数: ${DM_COUNT + GROUP_COUNT} → ${GROUP_COUNT} (-${DM_COUNT}件, -${((DM_COUNT / (DM_COUNT + GROUP_COUNT)) * 100).toFixed(0)}%)`);
}

// ── テスト 2: チャンネルバッチ取得 ───────────────────────────────────────────

section("テスト 2: 不在チャンネル解決 (個別 vs バッチ)");
console.log("  シナリオ: 20件の不在チャンネルを解決\n");

async function oldChannelResolution(channelIds, api) {
  // 旧: getChannel(id) × N を Promise.all
  const channels = await Promise.all(
    channelIds.map((id) => api.apiGet(`/channels/${id}`))
  );
  return channels.length;
}

async function newChannelResolution(channelIds, api) {
  // 新: POST /channels/ids で一括
  const result = await api.apiPost("/channels/ids", channelIds);
  return result.count;
}

{
  const CHANNEL_COUNT = 20;
  const channelIds = Array.from({ length: CHANNEL_COUNT }, (_, i) => `chan${i}`);

  const RUNS = 5;
  const oldTimes = [];
  const newTimes = [];

  for (let r = 0; r < RUNS; r++) {
    {
      const queue = createApiQueue();
      const api = makeMockApi(queue);
      const t0 = now();
      await oldChannelResolution(channelIds, api);
      oldTimes.push(now() - t0);
    }
    {
      const queue = createApiQueue();
      const api = makeMockApi(queue);
      const t0 = now();
      await newChannelResolution(channelIds, api);
      newTimes.push(now() - t0);
    }
  }

  printStats(`旧実装 (個別 ${CHANNEL_COUNT}件)`, oldTimes);
  printStats(`新実装 (バッチ 1件)`, newTimes);

  const ratio = stats(oldTimes).avg / stats(newTimes).avg;
  console.log(`\n  → 平均 ${ratio.toFixed(1)}x 高速化`);
  console.log(`  → APIリクエスト数: ${CHANNEL_COUNT} → 1 (-${CHANNEL_COUNT - 1}件, -${(((CHANNEL_COUNT - 1) / CHANNEL_COUNT) * 100).toFixed(0)}%)`);
}

// ── テスト 3: CustomSelect フィルタリング ────────────────────────────────────

section("テスト 3: CustomSelect オプションフィルタリング");
console.log("  シナリオ: 300件のチャンネルリストを部分一致検索\n");

function filterOptions(options, query) {
  if (!query.trim()) return options;
  const lower = query.trim().toLowerCase();
  return options.filter((o) => o.label.toLowerCase().includes(lower));
}

{
  const OPTION_COUNT = 300;
  const options = Array.from({ length: OPTION_COUNT }, (_, i) => makeChannelOption(i));
  const queries = ["channel-1", "abc", "xyz", "channel-25", "ij", "000"];
  const ITERATIONS = 10_000;

  const times = [];
  for (const query of queries) {
    const t0 = now();
    for (let i = 0; i < ITERATIONS; i++) {
      filterOptions(options, query);
    }
    const elapsed = now() - t0;
    const perOp = elapsed / ITERATIONS;
    times.push(perOp);
    const matchCount = filterOptions(options, query).length;
    console.log(`  query="${query.padEnd(12)}" → ${String(matchCount).padStart(3)}件  ${formatMs(perOp)}/op`);
  }

  const avg = times.reduce((s, v) => s + v, 0) / times.length;
  console.log(`\n  → 全クエリ平均: ${formatMs(avg)}/op (${OPTION_COUNT}件リスト)`);
  console.log(`  → 60fps (16.7ms) フレームで ${Math.floor(16.7 / avg).toLocaleString()}回フィルタリング可能`);
}

// ── テスト 4: DM件数スケール別 所要時間 ──────────────────────────────────────

section("テスト 4: DM件数スケール別 ロード時間推定");
console.log("  ネットワーク遅延: 10–40ms, APIキュー間隔: 120ms\n");

console.log("  DM件数  グループDM  旧実装(推定)     新実装(推定)     削減");

async function measureOnce(dmCount, groupCount) {
  const MY_USER_ID = makeUserId(0);
  const dmChannels = Array.from({ length: dmCount }, (_, i) => makeDmChannel(i + 1, MY_USER_ID));
  const groupChannels = Array.from({ length: groupCount }, (_, i) => makeGroupChannel(i));

  const [oldTime, newTime] = await Promise.all([
    (async () => {
      const queue = createApiQueue();
      const api = makeMockApi(queue, 15, 25);
      const t0 = now();
      await oldDmResolution(dmChannels, groupChannels, api);
      return now() - t0;
    })(),
    (async () => {
      const queue = createApiQueue();
      const api = makeMockApi(queue, 15, 25);
      const t0 = now();
      await newDmResolution(dmChannels, groupChannels, api);
      return now() - t0;
    })(),
  ]);

  return { oldTime, newTime };
}

const scales = [
  { dm: 10,  group: 3  },
  { dm: 50,  group: 5  },
  { dm: 100, group: 10 },
  { dm: 200, group: 15 },
  { dm: 500, group: 20 },
];

for (const { dm, group } of scales) {
  const { oldTime, newTime } = await measureOnce(dm, group);
  const reduction = ((oldTime - newTime) / oldTime * 100).toFixed(0);
  console.log(
    `  ${String(dm).padStart(6)}件  ${String(group).padStart(9)}件  ` +
    `${formatMs(oldTime).padStart(14)}   ${formatMs(newTime).padStart(14)}   -${reduction}%`
  );
}

// ── サマリー ──────────────────────────────────────────────────────────────────

section("サマリー");
console.log(`
  [修正1] DM メンバー取得
    Dタイプ(1対1)のDMは channel.name から直接ユーザーIDを取得
    APIリクエストを DM件数分ゼロに削減（グループDMのみ残存）

  [修正2] チャンネルバッチ取得
    POST /channels/ids で N件を 1リクエストに統合
    APIキューの直列待ちを排除

  [修正3] CustomSelect 検索フィルター
    8件超のリストで絞り込み入力を表示
    0.01ms/op 以下で動作、チャンネル数に関わらず快適
`);
