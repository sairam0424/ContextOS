import assert from 'node:assert';
import { createTestDb, cleanupTestDb, TestDB } from './helpers.js';
import { createContextOS } from '../factory.js';
import type { ContextOS } from '../factory.js';

describe('createContextOS Factory', function () {
  let testDb: TestDB;
  let ctx: ContextOS;

  before(function () {
    testDb = createTestDb('factory');
    ctx = createContextOS({ workspaceRoot: testDb.dir, dbPath: testDb.path });
  });

  after(function () {
    ctx.shutdown();
    cleanupTestDb(testDb);
  });

  it('creates a working instance with all services', () => {
    assert.ok(ctx.agents);
    assert.ok(ctx.tasks);
    assert.ok(ctx.scheduler);
    assert.ok(ctx.events);
    assert.ok(ctx.database);
    assert.ok(ctx.audit);
    assert.ok(ctx.circuitBreaker);
    assert.ok(ctx.conflicts);
    assert.ok(ctx.messages);
  });

  it('can register an agent via the instance', () => {
    const agent = ctx.agents.register({ name: 'test-agent', capabilities: ['read', 'write'] });
    assert.strictEqual(agent.name, 'test-agent');
    assert.strictEqual(agent.status, 'active');
    assert.deepStrictEqual(agent.capabilities, ['read', 'write']);
  });

  it('can create and assign a task', () => {
    const agent = ctx.agents.register({ name: 'worker', capabilities: ['execute'] });
    const task = ctx.tasks.addTask({
      missionId: 'test-mission',
      title: 'Test task',
      description: 'A test task',
    });
    assert.strictEqual(task.status, 'pending');

    const assigned = ctx.scheduler.assignNext('test-mission');
    assert.ok(assigned);
    assert.strictEqual(assigned.status, 'assigned');
  });

  it('audit log maintains chain integrity', () => {
    ctx.audit.append('test-agent', 'action.one', { key: 'value' });
    ctx.audit.append('test-agent', 'action.two', { key: 'value2' });
    const result = ctx.audit.verifyIntegrity();
    assert.strictEqual(result.valid, true);
  });

  it('circuit breaker tracks failures and trips', () => {
    const agent = ctx.agents.register({ name: 'breaker-test', capabilities: ['compute'] });
    for (let i = 0; i < 5; i++) {
      ctx.circuitBreaker.recordFailure(agent.id);
    }
    const state = ctx.circuitBreaker.getState(agent.id);
    assert.strictEqual(state, 'open');
  });

  it('event bus emits and receives', () => {
    let received = false;
    ctx.events.on('task.completed', () => { received = true; });
    ctx.events.emit({ type: 'task.completed', taskId: 'fake-id' });
    assert.strictEqual(received, true);
  });
});
