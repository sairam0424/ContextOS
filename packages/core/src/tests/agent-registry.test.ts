import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { AgentRegistry } from '../agents/registry.js';
import { WorkspaceEventBus } from '../events/event-bus.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-agents');

describe('AgentRegistry', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let registry: AgentRegistry;
  let bus: WorkspaceEventBus;

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'agents.db'));
    initializeSchema(db);
    migrateSchema(db);
    bus = new WorkspaceEventBus();
    registry = new AgentRegistry(db, bus);
  });

  after(() => {
    db.close();
    fs.removeSync(TEST_DIR);
  });

  it('registers an agent and returns a record with id', () => {
    const agent = registry.register({ name: 'code-reviewer', capabilities: ['review', 'lint'] });
    assert.ok(agent.id);
    assert.strictEqual(agent.name, 'code-reviewer');
    assert.strictEqual(agent.status, 'active');
    assert.deepStrictEqual(agent.capabilities, ['review', 'lint']);
  });

  it('lists active agents', () => {
    const active = registry.getActive();
    assert.ok(active.length >= 1);
    assert.ok(active.some(a => a.name === 'code-reviewer'));
  });

  it('updates heartbeat', () => {
    const agents = registry.getActive();
    const agent = agents[0];
    const before = agent.lastHeartbeat;
    registry.heartbeat(agent.id);
    const updated = registry.getById(agent.id);
    assert.ok(updated!.lastHeartbeat >= before);
  });

  it('deregisters an agent', () => {
    const agent = registry.register({ name: 'temp-agent', capabilities: ['temp'] });
    registry.deregister(agent.id, 'test cleanup');
    const found = registry.getById(agent.id);
    assert.strictEqual(found, undefined);
  });

  it('quarantines an agent', () => {
    const agent = registry.register({ name: 'bad-agent', capabilities: ['fail'] });
    registry.quarantine(agent.id, 'too many errors');
    const found = registry.getById(agent.id);
    assert.ok(found);
    assert.strictEqual(found.status, 'quarantined');
  });

  it('finds agents by capability', () => {
    const matches = registry.findByCapability('review');
    assert.ok(matches.length >= 1);
    assert.ok(matches.some(a => a.name === 'code-reviewer'));
  });
});
