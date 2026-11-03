export type AdaptiveConcurrencySample = {
  latencyMs: number;
  inFlight: number;
  congested?: boolean;
};

export type AdaptiveConcurrencySnapshot = {
  limit: number;
  maxLimit: number;
  baselineMs: number | null;
  smoothedMs: number | null;
  reason: string;
};

const HEALTHY_SAMPLES_TO_GROW = 8;
const INFLATED_SAMPLES_TO_SHRINK = 3;
const REDUCTION_COOLDOWN_SAMPLES = 8;
const LATENCY_WINDOW_SIZE = 32;

function normalizeMaximum(maximum: number): number {
  return Number.isFinite(maximum)
    ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(maximum)))
    : 1;
}

/**
 * A small Vegas/Gradient-inspired controller, not an implementation of Netflix's
 * algorithms. It compares a low-water latency estimate with smoothed response
 * latency, probes upward under sustained demand and backs off on congestion.
 *
 * Samples must exclude time waiting in the local request queue. Callers mixing
 * cheap and expensive endpoints should normalize their response times against
 * endpoint baselines before sampling. Consecutive-sample hysteresis prevents an
 * isolated naturally slow response from reducing the concurrency limit.
 */
export class AdaptiveConcurrencyController {
  private maxLimit: number;
  private limit: number;
  private baselineMs: number | null = null;
  private smoothedMs: number | null = null;
  private recentLatencies: number[] = [];
  private sortedLatencies: number[] = [];
  private healthySamples = 0;
  private inflatedSamples = 0;
  private cooldownSamples = 0;
  private reason = "initial";

  constructor(maxConcurrency: number, initialLimit = 2) {
    this.maxLimit = normalizeMaximum(maxConcurrency);
    this.limit = Math.min(normalizeMaximum(initialLimit), this.maxLimit);
  }

  configure(max: number): void {
    const nextMax = normalizeMaximum(max);
    if (nextMax === this.maxLimit) return;
    const previousMax = this.maxLimit;
    this.maxLimit = nextMax;
    this.limit = Math.min(this.limit, nextMax);
    // A live increase from a single slot should allow a second request to probe
    // capacity without waiting for an already occupied slot to finish.
    if (nextMax > previousMax && this.limit === 1) {
      this.limit = Math.min(2, nextMax);
    }
    this.healthySamples = 0;
    this.inflatedSamples = 0;
    this.cooldownSamples = 0;
    this.reason = "configured";
  }

  sample({ latencyMs, inFlight, congested = false }: AdaptiveConcurrencySample): void {
    if (!Number.isFinite(latencyMs) || latencyMs <= 0 ||
        !Number.isFinite(inFlight) || inFlight < 0) return;

    if (congested) {
      this.reduce(0.5, "congestion");
      return;
    }

    this.updateLatency(latencyMs);
    const baseline = this.baselineMs!;
    const smoothed = this.smoothedMs!;
    const saturated = inFlight >= this.limit;
    const inflated = latencyMs >= baseline * 1.5 && smoothed >= baseline * 1.5;

    this.inflatedSamples = saturated && inflated ? this.inflatedSamples + 1 : 0;
    if (this.cooldownSamples > 0) {
      this.cooldownSamples -= 1;
      this.healthySamples = 0;
      this.reason = "cooldown";
      return;
    }
    if (this.inflatedSamples >= INFLATED_SAMPLES_TO_SHRINK) {
      this.reduce(0.7, "latency-inflation");
      return;
    }

    const healthy = latencyMs <= baseline * 1.25 && smoothed <= baseline * 1.2;
    this.healthySamples = saturated && healthy ? this.healthySamples + 1 : 0;
    if (this.healthySamples >= HEALTHY_SAMPLES_TO_GROW && this.limit < this.maxLimit) {
      this.limit += 1;
      this.healthySamples = 0;
      this.reason = "healthy-load";
    } else {
      this.reason = !saturated ? "under-utilized"
        : this.limit === this.maxLimit ? "at-ceiling"
        : healthy ? "probing" : "latency-pressure";
    }
  }

  snapshot(): AdaptiveConcurrencySnapshot {
    return {
      limit: this.limit,
      maxLimit: this.maxLimit,
      baselineMs: this.baselineMs,
      smoothedMs: this.smoothedMs,
      reason: this.reason,
    };
  }

  private reduce(factor: number, reason: string): void {
    this.limit = Math.max(1, Math.floor(this.limit * factor));
    this.healthySamples = 0;
    this.inflatedSamples = 0;
    this.cooldownSamples = REDUCTION_COOLDOWN_SAMPLES;
    this.reason = reason;
  }

  private updateLatency(latencyMs: number): void {
    this.smoothedMs = this.smoothedMs === null
      ? latencyMs : this.smoothedMs * 0.8 + latencyMs * 0.2;
    if (this.recentLatencies.length === LATENCY_WINDOW_SIZE) {
      const outgoing = this.recentLatencies.shift()!;
      // Equal latencies are interchangeable; remove exactly one occurrence.
      this.sortedLatencies.splice(this.sortedLatencies.indexOf(outgoing), 1);
    }
    this.recentLatencies.push(latencyMs);
    let low = 0, high = this.sortedLatencies.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.sortedLatencies[middle]! < latencyMs) low = middle + 1;
      else high = middle;
    }
    this.sortedLatencies.splice(low, 0, latencyMs);
    // A low percentile ignores a single unusually quick response. Limit upward
    // drift so temporary overload cannot immediately redefine healthy latency;
    // retaining only recent responses lets a changed baseline eventually rebase.
    const lowLatency = this.sortedLatencies[Math.floor((this.sortedLatencies.length - 1) * 0.2)]!;
    if (this.baselineMs === null) {
      this.baselineMs = lowLatency;
    } else if (lowLatency < this.baselineMs) {
      this.baselineMs = this.baselineMs * 0.8 + lowLatency * 0.2;
    } else {
      this.baselineMs = Math.min(lowLatency, this.baselineMs * 1.02);
    }
  }
}
