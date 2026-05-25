export interface MetricsSnapshot {
  counters: Record<string, number>;
  histograms: Record<string, { count: number; sum: number; p50: number; p95: number; p99: number }>;
  gauges: Record<string, number>;
}

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
    const h: Record<string, { count: number; sum: number; p50: number; p95: number; p99: number }> = {};
    for (const [name, values] of this.histograms) {
      const sorted = [...values].sort((a, b) => a - b);
      h[name] = {
        count: sorted.length,
        sum: sorted.reduce((a, b) => a + b, 0),
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      };
    }
    return {
      counters: Object.fromEntries(this.counters),
      histograms: h,
      gauges: Object.fromEntries(this.gauges),
    };
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}
