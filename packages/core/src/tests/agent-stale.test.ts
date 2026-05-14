import { expect } from 'chai';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { AgentRegistry } from '../agents/registry.js';
import { WorkspaceEventBus } from '../events/event-bus.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-stale');

describe('AgentRegistry.getStale()', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let registry: AgentRegistry;
  let bus: WorkspaceEventBus;

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'stale.db'));
    initializeSchema(db);
    migrateSchema(db);
    bus = new WorkspaceEventBus();
    registry = new AgentRegistry(db, bus);
  });

  after(() => {
    db.close();
    fs.removeSync(TEST_DIR);
  });

  it('returns agents whose heartbeat is older than timeout', () => {
    const agent = registry.register({ name: 'stale-worker', capabilities: ['code'] });

    // Manually backdate the heartbeat in the DB to simulate staleness
    const oldTime = Date.now() - 120000; // 2 minutes ago
    db.prepare(`UPDATE agents SET last_heartbeat = ? WHERE id = ?`).run(oldTime, agent.id);

    const staleAgents = registry.getStale(60000); // 1 minute timeout
    expect(staleAgents.length).to.be.greaterThan(0);

    const found = staleAgents.find(a => a.id === agent.id);
    expect(found).to.not.be.undefined;
    expect(found!.name).to.equal('stale-worker');
  });

  it('does not return recently active agents', () => {
    const agent = registry.register({ name: 'fresh-worker', capabilities: ['review'] });

    // Agent was just registered, so heartbeat is fresh
    const staleAgents = registry.getStale(60000);
    const found = staleAgents.find(a => a.id === agent.id);
    expect(found).to.be.undefined;
  });

  it('does not return quarantined agents', () => {
    const agent = registry.register({ name: 'quarantined-stale', capabilities: ['lint'] });

    // Backdate heartbeat to make it old
    const oldTime = Date.now() - 120000;
    db.prepare(`UPDATE agents SET last_heartbeat = ? WHERE id = ?`).run(oldTime, agent.id);

    // Quarantine the agent
    registry.quarantine(agent.id, 'test quarantine');

    // getStale only queries status = 'active', so quarantined agents are excluded
    const staleAgents = registry.getStale(60000);
    const found = staleAgents.find(a => a.id === agent.id);
    expect(found).to.be.undefined;
  });
});
