import assert from 'node:assert';
import { createTestDb, cleanupTestDb, type TestDB } from './helpers.js';
import { WorkspaceEventBus } from '../events/event-bus.js';
import { EventProcessor, type PatternRule, type BurstConfig, type SequenceConfig, type AbsenceConfig } from '../streaming/event-processor.js';
import { PredictiveHealthMonitor, type ServiceSignal } from '../streaming/predictive-health.js';
import { HierarchicalMemory } from '../streaming/hierarchical-memory.js';
import { KnowledgeDistiller } from '../streaming/knowledge-distiller.js';

// WS-C tests for v3 "Beast Mode" streaming subsystems (shipped with ZERO tests).
// Assertions pin CURRENT behavior with concrete computed values; NOTE markers
// flag follow-up hardening owned by other workstreams (WS-G observability/CEP).

// EventProcessor — Complex Event Processing FSM
describe('EventProcessor (CEP) — burst / sequence / absence pattern matching', function () {
  this.timeout(10000);

  let bus: WorkspaceEventBus;
  let processor: EventProcessor;

  beforeEach(() => {
    bus = new WorkspaceEventBus();
    processor = new EventProcessor(bus);
  });

  function burstRule(threshold: number, windowMs: number): PatternRule {
    const config: BurstConfig = { eventType: 'error', threshold, windowMs };
    return { id: 'r-burst', name: 'Error burst', type: 'burst', config, action: 'alert', enabled: true };
  }

  it('BURST fires ONLY when the count threshold is reached within the window', () => {
    processor.addRule(burstRule(3, 1000));

    // Two events at t=0 and t=100 — below threshold of 3, no match.
    assert.deepStrictEqual(processor.processEvent('error', 0), []);
    assert.deepStrictEqual(processor.processEvent('error', 100), []);

    // Third event at t=200 — within the 1000ms window, threshold met.
    const matched = processor.processEvent('error', 200);
    assert.strictEqual(matched.length, 1, 'burst should fire on the 3rd in-window event');
    assert.strictEqual(matched[0].type, 'burst');
    assert.strictEqual(matched[0].ruleId, 'r-burst');
    assert.strictEqual(matched[0].matchedAt, 200);
    // Evidence carries the in-window count and the configured window.
    assert.strictEqual(matched[0].evidence.count, 3);
    assert.strictEqual(matched[0].evidence.windowMs, 1000);
  });

  it('BURST does NOT fire when events are spread beyond the window', () => {
    processor.addRule(burstRule(3, 1000));

    // Events at 0, 2000, 4000 — each ages out the previous; never 3 in 1000ms.
    assert.deepStrictEqual(processor.processEvent('error', 0), []);
    assert.deepStrictEqual(processor.processEvent('error', 2000), []);
    const matched = processor.processEvent('error', 4000);
    assert.deepStrictEqual(matched, [], 'stale events outside the window must not count');
  });

  it('BURST is scoped to its configured eventType (unrelated events do not count)', () => {
    processor.addRule(burstRule(2, 1000));

    processor.processEvent('error', 0);
    // A different event type should not advance the error burst counter.
    const onOther = processor.processEvent('warning', 10);
    assert.deepStrictEqual(onOther, [], 'foreign event type does not trigger error burst');

    const matched = processor.processEvent('error', 20);
    assert.strictEqual(matched.length, 1, 'second matching-type event reaches threshold 2');
    assert.strictEqual(matched[0].evidence.count, 2);
  });

  it('SEQUENCE fires ONLY when events arrive in the configured order', () => {
    const config: SequenceConfig = { events: ['login', 'access', 'export'], maxGapMs: 1000 };
    processor.addRule({
      id: 'r-seq', name: 'Exfiltration', type: 'sequence', config, action: 'alert', enabled: true,
    });

    assert.deepStrictEqual(processor.processEvent('login', 0), [], 'step 1 — no match yet');
    assert.deepStrictEqual(processor.processEvent('access', 100), [], 'step 2 — no match yet');
    const matched = processor.processEvent('export', 200);
    assert.strictEqual(matched.length, 1, 'completing the ordered sequence fires the rule');
    assert.strictEqual(matched[0].type, 'sequence');
    assert.deepStrictEqual(matched[0].evidence.completedSequence, ['login', 'access', 'export']);
  });

  it('SEQUENCE does not fire on out-of-order events', () => {
    const config: SequenceConfig = { events: ['login', 'access', 'export'], maxGapMs: 1000 };
    processor.addRule({
      id: 'r-seq', name: 'Exfiltration', type: 'sequence', config, action: 'alert', enabled: true,
    });

    // 'access' before 'login' — buffer never advances past index 0.
    assert.deepStrictEqual(processor.processEvent('access', 0), []);
    assert.deepStrictEqual(processor.processEvent('export', 100), []);
    // Even a later 'login' alone is only step 1, no completion.
    assert.deepStrictEqual(processor.processEvent('login', 200), []);
  });

  it('SEQUENCE resets/aborts the partial buffer when the gap exceeds maxGapMs', () => {
    const config: SequenceConfig = { events: ['a', 'b'], maxGapMs: 100 };
    processor.addRule({
      id: 'r-gap', name: 'Gap', type: 'sequence', config, action: 'alert', enabled: true,
    });

    processor.processEvent('a', 0);
    // 'b' arrives 500ms later — exceeds the 100ms maxGap, so the step is rejected.
    const tooLate = processor.processEvent('b', 500);
    assert.deepStrictEqual(tooLate, [], 'a step beyond maxGapMs does not complete the sequence');

    // Restart cleanly within the gap: a -> b within 100ms completes.
    processor.processEvent('a', 600);
    const completed = processor.processEvent('b', 650);
    assert.strictEqual(completed.length, 1, 'an in-gap restart completes the sequence');
  });

  it('ABSENCE fires only after the expected window has elapsed since the last sighting', () => {
    const config: AbsenceConfig = { eventType: 'heartbeat', expectedWithinMs: 1000 };
    processor.addRule({
      id: 'r-abs', name: 'Missing heartbeat', type: 'absence', config, action: 'alert', enabled: true,
    });

    // Establish a last-seen for heartbeat at t=1000 (this same call evaluates
    // absence: gap is 0, so no match yet).
    assert.deepStrictEqual(processor.processEvent('heartbeat', 1000), []);

    // A different event at t=1500: gap since heartbeat is 500ms <= 1000ms — still ok.
    assert.deepStrictEqual(processor.processEvent('tick', 1500), []);

    // A different event at t=2500: gap since heartbeat is 1500ms > 1000ms — absence fires.
    const matched = processor.processEvent('tick', 2500);
    assert.strictEqual(matched.length, 1, 'absence fires once the heartbeat gap exceeds the window');
    assert.strictEqual(matched[0].type, 'absence');
    assert.strictEqual(matched[0].evidence.eventType, 'heartbeat');
    assert.strictEqual(matched[0].evidence.lastSeenAt, 1000);
    assert.strictEqual(matched[0].evidence.gapMs, 1500);
  });

  // NOTE (WS-G): evidence.gapMs is computed as `lastSeenTs ? ts - lastSeenTs : null`,
  // so a genuine lastSeen timestamp of exactly 0 is falsy and reports gapMs=null even
  // though the absence DID fire. Documenting the current (slightly buggy) contract.
  it('ABSENCE with a lastSeen of exactly 0 reports gapMs=null (falsy-zero quirk)', () => {
    const config: AbsenceConfig = { eventType: 'heartbeat', expectedWithinMs: 1000 };
    processor.addRule({
      id: 'r-abs0', name: 'Missing heartbeat', type: 'absence', config, action: 'alert', enabled: true,
    });

    processor.processEvent('heartbeat', 0); // lastSeen('heartbeat') = 0 (falsy)
    const matched = processor.processEvent('tick', 1500);
    assert.strictEqual(matched.length, 1, 'absence still fires (gap 1500 > 1000)');
    assert.strictEqual(matched[0].evidence.lastSeenAt, 0, 'lastSeenAt is the literal 0');
    assert.strictEqual(matched[0].evidence.gapMs, null, 'falsy-0 short-circuits gapMs to null');
  });

  it('ABSENCE never fires for an event type that was never seen', () => {
    const config: AbsenceConfig = { eventType: 'never', expectedWithinMs: 100 };
    processor.addRule({
      id: 'r-abs2', name: 'Never seen', type: 'absence', config, action: 'alert', enabled: true,
    });
    // checkAbsence returns false when lastSeen is undefined.
    assert.deepStrictEqual(processor.processEvent('other', 99999), []);
  });

  it('disabled rules are skipped; getMatches accumulates and is filterable by time', () => {
    processor.addRule({ ...burstRule(1, 1000), id: 'r-off', enabled: false });
    assert.deepStrictEqual(processor.processEvent('error', 0), [], 'disabled rule does not match');

    processor.addRule(burstRule(1, 1000)); // threshold 1 => fires on every error
    processor.processEvent('error', 1000);
    processor.processEvent('error', 2000);

    assert.strictEqual(processor.getMatches().length, 2, 'two live matches recorded');
    assert.strictEqual(processor.getMatches(1500).length, 1, 'since-filter returns only later match');
    assert.strictEqual(processor.getActiveRules().length, 2, 'both rules remain registered');
  });

  it('removeRule unregisters a rule so it stops matching', () => {
    processor.addRule(burstRule(1, 1000));
    assert.strictEqual(processor.processEvent('error', 0).length, 1);
    processor.removeRule('r-burst');
    assert.strictEqual(processor.getActiveRules().length, 0);
    assert.deepStrictEqual(processor.processEvent('error', 10), [], 'removed rule no longer fires');
  });

  // NOTE (WS-G): pruneWindows is not auto-scheduled and partial sequence buffers
  // never expire on their own (reset only on a fresh first-event or gap violation).
  it('pruneWindows manually drops timestamps older than maxAge (manual-only today)', () => {
    processor.addRule(burstRule(5, 60000));
    const now = Date.now();
    processor.processEvent('error', now - 10);
    processor.processEvent('error', now - 5);
    processor.pruneWindows(0); // cutoff = now: drops both prior timestamps
    // Window emptied: a fresh single event restarts the count at 1 (< 5), no burst.
    assert.deepStrictEqual(processor.processEvent('error', Date.now() + 1), []);
  });
});

