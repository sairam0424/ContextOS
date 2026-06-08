import assert from 'node:assert';
import { createTestDb, cleanupTestDb, type TestDB } from './helpers.js';
import { WorkspaceEventBus } from '../events/event-bus.js';
import { TrustEngine, type TrustDimension } from '../governance/trust-engine.js';
import { CapabilityTokenService } from '../governance/capability-token.js';
import { PolicyEngine } from '../governance/policy-engine.js';
import { AnomalyDetector } from '../governance/anomaly-detection.js';

/**
 * Workstream C — governance subsystem tests (TrustEngine, CapabilityTokenService,
 * PolicyEngine, AnomalyDetector). These assert CURRENT v3 behavior so WS-D
 * (security hardening) can intentionally invert specific assertions. Each such
 * assertion is tagged with a `WS-D INVERSION` comment.
 */

const ALPHA = 0.1; // TrustEngine EMA smoothing factor (private readonly alpha)
const TOLERANCE = 1e-9;

/** Expected EMA step: newValue = oldValue * (1 - alpha) + target * alpha. */
function emaStep(oldValue: number, target: number): number {
  return oldValue * (1 - ALPHA) + target * ALPHA;
}

describe('Governance', function () {
  this.timeout(10000);

  describe('TrustEngine', () => {
    let testDb: TestDB;
    let bus: WorkspaceEventBus;
    let engine: TrustEngine;

    beforeEach(() => {
      testDb = createTestDb('trust-engine');
      bus = new WorkspaceEventBus();
      engine = new TrustEngine(testDb.db, bus);
    });
    afterEach(() => cleanupTestDb(testDb));

    it('seeds a new agent with all dimensions at 0.5 and overall 0.5', () => {
      const s = engine.getScore('agent-seed');
      assert.strictEqual(s.overall, 0.5);
      assert.strictEqual(s.reliability, 0.5);
      assert.strictEqual(s.timeliness, 0.5);
      assert.strictEqual(s.accuracy, 0.5);
      assert.strictEqual(s.compliance, 0.5);
      assert.strictEqual(s.resourceEfficiency, 0.5);
    });

    it('applies the EMA step exactly for a single success event (target 1.0)', () => {
      assert.strictEqual(emaStep(0.5, 1.0), 0.55); // 0.5*0.9 + 1.0*0.1
      const s = engine.recordEvent({ agentId: 'a', eventType: 'success', dimension: 'reliability', reason: 'ok' });
      assert.ok(Math.abs(s.reliability - 0.55) < TOLERANCE);
      assert.strictEqual(s.timeliness, 0.5); // only targeted dimension moves
      assert.strictEqual(s.accuracy, 0.5);
      // overall = mean(0.55,0.5,0.5,0.5,0.5) = 2.55/5 = 0.51
      assert.ok(Math.abs(s.overall - 0.51) < TOLERANCE);
    });

    it('applies the EMA step exactly for a single failure event (target 0.0)', () => {
      assert.strictEqual(emaStep(0.5, 0.0), 0.45); // 0.5*0.9 + 0.0*0.1
      const s = engine.recordEvent({ agentId: 'f', eventType: 'failure', dimension: 'accuracy', reason: 'bad' });
      assert.ok(Math.abs(s.accuracy - 0.45) < TOLERANCE);
      // overall = (0.5+0.5+0.45+0.5+0.5)/5 = 2.45/5 = 0.49
      assert.ok(Math.abs(s.overall - 0.49) < TOLERANCE);
    });

    it('uses target 0.3 for timeout events', () => {
      assert.ok(Math.abs(emaStep(0.5, 0.3) - 0.48) < TOLERANCE); // 0.45 + 0.03
      const s = engine.recordEvent({ agentId: 't', eventType: 'timeout', dimension: 'timeliness', reason: 'slow' });
      assert.ok(Math.abs(s.timeliness - 0.48) < TOLERANCE);
    });

    it('compounds EMA correctly across a sequence of three success events', () => {
      // 0.5 -> 0.55 -> 0.595 -> 0.6355
      let expected = 0.5;
      for (let i = 0; i < 3; i++) expected = emaStep(expected, 1.0);
      let last = 0.5;
      for (let i = 0; i < 3; i++) {
        last = engine.recordEvent({ agentId: 'seq', eventType: 'success', dimension: 'compliance', reason: `ok${i}` }).compliance;
      }
      assert.ok(Math.abs(last - expected) < TOLERANCE, `expected ${expected}, got ${last}`);
      assert.ok(Math.abs(last - 0.6355) < TOLERANCE);
    });

    it('maps the resourceEfficiency dimension to the resource_efficiency column', () => {
      // Exercises DIMENSION_COLUMN_MAP camelCase -> snake_case mapping.
      const dimension: TrustDimension = 'resourceEfficiency';
      const s = engine.recordEvent({ agentId: 're', eventType: 'success', dimension, reason: 'eff' });
      assert.ok(Math.abs(s.resourceEfficiency - 0.55) < TOLERANCE);
      assert.strictEqual(s.reliability, 0.5);
      assert.strictEqual(s.compliance, 0.5);
      // re-read confirms the mapped column persisted
      assert.ok(Math.abs(engine.getScore('re').resourceEfficiency - 0.55) < TOLERANCE);
    });

    it('records a trust event row with the computed delta', () => {
      engine.recordEvent({ agentId: 'h', eventType: 'success', dimension: 'reliability', reason: 'first' });
      const history = engine.getHistory('h');
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].eventType, 'success');
      assert.strictEqual(history[0].dimension, 'reliability');
      assert.ok(Math.abs(history[0].delta - 0.05) < TOLERANCE); // 0.55 - 0.5
    });

    it('triggers quarantine event when overall drops below 0.3', () => {
      // Each dimension after n failures = 0.5*0.9^n; overall = 0.5*0.9^n.
      // 0.9^5 = 0.59049 -> overall = 0.295245 < 0.3 triggers quarantine.
      const dims: TrustDimension[] = ['reliability', 'timeliness', 'accuracy', 'compliance', 'resourceEfficiency'];
      const quarantined: string[] = [];
      bus.on('agent.quarantined' as any, (e: any) => quarantined.push(e.agentId));

      let lastOverall = 0.5;
      for (let r = 0; r < 5; r++) {
        for (const dimension of dims) {
          lastOverall = engine.recordEvent({ agentId: 'bad', eventType: 'failure', dimension, reason: 'fail' }).overall;
        }
      }
      const expected = 0.5 * Math.pow(0.9, 5);
      assert.ok(Math.abs(lastOverall - expected) < 1e-6, `overall ${lastOverall} vs ${expected}`);
      assert.ok(lastOverall < 0.3);
      assert.ok(quarantined.includes('bad'));
    });

    it('does NOT trigger quarantine while overall stays at or above 0.3', () => {
      const quarantined: string[] = [];
      bus.on('agent.quarantined' as any, (e: any) => quarantined.push(e.agentId));
      // single failure -> overall 0.49, above threshold
      const s = engine.recordEvent({ agentId: 'okay', eventType: 'failure', dimension: 'accuracy', reason: 'one' });
      assert.ok(s.overall >= 0.3);
      assert.strictEqual(quarantined.length, 0);
    });

    it('resetScore restores all dimensions to 0.5', () => {
      engine.recordEvent({ agentId: 'rst', eventType: 'failure', dimension: 'reliability', reason: 'x' });
      engine.resetScore('rst');
      const s = engine.getScore('rst');
      assert.strictEqual(s.overall, 0.5);
      assert.strictEqual(s.reliability, 0.5);
    });
  });

  describe('CapabilityTokenService', () => {
    let testDb: TestDB;
    let bus: WorkspaceEventBus;
    let service: CapabilityTokenService;

    beforeEach(() => {
      testDb = createTestDb('capability-token');
      bus = new WorkspaceEventBus();
      service = new CapabilityTokenService(testDb.db, bus);
    });
    afterEach(() => cleanupTestDb(testDb));

    it('issues a token and authorizes a granted resource/action', () => {
      const token = service.issue({ agentId: 'a1', capabilities: [{ resource: 'docs:readme', actions: ['read', 'write'] }], issuedBy: 'root' });
      assert.ok(token.id);
      assert.strictEqual(token.revoked, false);
      const r = service.authorize('a1', 'docs:readme', 'read');
      assert.strictEqual(r.authorized, true);
      assert.strictEqual(r.tokenId, token.id);
    });

    it('denies an action that is not granted on a matching resource', () => {
      service.issue({ agentId: 'a2', capabilities: [{ resource: 'docs:readme', actions: ['read'] }], issuedBy: 'root' });
      const r = service.authorize('a2', 'docs:readme', 'write');
      assert.strictEqual(r.authorized, false);
      assert.ok(r.reason && r.reason.includes('write'));
    });

    it('denies a resource that no token grants', () => {
      service.issue({ agentId: 'a3', capabilities: [{ resource: 'docs:readme', actions: ['read'] }], issuedBy: 'root' });
      assert.strictEqual(service.authorize('a3', 'secrets:db', 'read').authorized, false);
    });

    it('matches wildcard resource patterns (prefix:* and *)', () => {
      service.issue({ agentId: 'w', capabilities: [{ resource: 'docs:*', actions: ['read'] }], issuedBy: 'root' });
      assert.strictEqual(service.authorize('w', 'docs:guide', 'read').authorized, true); // prefix match
      assert.strictEqual(service.authorize('w', 'code:guide', 'read').authorized, false); // different prefix
      service.issue({ agentId: 's', capabilities: [{ resource: '*', actions: ['execute'] }], issuedBy: 'root' });
      assert.strictEqual(service.authorize('s', 'anything:here', 'execute').authorized, true);
    });

    it('denies an expired token', () => {
      // ttlMs negative -> expiresAt < now
      service.issue({ agentId: 'exp', capabilities: [{ resource: 'docs:readme', actions: ['read'] }], issuedBy: 'root', ttlMs: -1000 });
      assert.strictEqual(service.authorize('exp', 'docs:readme', 'read').authorized, false);
    });

    it('denies after a token is revoked', () => {
      const token = service.issue({ agentId: 'rev', capabilities: [{ resource: 'docs:readme', actions: ['read'] }], issuedBy: 'root' });
      assert.strictEqual(service.authorize('rev', 'docs:readme', 'read').authorized, true);
      service.revoke(token.id);
      assert.strictEqual(service.authorize('rev', 'docs:readme', 'read').authorized, false);
    });

    it('allows a child token within maxDelegationDepth, rejects beyond it at issue()', () => {
      const parent = service.issue({ agentId: 'p', capabilities: [{ resource: 'docs:readme', actions: ['read', 'delegate'] }], issuedBy: 'root', maxDelegationDepth: 1 });
      // child: currentDepth(parent)=0 < parent.maxDelegationDepth 1 -> allowed
      const child = service.issue({ agentId: 'c', capabilities: [{ resource: 'docs:readme', actions: ['read'] }], issuedBy: 'p', parentTokenId: parent.id, maxDelegationDepth: 1 });
      assert.strictEqual(child.parentTokenId, parent.id);
      // grandchild: currentDepth(child)=1 >= child.maxDelegationDepth 1 -> reject
      assert.throws(
        () => service.issue({ agentId: 'g', capabilities: [{ resource: 'docs:readme', actions: ['read'] }], issuedBy: 'c', parentTokenId: child.id }),
        /maximum delegation depth/,
      );
    });

    it('rejects issuing a child token whose parent does not exist', () => {
      assert.throws(
        () => service.issue({ agentId: 'o', capabilities: [{ resource: 'docs:readme', actions: ['read'] }], issuedBy: 'root', parentTokenId: 'nope' }),
        /does not exist/,
      );
    });

    it('rejects issuing a child token under a revoked parent', () => {
      const parent = service.issue({ agentId: 'rp', capabilities: [{ resource: 'docs:readme', actions: ['delegate'] }], issuedBy: 'root', maxDelegationDepth: 2 });
      service.revoke(parent.id);
      assert.throws(
        () => service.issue({ agentId: 'c2', capabilities: [{ resource: 'docs:readme', actions: ['read'] }], issuedBy: 'rp', parentTokenId: parent.id }),
        /revoked/,
      );
    });

    // WS-D INVERSION: authorize() currently trusts whatever capabilities JSON is in
    // the DB row — no signature/HMAC verification. WS-D adds HMAC verification, after
    // which a forged/unsigned row will be DENIED instead of authorized.
    it('authorizes from an unsigned/forged DB row (no integrity check today)', () => {
      const now = Date.now();
      testDb.db.prepare(
        `INSERT INTO capability_tokens (id, agent_id, capabilities, issued_by, issued_at, expires_at, revoked, parent_token_id, max_delegation_depth)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0)`,
      ).run('forged', 'fk', JSON.stringify([{ resource: 'secrets:db', actions: ['write'] }]), 'attacker', now, now + 3_600_000);
      const r = service.authorize('fk', 'secrets:db', 'write');
      assert.strictEqual(r.authorized, true); // WS-D will flip this to false
      assert.strictEqual(r.tokenId, 'forged');
    });
  });

  describe('PolicyEngine', () => {
    let testDb: TestDB;
    let bus: WorkspaceEventBus;
    let trust: TrustEngine;
    let engine: PolicyEngine;

    beforeEach(() => {
      testDb = createTestDb('policy-engine');
      bus = new WorkspaceEventBus();
      trust = new TrustEngine(testDb.db, bus);
      engine = new PolicyEngine(testDb.db, trust);
    });
    afterEach(() => cleanupTestDb(testDb));

    it('allows when a matching allow rule fires', () => {
      engine.addPolicy({ name: 'allow-read', rules: [{ condition: { type: 'action_type', action: 'read' }, effect: 'allow' }] });
      const d = engine.evaluate('x', 'docs:readme', 'read');
      assert.strictEqual(d.allowed, true);
      assert.strictEqual(d.effect, 'allow');
      assert.strictEqual(d.matchedPolicy, 'allow-read');
    });

    it('denies when a matching deny rule fires', () => {
      engine.addPolicy({ name: 'deny-secrets', rules: [{ condition: { type: 'resource_matches', pattern: '^secrets:' }, effect: 'deny' }] });
      const d = engine.evaluate('x', 'secrets:db', 'write');
      assert.strictEqual(d.allowed, false);
      assert.strictEqual(d.effect, 'deny');
      assert.strictEqual(d.matchedPolicy, 'deny-secrets');
    });

    it('returns require_approval (allowed:false) when that rule matches', () => {
      engine.addPolicy({ name: 'approve-exec', rules: [{ condition: { type: 'action_type', action: 'execute' }, effect: 'require_approval' }] });
      const d = engine.evaluate('x', 'job:deploy', 'execute');
      assert.strictEqual(d.effect, 'require_approval');
      assert.strictEqual(d.allowed, false); // allowed true only when effect === 'allow'
    });

    // WS-D INVERSION: with NO matching policy the engine currently DEFAULTS TO ALLOW.
    // WS-D flips this to default-DENY (allowed:false, effect:'deny').
    it('DEFAULTS TO ALLOW when no policy matches (current behavior)', () => {
      const d = engine.evaluate('none', 'anything', 'read');
      assert.strictEqual(d.allowed, true); // WS-D will flip to false
      assert.strictEqual(d.effect, 'allow');
      assert.strictEqual(d.matchedPolicy, null);
      assert.strictEqual(d.reason, 'No policy matched');
    });

    it('honors priority ordering — higher priority policy wins', () => {
      engine.addPolicy({ name: 'low-allow', rules: [{ condition: { type: 'resource_matches', pattern: '.*' }, effect: 'allow' }], priority: 1 });
      engine.addPolicy({ name: 'high-deny', rules: [{ condition: { type: 'resource_matches', pattern: '.*' }, effect: 'deny' }], priority: 10 });
      const d = engine.evaluate('prio', 'docs:x', 'read');
      assert.strictEqual(d.matchedPolicy, 'high-deny');
      assert.strictEqual(d.allowed, false);
    });

    it('evaluates resource_matches via regex test', () => {
      engine.addPolicy({ name: 'deny-tmp', rules: [{ condition: { type: 'resource_matches', pattern: 'tmp' }, effect: 'deny' }] });
      assert.strictEqual(engine.evaluate('a', 'cache:tmp:1', 'read').allowed, false); // substring matches
      assert.strictEqual(engine.evaluate('a', 'cache:perm:1', 'read').allowed, true); // no match -> default allow
    });

    it('evaluates a compound AND condition (both must hold)', () => {
      engine.addPolicy({
        name: 'deny-write-secrets',
        rules: [{
          condition: {
            type: 'compound', operator: 'AND',
            conditions: [{ type: 'resource_matches', pattern: '^secrets:' }, { type: 'action_type', action: 'write' }],
          },
          effect: 'deny',
        }],
      });
      assert.strictEqual(engine.evaluate('a', 'secrets:db', 'write').allowed, false); // both hold -> deny
      assert.strictEqual(engine.evaluate('a', 'secrets:db', 'read').allowed, true); // action differs -> AND fails -> allow
    });

    it('evaluates a trust_below condition against the TrustEngine', () => {
      // fresh agent seeds at overall 0.5
      engine.addPolicy({ name: 'deny-below-0.4', rules: [{ condition: { type: 'trust_below', threshold: 0.4 }, effect: 'deny' }] });
      assert.strictEqual(engine.evaluate('tr', 'r', 'read').allowed, true); // 0.5 not below 0.4
      engine.addPolicy({ name: 'deny-below-0.6', rules: [{ condition: { type: 'trust_below', threshold: 0.6 }, effect: 'deny' }], priority: 5 });
      assert.strictEqual(engine.evaluate('tr', 'r', 'read').allowed, false); // 0.5 < 0.6 -> deny
    });

    it('ignores disabled policies', () => {
      const p = engine.addPolicy({ name: 'deny-all', rules: [{ condition: { type: 'resource_matches', pattern: '.*' }, effect: 'deny' }] });
      assert.strictEqual(engine.evaluate('a', 'x', 'read').allowed, false);
      engine.disablePolicy(p.id);
      assert.strictEqual(engine.evaluate('a', 'x', 'read').allowed, true); // disabled -> default allow
    });
  });

  describe('AnomalyDetector', () => {
    let testDb: TestDB;
    let bus: WorkspaceEventBus;
    let detector: AnomalyDetector;

    beforeEach(() => {
      testDb = createTestDb('anomaly-detector');
      bus = new WorkspaceEventBus();
      detector = new AnomalyDetector(testDb.db, bus);
    });
    afterEach(() => cleanupTestDb(testDb));

    it('returns null when there is no recorded activity', () => {
      assert.strictEqual(detector.detectRateSpike('quiet'), null);
    });

    it('stays quiet (null) for an agent with no activity; per-agent windows are isolated', () => {
      assert.strictEqual(detector.detectRateSpike('other'), null);
      detector.recordAction('someone-else'); // must not leak into 'other'
      assert.strictEqual(detector.detectRateSpike('other'), null);
    });

    it('fires a rate_spike alert when current rate exceeds 3x the baseline', () => {
      const spikes: string[] = [];
      bus.on('governance.anomaly_detected' as any, (e: any) => spikes.push(e.alertId));
      // 10 actions in last minute: currentRate=10, historicalRate=10/60, ratio=60 -> critical (>10)
      for (let i = 0; i < 10; i++) detector.recordAction('busy');
      const alert = detector.detectRateSpike('busy');
      assert.ok(alert);
      assert.strictEqual(alert!.type, 'rate_spike');
      assert.strictEqual(alert!.agentId, 'busy');
      assert.strictEqual(alert!.severity, 'critical');
      assert.strictEqual((alert!.evidence as any).currentRate, 10);
      assert.ok(spikes.includes(alert!.id)); // event bus emitted
      const persisted = detector.getAlerts('busy');
      assert.strictEqual(persisted.length, 1);
      assert.strictEqual(persisted[0].id, alert!.id);
    });

    it('detectAll only returns rate_spike alerts today (other detectors unimplemented)', () => {
      // behavior_drift / unauthorized_access / resource_abuse are not implemented.
      for (let i = 0; i < 8; i++) detector.recordAction('drift');
      const all = detector.detectAll('drift');
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0].type, 'rate_spike');
      const types = new Set(all.map(a => a.type));
      assert.strictEqual(types.has('behavior_drift'), false);
      assert.strictEqual(types.has('unauthorized_access'), false);
      assert.strictEqual(types.has('resource_abuse'), false);
    });

    it('reports the current per-minute rate via getAgentRate', () => {
      assert.strictEqual(detector.getAgentRate('rate'), 0);
      detector.recordAction('rate');
      detector.recordAction('rate');
      detector.recordAction('rate');
      assert.strictEqual(detector.getAgentRate('rate'), 3);
    });

    it('resolveAlert marks an alert resolved', () => {
      for (let i = 0; i < 6; i++) detector.recordAction('res');
      const alert = detector.detectRateSpike('res');
      assert.ok(alert);
      detector.resolveAlert(alert!.id);
      assert.strictEqual(detector.getAlerts('res', false).length, 0);
      const resolved = detector.getAlerts('res', true);
      assert.strictEqual(resolved.length, 1);
      assert.strictEqual(resolved[0].resolved, true);
    });
  });
});
