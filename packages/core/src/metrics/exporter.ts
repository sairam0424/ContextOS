import type { MetricsSnapshot } from './collector.js';

export function toPrometheusText(snapshot: MetricsSnapshot, prefix = 'contextos'): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(snapshot.counters)) {
    const m = `${prefix}_${name.replace(/\./g, '_')}_total`;
    lines.push(`# TYPE ${m} counter`);
    lines.push(`${m} ${value}`);
  }
  for (const [name, hist] of Object.entries(snapshot.histograms)) {
    const m = `${prefix}_${name.replace(/\./g, '_')}`;
    lines.push(`# TYPE ${m} summary`);
    lines.push(`${m}{quantile="0.5"} ${hist.p50}`);
    lines.push(`${m}{quantile="0.95"} ${hist.p95}`);
    lines.push(`${m}{quantile="0.99"} ${hist.p99}`);
    lines.push(`${m}_sum ${hist.sum}`);
    lines.push(`${m}_count ${hist.count}`);
  }
  for (const [name, value] of Object.entries(snapshot.gauges)) {
    const m = `${prefix}_${name.replace(/\./g, '_')}`;
    lines.push(`# TYPE ${m} gauge`);
    lines.push(`${m} ${value}`);
  }
  return lines.join('\n') + '\n';
}