// PredictiveHealthMonitor — EWMA smoothing + state transitions
describe('PredictiveHealthMonitor — EWMA smoothing and health-state transitions', function () {
  this.timeout(10000);

  let bus: WorkspaceEventBus;
  let monitor: PredictiveHealthMonitor;

  beforeEach(() => {
    bus = new WorkspaceEventBus();
    monitor = new PredictiveHealthMonitor(bus);
  });

  function sig(latencyMs: number, isError: boolean, timestamp: number): ServiceSignal {
    return { service: 'svc', latencyMs, isError, timestamp };
  }

  it('a healthy constant-latency, error-free series predicts "healthy"', () => {
    // Constant latency => zero slope; zero errors => ewmaErrorRate stays 0.
    for (let i = 0; i < 10; i++) monitor.recordSignal(sig(50, false, i));

    const p = monitor.predict('svc');
    assert.ok(p, 'prediction should exist after signals');
    assert.strictEqual(p!.currentState, 'healthy');
    assert.strictEqual(p!.predictedState, 'healthy');
    assert.strictEqual(p!.trend, 0, 'constant latency => zero slope');
    assert.strictEqual(p!.recommendation, 'No action needed');
  });

  it('EWMA error rate matches a hand-computed series (alpha = 0.2)', () => {
    // alpha=0.2, error each step, ewmaErrorRate starts at 0:
    // s1: 0.2 -> degrading (>=0.1); s2: 0.36; s3: 0.488 (still < 0.5).
    monitor.recordSignal(sig(50, true, 0));
    monitor.recordSignal(sig(50, true, 1));
    monitor.recordSignal(sig(50, true, 2));

    const p3 = monitor.predict('svc');
    assert.ok(p3);
    // Trend is 0 (constant latency); errorRate 0.488 lands in the 'degrading' band.
    assert.strictEqual(p3!.trend, 0);
    assert.strictEqual(p3!.currentState, 'degrading', 'ewmaErrorRate 0.488 => degrading');

    // s4: 0.2 + 0.8*0.488 = 0.5904 -> crosses the 0.5 'failing' threshold.
    monitor.recordSignal(sig(50, true, 3));
    const p4 = monitor.predict('svc');
    assert.ok(p4);
    assert.strictEqual(p4!.currentState, 'failing', 'ewmaErrorRate 0.5904 (>=0.5) => failing');
    assert.strictEqual(p4!.recommendation, 'Pause queue', 'failing state recommends pausing the queue');
  });

  it('emits health.degradation exactly when EWMA error rate crosses 0.5', () => {
    const emitted: Array<Record<string, unknown>> = [];
    bus.on('health.degradation' as any, (e: any) => emitted.push(e.payload));

    // Three errors: ewmaErrorRate climbs 0.2 -> 0.36 -> 0.488, never > 0.5: no emit.
    monitor.recordSignal(sig(50, true, 0));
    monitor.recordSignal(sig(50, true, 1));
    monitor.recordSignal(sig(50, true, 2));
    assert.strictEqual(emitted.length, 0, 'no emit while ewmaErrorRate <= 0.5');

    // Fourth error pushes it to 0.5904 (> 0.5) => one emit fires.
    monitor.recordSignal(sig(50, true, 3));
    assert.strictEqual(emitted.length, 1, 'crossing 0.5 emits one degradation event');
    assert.strictEqual(emitted[0].service, 'svc');
    assert.ok((emitted[0].errorRate as number) > 0.5, 'payload carries the elevated error rate');
  });

  it('a rising latency trend (slope >= 2) drives the "failing" state', () => {
    // Latency increases by 10 each step (slope = 10 >= 2.0) with no errors.
    for (let i = 0; i < 10; i++) monitor.recordSignal(sig(100 + i * 10, false, i));

    const p = monitor.predict('svc');
    assert.ok(p);
    assert.ok(p!.trend >= 2.0, `expected steep positive slope, got ${p!.trend}`);
    assert.strictEqual(p!.currentState, 'failing', 'steep latency slope => failing');
  });

  it('predict returns null for an unknown service; reset clears recorded data', () => {
    assert.strictEqual(monitor.predict('ghost'), null, 'no data => null prediction');

    monitor.recordSignal(sig(50, false, 0));
    assert.deepStrictEqual(monitor.getServiceNames(), ['svc']);
    assert.ok(monitor.predict('svc'));

    monitor.reset('svc');
    assert.deepStrictEqual(monitor.getServiceNames(), [], 'reset removes the service');
    assert.strictEqual(monitor.predict('svc'), null, 'reset clears prediction state');
  });
});

