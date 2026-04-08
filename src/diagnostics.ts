export interface SpecialMentionMetricsSnapshot {
  totalScans: number;
  totalHits: number;
  totalChannelsScanned: number;
  cacheHits: number;
  cacheMisses: number;
  lastScanAt: number | null;
}

export interface WebSocketMetricsSnapshot {
  reconnectCount: number;
  lastReconnectAt: number | null;
}

export interface RenderMetricsSnapshot {
  commitCount: number;
  averageCommitMs: number;
  p95CommitMs: number;
  lastCommitMs: number;
  recentCommitMs: number[];
}

export interface DeckDiagnosticsSnapshot {
  specialMentions: SpecialMentionMetricsSnapshot;
  websocket: WebSocketMetricsSnapshot;
  render: RenderMetricsSnapshot;
}

const RENDER_SAMPLE_LIMIT = 40;

const state: DeckDiagnosticsSnapshot = {
  specialMentions: {
    totalScans: 0,
    totalHits: 0,
    totalChannelsScanned: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lastScanAt: null,
  },
  websocket: {
    reconnectCount: 0,
    lastReconnectAt: null,
  },
  render: {
    commitCount: 0,
    averageCommitMs: 0,
    p95CommitMs: 0,
    lastCommitMs: 0,
    recentCommitMs: [],
  },
};

function computeP95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[index] ?? 0;
}

export function recordSpecialMentionScan(metrics: {
  hits: number;
  channelsScanned: number;
  cacheHits?: number;
  cacheMisses?: number;
}): void {
  state.specialMentions.totalScans += 1;
  state.specialMentions.totalHits += Math.max(0, metrics.hits);
  state.specialMentions.totalChannelsScanned += Math.max(0, metrics.channelsScanned);
  state.specialMentions.cacheHits += Math.max(0, metrics.cacheHits ?? 0);
  state.specialMentions.cacheMisses += Math.max(0, metrics.cacheMisses ?? 0);
  state.specialMentions.lastScanAt = Date.now();
}

export function recordWebSocketReconnectAttempt(): void {
  state.websocket.reconnectCount += 1;
  state.websocket.lastReconnectAt = Date.now();
}

export function recordRenderCommit(durationMs: number): void {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  state.render.commitCount += 1;
  state.render.lastCommitMs = safeDuration;
  state.render.recentCommitMs = [...state.render.recentCommitMs, safeDuration].slice(-RENDER_SAMPLE_LIMIT);
  const total = state.render.recentCommitMs.reduce((sum, value) => sum + value, 0);
  state.render.averageCommitMs = state.render.recentCommitMs.length > 0 ? total / state.render.recentCommitMs.length : 0;
  state.render.p95CommitMs = computeP95(state.render.recentCommitMs);
}

export function getDeckDiagnosticsSnapshot(): DeckDiagnosticsSnapshot {
  return {
    specialMentions: { ...state.specialMentions },
    websocket: { ...state.websocket },
    render: {
      ...state.render,
      recentCommitMs: state.render.recentCommitMs.slice(),
    },
  };
}
