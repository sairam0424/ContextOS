import type { MetricsSnapshot } from './collector.js';

const sanitize = (name: string): string => name.replace(/\./g, '_');
const formatLe = (le: number): string => (le === Infinity ? '+Inf' : String(le));

export function toPrometheusText(snapshot: MetricsSnapshot, prefix = 'contextos'): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(snapshot.counters)) {
    const m = `${prefix}_${sanitize(name)}_total`;
    lines.push(`# TYPE ${m} counter`);
    lines.push(`${m} ${value}`);
  }
  for (const [name, hist] of Object.entries(snapshot.histograms)) {
    const m = `${prefix}_${sanitize(name)}`;
    // Real Prometheus histogram: cumulative `le` buckets + _sum + _count.
    // Cross-instance aggregation works because every bucket is cumulative and
    // bucket bounds are shared across instances.
    lines.push(`# TYPE ${m} histogram`);
    for (const bucket of hist.buckets) {
      lines.push(`${m}_bucket{le="${formatLe(bucket.le)}"} ${bucket.count}`);
    }
    lines.push(`${m}_sum ${hist.sum}`);
    lines.push(`${m}_count ${hist.count}`);
    // Pre-computed quantiles preserved as a sibling summary metric (a distinct
    // name avoids a duplicate `# TYPE` for `${m}`, which Prometheus rejects).
    const q = `${m}_quantiles`;
    lines.push(`# TYPE ${q} summary`);
    lines.push(`${q}{quantile="0.5"} ${hist.p50}`);
    lines.push(`${q}{quantile="0.95"} ${hist.p95}`);
    lines.push(`${q}{quantile="0.99"} ${hist.p99}`);
    lines.push(`${q}_sum ${hist.sum}`);
    lines.push(`${q}_count ${hist.count}`);
  }
  for (const [name, value] of Object.entries(snapshot.gauges)) {
    const m = `${prefix}_${sanitize(name)}`;
    lines.push(`# TYPE ${m} gauge`);
    lines.push(`${m} ${value}`);
  }
  return lines.join('\n') + '\n';
}
