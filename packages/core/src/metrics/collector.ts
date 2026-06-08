/** A single Prometheus-style cumulative histogram bucket. */
export interface HistogramBucket {
  /** Inclusive upper bound (the Prometheus `le` label). `Infinity` for the +Inf bucket. */
  le: number;
  /** Cumulative count of observations with value <= le. */
  count: number;
}

export interface HistogramSnapshot {
  count: number;
  sum: number;
  p50: number;
  p95: number;
  p99: number;
  /** Cumulative buckets for real Prometheus histogram aggregation. */
  buckets: HistogramBucket[];
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  histograms: Record<string, HistogramSnapshot>;
  gauges: Record<string, number>;
}

/**
 * Default bucket boundaries (milliseconds) tuned for query-latency observability.
 * Cumulative cross-instance aggregation works as long as every instance shares
 * these bounds; the implicit +Inf bucket is appended at snapshot time.
 */
export const DEFAULT_LATENCY_BUCKETS_MS: readonly number[] = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
];

export class MetricsCollector {
  private static readonly MAX_HISTOGRAM_SIZE = 1000;

  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private gauges = new Map<string, number>();

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  observe(name: string, value: number): void {
    const existing = this.histograms.get(name) ?? [];
    existing.push(value);
    // Trim to prevent unbounded growth
    if (existing.length > MetricsCollector.MAX_HISTOGRAM_SIZE) {
      existing.splice(0, existing.length - MetricsCollector.MAX_HISTOGRAM_SIZE);
    }
    this.histograms.set(name, existing);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  snapshot(): MetricsSnapshot {
    const h: Record<string, HistogramSnapshot> = {};
    for (const [name, values] of this.histograms) {
      const sorted = [...values].sort((a, b) => a - b);
      h[name] = {
        count: sorted.length,
        sum: sorted.reduce((a, b) => a + b, 0),
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
        buckets: MetricsCollector.computeBuckets(sorted),
      };
    }
    return {
      counters: Object.fromEntries(this.counters),
      histograms: h,
      gauges: Object.fromEntries(this.gauges),
    };
  }

  /**
   * Builds cumulative Prometheus histogram buckets from a sorted ascending list.
   * Each bucket count is the number of observations with value <= its bound;
   * a final `+Inf` bucket carries the total count, as Prometheus requires.
   */
  private static computeBuckets(sorted: readonly number[]): HistogramBucket[] {
    const buckets: HistogramBucket[] = [];
    let cursor = 0;
    let cumulative = 0;
    for (const le of DEFAULT_LATENCY_BUCKETS_MS) {
      while (cursor < sorted.length && sorted[cursor] <= le) {
        cumulative += 1;
        cursor += 1;
      }
      buckets.push({ le, count: cumulative });
    }
    return [...buckets, { le: Infinity, count: sorted.length }];
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}