// HierarchicalMemory — 4-level compaction, budget selection, retention pruning
describe('HierarchicalMemory — 4-level compaction, budget selection, pruning', function () {
  this.timeout(10000);

  let testDb: TestDB;
  let memory: HierarchicalMemory;

  beforeEach(() => {
    testDb = createTestDb('hierarchical-memory');
    memory = new HierarchicalMemory(testDb.db);
  });

  afterEach(() => {
    cleanupTestDb(testDb);
  });

  it('exposes the four configured tiers with descending token budgets', () => {
    assert.strictEqual(memory.getLevelConfig(0).label, 'raw');
    assert.strictEqual(memory.getLevelConfig(0).maxTokens, Infinity);
    assert.strictEqual(memory.getLevelConfig(1).label, 'hourly');
    assert.strictEqual(memory.getLevelConfig(1).maxTokens, 500);
    assert.strictEqual(memory.getLevelConfig(2).label, 'daily');
    assert.strictEqual(memory.getLevelConfig(2).maxTokens, 200);
    assert.strictEqual(memory.getLevelConfig(3).label, 'weekly');
    assert.strictEqual(memory.getLevelConfig(3).maxTokens, 100);
  });

  it('compaction truncates content to the tier token budget (maxTokens*4 chars)', () => {
    // Level 1 budget = 500 tokens => 2000 chars. Feed 3000 chars.
    const big = 'x'.repeat(3000);
    const summary = memory.compact('a1', 1, 0, 3600000, big);

    assert.strictEqual(summary.summary.length, 2000, 'truncated to 500 tokens * 4 chars');
    assert.strictEqual(summary.tokenCount, 500, 'token count = ceil(2000/4)');
    assert.strictEqual(summary.level, 1);
    assert.strictEqual(summary.agentId, 'a1');
    assert.ok(summary.id > 0, 'persisted row gets an id');
  });

  it('short content is stored verbatim with a ceil-based token estimate', () => {
    const summary = memory.compact('a1', 0, 0, 10, 'hello'); // 5 chars
    assert.strictEqual(summary.summary, 'hello', 'level 0 (raw) keeps content intact');
    assert.strictEqual(summary.tokenCount, 2, 'ceil(5/4) = 2 tokens');
  });

  it('getSummaries filters by agent and level and orders by period_start DESC', () => {
    memory.compact('a1', 1, 1000, 2000, 'first');
    memory.compact('a1', 1, 3000, 4000, 'second');
    memory.compact('a1', 2, 5000, 6000, 'daily-roll');
    memory.compact('a2', 1, 7000, 8000, 'other-agent');

    const allForA1 = memory.getSummaries('a1');
    assert.strictEqual(allForA1.length, 3, 'three summaries belong to a1');

    const level1 = memory.getSummaries('a1', 1);
    assert.strictEqual(level1.length, 2, 'two level-1 summaries for a1');
    assert.deepStrictEqual(
      level1.map((s) => s.summary),
      ['second', 'first'],
      'newest period_start first',
    );

    const since = memory.getSummaries('a1', 1, 2500);
    assert.deepStrictEqual(since.map((s) => s.summary), ['second'], 'since filter on period_start');
  });

  it('getLatestAtLevel returns the most recent summary by period_end', () => {
    memory.compact('a1', 3, 0, 100, 'older-weekly');
    memory.compact('a1', 3, 200, 300, 'newer-weekly');
    const latest = memory.getLatestAtLevel('a1', 3);
    assert.ok(latest);
    assert.strictEqual(latest!.summary, 'newer-weekly');
    assert.strictEqual(memory.getLatestAtLevel('nobody', 3), null, 'no rows => null');
  });

  it('getContextBudget promotes higher tiers first and stops at the token budget', () => {
    // Higher level == more compressed/important. Budget selection walks 3->0.
    memory.compact('a1', 3, 0, 100, 'AB');      // 2 chars => ceil(2/4)=1 token (weekly)
    memory.compact('a1', 0, 0, 100, 'x'.repeat(40)); // 40 chars => 10 tokens (raw)

    // Budget of 5 tokens: the weekly (1 token) fits; the raw (10 tokens) does not.
    const selected = memory.getContextBudget('a1', 5);
    assert.strictEqual(selected.length, 1, 'only the small high-tier summary fits the budget');
    assert.strictEqual(selected[0].level, 3, 'weekly tier selected first');

    // With a generous budget both fit; weekly still comes first (level 3 walked first).
    const all = memory.getContextBudget('a1', 1000);
    assert.strictEqual(all.length, 2);
    assert.strictEqual(all[0].level, 3, 'higher tier prioritized in the budget order');
    assert.strictEqual(all[1].level, 0);
  });

  it('pruneExpired removes level 0-2 rows past retention and keeps fresh ones', () => {
    const now = Date.now();
    // Level 0 retention is 7 days. A period_end 30 days ago is expired.
    memory.compact('a1', 0, now - 31 * 86400000, now - 30 * 86400000, 'stale-raw');
    // A fresh level-0 row within retention survives.
    memory.compact('a1', 0, now - 1000, now, 'fresh-raw');
    // Level 3 (weekly) has Infinity retention — never pruned and never scanned.
    memory.compact('a1', 3, 0, 100, 'eternal-weekly');

    const pruned = memory.pruneExpired('a1');
    assert.strictEqual(pruned, 1, 'exactly the stale level-0 row is deleted');

    const remaining = memory.getSummaries('a1');
    const summaries = remaining.map((s) => s.summary).sort();
    assert.deepStrictEqual(summaries, ['eternal-weekly', 'fresh-raw']);
  });
});

