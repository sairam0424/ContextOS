import assert from 'node:assert';
import { createTestDb, cleanupTestDb, TestDB } from './helpers.js';
import { AgentRegistry } from '../agents/registry.js';
import { WorkspaceEventBus } from '../events/event-bus.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';

describe('CircuitBreaker Half-Open Recovery', function () {
  let testDb: TestDB;
  let registry: AgentRegistry;
  let bus: WorkspaceEventBus;
  let breaker: CircuitBreaker;

  before(function () {
    testDb = createTestDb('cb-halfopen');
    bus = new WorkspaceEventBus();
    registry = new AgentRegistry(testDb.db, bus);
  });

  after(function () {
    bus.dispose();
    cleanupTestDb(testDb);
  });

  beforeEach(function () {
    breaker = new CircuitBreaker(registry, { maxFailures: 3, windowMs: 60000, resetTimeoutMs: 100 });
  });

  it('transitions to open after max failures', () => {
    const agent = registry.register({ name: 'test-agent-1', capabilities: ['test'] });
    breaker.recordFailure(agent.id);
    breaker.recordFailure(agent.id);
    breaker.recordFailure(agent.id);
    assert.strictEqual(breaker.getState(agent.id), 'open');
    assert.strictEqual(breaker.canExecute(agent.id), false);
  });

  it('transitions to half-open after resetTimeout', function (done) {
    const agent = registry.register({ name: 'test-agent-2', capabilities: ['test'] });
    for (let i = 0; i < 3; i++) breaker.recordFailure(agent.id);
    assert.strictEqual(breaker.getState(agent.id), 'open');

    setTimeout(() => {
      assert.strictEqual(breaker.getState(agent.id), 'half-open');
      assert.strictEqual(breaker.canExecute(agent.id), true);
      done();
    }, 150);
  });

  it('success in half-open closes the breaker', function (done) {
    const agent = registry.register({ name: 'test-agent-3', capabilities: ['test'] });
    for (let i = 0; i < 3; i++) breaker.recordFailure(agent.id);

    setTimeout(() => {
      breaker.recordSuccess(agent.id);
      assert.strictEqual(breaker.getState(agent.id), 'closed');
      assert.strictEqual(breaker.canExecute(agent.id), true);
      done();
    }, 150);
  });

  it('failure in half-open re-opens the breaker', function (done) {
    const agent = registry.register({ name: 'test-agent-4', capabilities: ['test'] });
    for (let i = 0; i < 3; i++) breaker.recordFailure(agent.id);

    setTimeout(() => {
      assert.strictEqual(breaker.getState(agent.id), 'half-open');
      breaker.recordFailure(agent.id);
      assert.strictEqual(breaker.getState(agent.id), 'open');
      done();
    }, 150);
  });
});
