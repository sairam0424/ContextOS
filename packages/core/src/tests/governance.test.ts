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

  // WS-D: CapabilityTokenService signs/verifies tokens with an HMAC keyed from
  // CONTEXTOS_TOKEN_HMAC_KEY. The service already falls back to a fixed test key
  // under the mocha runner, but we pin an explicit key here so the suite is
  // deterministic regardless of how it is launched (NODE_ENV, direct node, etc.).
  before(() => {
    process.env.CONTEXTOS_TOKEN_HMAC_KEY = 'test-key';
  });

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

    // WS-D INVERSION (now flipped): authorize() previously trusted whatever
    // capabilities JSON was in the DB row — no signature/HMAC verification. WS-D
    // added HMAC verification, so a forged/unsigned row (NULL signature/principal
    // after migration 010) is now DENIED. The denial result carries no tokenId.
    it('DENIES an unsigned/forged DB row (HMAC verification rejects it)', () => {
      const now = Date.now();
      testDb.db.prepare(
        `INSERT INTO capability_tokens (id, agent_id, capabilities, issued_by, issued_at, expires_at, revoked, parent_token_id, max_delegation_depth)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0)`,
      ).run('forged', 'fk', JSON.stringify([{ resource: 'secrets:db', actions: ['write'] }]), 'attacker', now, now + 3_600_000);
      const r = service.authorize('fk', 'secrets:db', 'write');
      assert.strictEqual(r.authorized, false); // WS-D flipped this from true
      assert.strictEqual(r.tokenId, undefined); // denial result has no tokenId
    });

    // WS-D positive test: a token issued through issue() is HMAC-signed, so it
    // verifies and authorizes the happy path. This proves the hardening did not
    // break legitimately-issued tokens.
    it('authorizes a legitimately issued, HMAC-signed token', () => {
      const token = service.issue({ agentId: 'signed', capabilities: [{ resource: 'secrets:db', actions: ['write'] }], issuedBy: 'root' });
      const r = service.authorize('signed', 'secrets:db', 'write');
      assert.strictEqual(r.authorized, true);
      assert.strictEqual(r.tokenId, token.id);
    });

    // WS-D positive test: tampering with a signed row's stored capabilities (e.g.
    // a DB-level privilege escalation) invalidates the HMAC, so the row no longer
    // grants the smuggled-in capability.
    it('rejects a signed token whose capabilities were tampered in the DB', () => {
      const token = service.issue({ agentId: 'tamper', capabilities: [{ resource: 'docs:readme', actions: ['read'] }], issuedBy: 'root' });
      // Sanity: the untampered token authorizes its real grant.
      assert.strictEqual(service.authorize('tamper', 'docs:readme', 'read').authorized, true);
      // Attacker rewrites the capabilities JSON to escalate to secrets:write,
      // leaving the (now-stale) signature in place.
      testDb.db.prepare('UPDATE capability_tokens SET capabilities = ? WHERE id = ?')
        .run(JSON.stringify([{ resource: 'secrets:db', actions: ['write'] }]), token.id);
      const r = service.authorize('tamper', 'secrets:db', 'write');
      assert.strictEqual(r.authorized, false); // HMAC mismatch -> fail closed
      assert.strictEqual(r.tokenId, undefined);
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
      // WS-D: resource_matches now uses anchored glob/prefix matching (no regex,
      // ReDoS-safe). The old '^secrets:' regex pattern no longer matches; use the
      // glob 'secrets:*' so the deny rule fires and matchedPolicy stays 'deny-secrets'.
      engine.addPolicy({ name: 'deny-secrets', rules: [{ condition: { type: 'resource_matches', pattern: 'secrets:*' }, effect: 'deny' }] });
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

    // WS-D INVERSION (now flipped): with NO matching policy the engine now
    // DEFAULTS TO DENY (fail-closed, Cedar/OPA-style). Absence of an explicit
    // allow is a denial.
    it('DEFAULTS TO DENY when no policy matches (fail-closed)', () => {
      const d = engine.evaluate('none', 'anything', 'read');
      assert.strictEqual(d.allowed, false); // WS-D flipped this from true
      assert.strictEqual(d.effect, 'deny');
      assert.strictEqual(d.matchedPolicy, null);
      assert.strictEqual(d.reason, "No policy matched — applying default effect 'deny'");
    });

    // WS-D positive test: an explicit allow policy permits the request that would
    // otherwise be denied by default — proving default-deny does not break
    // explicitly-authorized actions.
    it('an explicit allow policy permits a request that default-deny would block', () => {
      // Baseline: with no policy, the request is denied by default.
      assert.strictEqual(engine.evaluate('exp', 'docs:readme', 'read').allowed, false);
      engine.addPolicy({ name: 'allow-docs', rules: [{ condition: { type: 'resource_matches', pattern: 'docs:*' }, effect: 'allow' }] });
      const d = engine.evaluate('exp', 'docs:readme', 'read');
      assert.strictEqual(d.allowed, true);
      assert.strictEqual(d.effect, 'allow');
      assert.strictEqual(d.matchedPolicy, 'allow-docs');
      // A resource outside the explicit allow still falls through to default-deny.
      assert.strictEqual(engine.evaluate('exp', 'secrets:db', 'read').allowed, false);
    });

    it('resolves allow-vs-deny conflicts with deny-overrides (deny wins)', () => {
      // WS-D: resource_matches uses glob matching now — '*' is the match-all
      // pattern (the old regex '.*' would be treated as a literal exact match and
      // never fire). With both an allow and a deny matching, forbid-overrides
      // (Cedar/OPA) makes the deny win regardless of priority.
      engine.addPolicy({ name: 'low-allow', rules: [{ condition: { type: 'resource_matches', pattern: '*' }, effect: 'allow' }], priority: 1 });
      engine.addPolicy({ name: 'high-deny', rules: [{ condition: { type: 'resource_matches', pattern: '*' }, effect: 'deny' }], priority: 10 });
      const d = engine.evaluate('prio', 'docs:x', 'read');
      assert.strictEqual(d.matchedPolicy, 'high-deny');
      assert.strictEqual(d.allowed, false);
    });

    it('evaluates resource_matches via anchored glob (prefix wildcard + default-deny)', () => {
      // WS-D: resource_matches is now anchored glob matching, NOT substring regex
      // (ReDoS-safe). 'cache:*' matches resources under the cache: prefix and
      // denies them; anything else falls through to the fail-closed default-deny.
      engine.addPolicy({ name: 'deny-cache', rules: [{ condition: { type: 'resource_matches', pattern: 'cache:*' }, effect: 'deny' }] });
      // Also add an explicit allow for a sibling prefix so we can prove a NON-cache
      // resource is allowed by an explicit rule (not merely by the old default-allow).
      engine.addPolicy({ name: 'allow-docs', rules: [{ condition: { type: 'resource_matches', pattern: 'docs:*' }, effect: 'allow' }] });
      assert.strictEqual(engine.evaluate('a', 'cache:tmp:1', 'read').allowed, false); // prefix glob matches -> deny
      assert.strictEqual(engine.evaluate('a', 'docs:guide', 'read').allowed, true); // explicit allow
      assert.strictEqual(engine.evaluate('a', 'other:perm:1', 'read').allowed, false); // no match -> default-deny
    });

    it('evaluates a compound AND condition (both must hold)', () => {
      // WS-D: inner resource_matches uses glob 'secrets:*' (not regex '^secrets:').
      engine.addPolicy({
        name: 'deny-write-secrets',
        rules: [{
          condition: {
            type: 'compound', operator: 'AND',
            conditions: [{ type: 'resource_matches', pattern: 'secrets:*' }, { type: 'action_type', action: 'write' }],
          },
          effect: 'deny',
        }],
      });
      const denied = engine.evaluate('a', 'secrets:db', 'write');
      assert.strictEqual(denied.allowed, false); // both hold -> deny
      assert.strictEqual(denied.matchedPolicy, 'deny-write-secrets');
      // action differs -> AND fails -> no rule matches -> fail-closed default-deny
      // (matchedPolicy null, NOT the deny-write-secrets policy).
      const fallthrough = engine.evaluate('a', 'secrets:db', 'read');
      assert.strictEqual(fallthrough.allowed, false);
      assert.strictEqual(fallthrough.matchedPolicy, null);
    });

    it('evaluates a trust_below condition against the TrustEngine', () => {
      // fresh agent seeds at overall 0.5.
      // WS-D: default is now fail-closed deny, so to prove the trust_below deny
      // rule does NOT fire (0.5 not below 0.4) we add an explicit allow that the
      // request can fall back to. This isolates trust_below from the default.
      engine.addPolicy({ name: 'allow-all', rules: [{ condition: { type: 'resource_matches', pattern: '*' }, effect: 'allow' }] });
      engine.addPolicy({ name: 'deny-below-0.4', rules: [{ condition: { type: 'trust_below', threshold: 0.4 }, effect: 'deny' }] });
      assert.strictEqual(engine.evaluate('tr', 'r', 'read').allowed, true); // 0.5 not below 0.4 -> deny rule silent -> explicit allow wins
      // 0.5 < 0.6 -> deny rule fires; deny-overrides beats the explicit allow.
      engine.addPolicy({ name: 'deny-below-0.6', rules: [{ condition: { type: 'trust_below', threshold: 0.6 }, effect: 'deny' }], priority: 5 });
      assert.strictEqual(engine.evaluate('tr', 'r', 'read').allowed, false); // 0.5 < 0.6 -> deny
    });

    it('ignores disabled policies', () => {
      // WS-D: '*' is the glob match-all (old regex '.*' would be a literal exact
      // match and never fire). Once disabled, the deny no longer fires; with no
      // other policy the request falls through to the fail-closed default-deny.
      const p = engine.addPolicy({ name: 'deny-all', rules: [{ condition: { type: 'resource_matches', pattern: '*' }, effect: 'deny' }] });
      assert.strictEqual(engine.evaluate('a', 'x', 'read').allowed, false);
      engine.disablePolicy(p.id);
      assert.strictEqual(engine.evaluate('a', 'x', 'read').allowed, false); // disabled deny -> no match -> default-deny
      // Prove the disable actually took effect (not just coincidental default-deny):
      // an explicit allow now governs, which it would not if deny-all were still active.
      engine.addPolicy({ name: 'allow-x', rules: [{ condition: { type: 'resource_matches', pattern: '*' }, effect: 'allow' }] });
      assert.strictEqual(engine.evaluate('a', 'x', 'read').allowed, true);
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

    it('detectAll returns rate_spike AND behavior_drift; unauthorized_access/resource_abuse remain unimplemented', () => {
      // WS-D: behavior_drift IS now implemented (Jensen-Shannon divergence vs a
      // frozen admission baseline). unauthorized_access and resource_abuse are
      // still unimplemented.
      // Freeze a baseline that expects only 'read', then drive purely off-baseline
      // 'write' calls: the live distribution is fully disjoint from the baseline,
      // so JS divergence == 1.0 (>> 0.25 threshold) and drift fires. The >= 8
      // rapid calls also satisfy MIN_DRIFT_OBSERVATIONS and trip the rate spike.
      detector.registerBaseline('drift', { read: 10 });
      for (let i = 0; i < 8; i++) detector.recordAction('drift', 'write');
      const all = detector.detectAll('drift');
      const types = new Set(all.map(a => a.type));
      assert.ok(all.length >= 2);
      assert.strictEqual(types.has('rate_spike'), true);
      assert.strictEqual(types.has('behavior_drift'), true);
      assert.strictEqual(types.has('unauthorized_access'), false);
      assert.strictEqual(types.has('resource_abuse'), false);
    });

    // WS-D positive test: the frozen-baseline drift detector fires on a divergent
    // tool-usage sequence and stays silent on an on-baseline one.
    it('detectBehaviorDrift fires on a divergent sequence against a frozen baseline', () => {
      const alerts: string[] = [];
      bus.on('governance.anomaly_detected' as any, (e: any) => alerts.push(e.alertId));

      // Agent admitted expecting a read-heavy mix.
      detector.registerBaseline('agent-drift', { read: 8, write: 2 });

      // On-baseline behavior: no drift while observations are below the minimum
      // AND while the distribution is consistent with the frozen reference.
      for (let i = 0; i < 4; i++) detector.recordAction('agent-drift', 'read');
      assert.strictEqual(detector.detectBehaviorDrift('agent-drift'), null); // < MIN_DRIFT_OBSERVATIONS

      // Now flood with an off-baseline tool (delete) the agent never used at
      // admission — the live mix diverges sharply from the frozen baseline.
      for (let i = 0; i < 12; i++) detector.recordAction('agent-drift', 'delete');
      const drift = detector.detectBehaviorDrift('agent-drift');
      assert.ok(drift, 'expected a behavior_drift alert');
      assert.strictEqual(drift!.type, 'behavior_drift');
      assert.strictEqual(drift!.agentId, 'agent-drift');
      assert.ok((drift!.evidence as any).divergence > 0.25);
      assert.ok(alerts.includes(drift!.id)); // event bus emitted
      // Persisted for audit.
      const persisted = detector.getAlerts('agent-drift').filter(a => a.type === 'behavior_drift');
      assert.strictEqual(persisted.length, 1);
    });

    it('detectBehaviorDrift returns null when no baseline is registered', () => {
      // No frozen baseline => nothing to diverge from => no false positives.
      for (let i = 0; i < 10; i++) detector.recordAction('no-baseline', 'write');
      assert.strictEqual(detector.detectBehaviorDrift('no-baseline'), null);
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
