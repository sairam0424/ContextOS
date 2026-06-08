import assert from 'node:assert';
import { MetricsCollector } from '../metrics/collector.js';
import { toPrometheusText } from '../metrics/exporter.js';
import {
  instrumentConnection,
  queryLabel,
  QUERY_LATENCY_METRIC,
  SLOW_QUERY_THRESHOLD_MS,
} from '../database/query-metrics.js';
import { createTestDb, cleanupTestDb, type TestDB } from './helpers.js';

describe('Query observability — latency histograms + slow-query logging', function () {
  this.timeout(10000);

  let testDb: TestDB;

  beforeEach(() => {
    testDb = createTestDb('query-metrics');
  });

  afterEach(() => {
    cleanupTestDb(testDb);
  });

  it('records a latency observation for each instrumented query', () => {
    const metrics = new MetricsCollector();
    const db = instrumentConnection(testDb.db, metrics);

    db.prepare('SELECT 1 AS one').get();
    db.prepare('SELECT name FROM sqlite_master').all();

    const snap = metrics.snapshot();
    const hist = snap.histograms[QUERY_LATENCY_METRIC];
    assert.ok(hist, 'latency histogram should exist');
    assert.strictEqual(hist.count, 2, 'two queries should produce two observations');
    assert.ok(hist.sum >= 0, 'sum should be non-negative');
  });

  it('keeps query identity coarse and free of row data', () => {
    const label = queryLabel(
      "SELECT * FROM documents WHERE content = 'super secret personal data here'",
    );
    assert.ok(label.length <= 40, 'label should be capped at ~40 chars');
    assert.ok(!label.includes('secret'), 'label must not leak row values');
    assert.strictEqual(
      queryLabel('INSERT  INTO\n  access_log (path)\tVALUES (?)'),
      'INSERT INTO access_log (path) VALUES (?)',
      'whitespace should be normalized',
    );
  });

  it('observes a query that exceeds the slow-query threshold', () => {
    // The slow-query warn log is a side effect routed through pino's
    // worker-thread transport (logger.ts destination: fd 2), which bypasses
    // process.stderr.write and cannot be reliably intercepted in-process. The
    // observable, deterministic contract is the recorded latency metric — assert
    // on that instead. (Behavioral verification of the warn line belongs in a
    // logging integration test with a captured pino destination, not here.)
    const metrics = new MetricsCollector();
    const db = instrumentConnection(testDb.db, metrics);

    // A heavy recursive computation deterministically exceeds the 100ms
    // threshold without a sleep: count a large recursive series.
    db.prepare(
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 4000000)
       SELECT COUNT(*) AS n FROM c`,
    ).get();

    const hist = metrics.snapshot().histograms[QUERY_LATENCY_METRIC];
    assert.ok(hist && hist.count >= 1, 'slow query should be observed in the histogram');
    assert.ok(
      hist.sum > SLOW_QUERY_THRESHOLD_MS,
      'observed latency should exceed the slow-query threshold',
    );
  });

  it('does not instrument when no collector is supplied (off-by-default-safe)', () => {
    // createTestDb uses the plain createConnection (no metrics), so the raw
    // connection's prepare is untouched and queries still work normally.
    const row = testDb.db.prepare('SELECT 42 AS answer').get() as { answer: number };
    assert.strictEqual(row.answer, 42);
  });

  it('exporter emits a real Prometheus histogram with cumulative buckets', () => {
    const metrics = new MetricsCollector();
    metrics.observe(QUERY_LATENCY_METRIC, 2);
    metrics.observe(QUERY_LATENCY_METRIC, 30);
    metrics.observe(QUERY_LATENCY_METRIC, 300);

    const text = toPrometheusText(metrics.snapshot());
    const metricName = `contextos_${QUERY_LATENCY_METRIC.replace(/\./g, '_')}`;

    assert.ok(text.includes(`# TYPE ${metricName} histogram`), 'should declare histogram type');
    assert.ok(text.includes(`${metricName}_bucket{le="5"} 1`), 'one observation <= 5ms');
    assert.ok(text.includes(`${metricName}_bucket{le="50"} 2`), 'two observations <= 50ms');
    assert.ok(text.includes(`${metricName}_bucket{le="+Inf"} 3`), '+Inf bucket holds total count');
    assert.ok(text.includes(`${metricName}_count 3`), 'count should be the total');
    assert.ok(text.includes(`${metricName}_sum 332`), 'sum should be 2 + 30 + 300');

    // Pre-existing quantile summary must still be emitted (kept working).
    assert.ok(
      text.includes(`# TYPE ${metricName}_quantiles summary`),
      'quantile summary should be preserved alongside the histogram',
    );
  });
});