// KnowledgeDistiller — query clustering + corridor summarization/ranking
describe('KnowledgeDistiller — clustering, corridor distillation and ranking', function () {
  this.timeout(10000);

  let testDb: TestDB;
  let distiller: KnowledgeDistiller;

  beforeEach(() => {
    testDb = createTestDb('knowledge-distiller');
    distiller = new KnowledgeDistiller(testDb.db);
  });

  afterEach(() => {
    cleanupTestDb(testDb);
  });

  it('distill on an empty buffer is a no-op', () => {
    assert.strictEqual(distiller.getBufferSize(), 0);
    const result = distiller.distill();
    assert.deepStrictEqual(result, { corridorsFound: 0, newDistillations: 0, updatedDistillations: 0 });
    assert.deepStrictEqual(distiller.getAllCorridors(), []);
  });

  it('clusters >= 3 similar queries into one corridor with a top-words id', () => {
    distiller.recordQuery('database query optimization');
    distiller.recordQuery('database query optimization');
    distiller.recordQuery('database query optimization');
    assert.strictEqual(distiller.getBufferSize(), 3, 'buffer accumulates until distill');

    const result = distiller.distill();
    assert.strictEqual(result.corridorsFound, 1, 'one cluster reached the >= 3 threshold');
    assert.strictEqual(result.newDistillations, 1, 'a fresh corridor was created');
    assert.strictEqual(result.updatedDistillations, 0);
    assert.strictEqual(distiller.getBufferSize(), 0, 'buffer is drained after distill');

    const corridor = distiller.getCorridor('database-query-optimization');
    assert.ok(corridor, 'corridor keyed on the joined top-3 words');
    assert.strictEqual(corridor!.accessCount, 1);
    assert.deepStrictEqual(corridor!.queryCluster.length, 3, 'all three queries retained');
    assert.ok(
      corridor!.summary.startsWith('Knowledge corridor accessed via:'),
      'summary is the human-readable corridor description',
    );
  });

  it('a cluster with fewer than 3 queries is NOT distilled', () => {
    distiller.recordQuery('rare lonely query topic');
    distiller.recordQuery('rare lonely query topic');
    const result = distiller.distill();
    assert.strictEqual(result.corridorsFound, 0, 'two queries is below the min-cluster size');
    assert.strictEqual(result.newDistillations, 0);
    assert.deepStrictEqual(distiller.getAllCorridors(), []);
  });

  it('re-distilling the same corridor increments access_count (update path)', () => {
    const seed = () => {
      distiller.recordQuery('vector embedding search');
      distiller.recordQuery('vector embedding search');
      distiller.recordQuery('vector embedding search');
      return distiller.distill();
    };

    const first = seed();
    assert.strictEqual(first.newDistillations, 1);
    assert.strictEqual(first.updatedDistillations, 0);

    const second = seed();
    assert.strictEqual(second.newDistillations, 0, 'corridor already exists');
    assert.strictEqual(second.updatedDistillations, 1, 'existing corridor updated');

    const corridor = distiller.getCorridor('vector-embedding-search');
    assert.ok(corridor);
    assert.strictEqual(corridor!.accessCount, 2, 'access_count incremented on the second distill');
    assert.ok(corridor!.updatedAt >= corridor!.createdAt, 'updatedAt advances');
  });

  it('getTopCorridors ranks by access_count DESC and respects the limit', () => {
    // Corridor "alpha": distilled twice => access_count 2.
    for (let pass = 0; pass < 2; pass++) {
      distiller.recordQuery('alpha alpha alpha');
      distiller.recordQuery('alpha alpha alpha');
      distiller.recordQuery('alpha alpha alpha');
      distiller.distill();
    }
    // Corridor "beta": distilled once => access_count 1.
    distiller.recordQuery('beta beta beta');
    distiller.recordQuery('beta beta beta');
    distiller.recordQuery('beta beta beta');
    distiller.distill();

    const all = distiller.getAllCorridors();
    assert.strictEqual(all.length, 2, 'two distinct corridors exist');
    assert.strictEqual(all[0].corridor, 'alpha', 'highest access_count ranked first');
    assert.strictEqual(all[0].accessCount, 2);
    assert.strictEqual(all[1].corridor, 'beta');
    assert.strictEqual(all[1].accessCount, 1);

    const topOne = distiller.getTopCorridors(1);
    assert.strictEqual(topOne.length, 1, 'limit honored');
    assert.strictEqual(topOne[0].corridor, 'alpha', 'top corridor is the most-accessed');
  });

  it('getCorridor returns null for an unknown corridor key', () => {
    assert.strictEqual(distiller.getCorridor('does-not-exist'), null);
  });
});
