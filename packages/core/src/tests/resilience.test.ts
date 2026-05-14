import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { AgentRegistry } from '../agents/registry.js';
import { WorkspaceEventBus } from '../events/event-bus.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { AuditLog } from '../resilience/audit-log.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-resilience');

describe('CircuitBreaker', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let registry: AgentRegistry;
  let breaker: CircuitBreaker;

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'resilience.db'));
    initializeSchema(db);
    migrateSchema(db);
    const bus = new WorkspaceEventBus();
    registry = new AgentRegistry(db, bus);
    breaker = new CircuitBreaker(registry, { maxFailures: 3, windowMs: 60000 });
  });

  after(() => {
    db.close();
    fs.removeSync(TEST_DIR);
  });

  it('does not trip below threshold', () => {
    const agent = registry.register({ name: 'fragile', capabilities: ['test'] });
    const r1 = breaker.recordFailure(agent.id);
    const r2 = breaker.recordFailure(agent.id);
    assert.strictEqual(r1.tripped, false);
    assert.strictEqual(r2.tripped, false);
    assert.strictEqual(breaker.getFailureCount(agent.id), 2);
  });

  it('trips at threshold and quarantines agent', () => {
    const agents = registry.getActive();
    const agent = agents.find(a => a.name === 'fragile')!;
    const r3 = breaker.recordFailure(agent.id);
    assert.strictEqual(r3.tripped, true);

    const updated = registry.getById(agent.id);
    assert.strictEqual(updated?.status, 'quarantined');
  });

  it('success resets failure count', () => {
    const agent = registry.register({ name: 'recovering', capabilities: ['test'] });
    breaker.recordFailure(agent.id);
    breaker.recordFailure(agent.id);
    breaker.recordSuccess(agent.id);
    assert.strictEqual(breaker.getFailureCount(agent.id), 0);
  });
});

describe('AuditLog', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let auditLog: AuditLog;

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'audit.db'));
    initializeSchema(db);
    migrateSchema(db);
    auditLog = new AuditLog(db);
  });

  after(() => {
    db.close();
  });

  it('appends entries with merkle linking', () => {
    const e1 = auditLog.append('agent-1', 'task.complete', { taskId: 't1' });
    const e2 = auditLog.append('agent-1', 'task.assign', { taskId: 't2' });

    assert.ok(e1.hash);
    assert.strictEqual(e2.prevHash, e1.hash);
  });

  it('retrieves entries for an agent', () => {
    const entries = auditLog.getForAgent('agent-1');
    assert.strictEqual(entries.length, 2);
  });

  it('verifies chain integrity', () => {
    const result = auditLog.verifyIntegrity();
    assert.strictEqual(result.valid, true);
  });

  it('detects tampering', () => {
    // Use subquery approach since LIMIT in UPDATE requires SQLITE_ENABLE_UPDATE_DELETE_LIMIT
    db.prepare(`
      UPDATE audit_log SET detail = '{"tampered": true}'
      WHERE id = (SELECT id FROM audit_log WHERE agent_id = 'agent-1' ORDER BY timestamp ASC LIMIT 1)
    `).run();
    const result = auditLog.verifyIntegrity();
    assert.strictEqual(result.valid, false);
  });
});
