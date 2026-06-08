import type { RawDB } from './types.js';
import type { MetricsCollector } from '../metrics/collector.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('database:query-metrics');

/** Statements slower than this (ms) are logged at warn level. */
export const SLOW_QUERY_THRESHOLD_MS = 100;

/** Histogram name for per-query latency, in milliseconds. */
export const QUERY_LATENCY_METRIC = 'db.query.latency_ms';

const TIMED_METHODS = ['get', 'all', 'run'] as const;

/**
 * Derives a coarse, low-cardinality query label. We collapse runs of
 * whitespace and keep only the first ~40 characters of the SQL so the label
 * stays stable across parameter values and never carries row data — only the
 * statement shape (e.g. "INSERT INTO access_log (path, action) VALUES").
 */
export function queryLabel(sql: string): string {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  return normalized.length > 40 ? normalized.slice(0, 40) : normalized;
}

/**
 * Wraps a database connection so each prepared statement's get/all/run call is
 * timed: latency is recorded into the MetricsCollector histogram and any call
 * exceeding SLOW_QUERY_THRESHOLD_MS is logged with its coarse query label.
 *
 * Cheap and off-by-default-safe: callers that pass no collector should not call
 * this at all (connection.ts skips it), so the hot path is untouched. When
 * enabled, overhead is one `performance.now()` pair plus an array push per call.
 *
 * Returns the same db reference with a patched `prepare`; the prepared
 * statements themselves are wrapped lazily so unused methods cost nothing.
 */
export function instrumentConnection(db: RawDB, metrics: MetricsCollector): RawDB {
  const originalPrepare = db.prepare.bind(db);

  const patchedPrepare = ((source: string) => {
    const stmt = originalPrepare(source);
    const label = queryLabel(source);
    const slot = stmt as unknown as Record<string, unknown>;
    for (const method of TIMED_METHODS) {
      const original = slot[method];
      if (typeof original !== 'function') continue;
      const originalFn = original as (...args: unknown[]) => unknown;
      slot[method] = function timed(this: unknown, ...args: unknown[]) {
        const start = performance.now();
        try {
          return originalFn.apply(this, args);
        } finally {
          record(metrics, label, performance.now() - start);
        }
      };
    }
    return stmt;
  }) as RawDB['prepare'];

  // Immutability: return a fresh object that delegates to db but overrides
  // prepare, rather than mutating the original connection in place.
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') return patchedPrepare;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function record(metrics: MetricsCollector, label: string, durationMs: number): void {
  metrics.observe(QUERY_LATENCY_METRIC, durationMs);
  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    // Only the coarse statement shape and timing are logged — never row data.
    log.warn({ query: label, durationMs: Math.round(durationMs) }, 'Slow query detected');
  }
}
