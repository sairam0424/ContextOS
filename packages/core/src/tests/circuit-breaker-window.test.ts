import { expect } from 'chai';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { AgentRegistry } from '../agents/registry.js';
import { WorkspaceEventBus } from '../events/event-bus.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-cb-window');

describe('CircuitBreaker sliding window', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let registry: AgentRegistry;
  let breaker: CircuitBreaker;

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'cb-window.db'));
    initializeSchema(db);
    migrateSchema(db);
    const bus = new WorkspaceEventBus();
    registry = new AgentRegistry(db, bus);
    // Use a short window (5 seconds) and high threshold to test expiry behavior
    breaker = new CircuitBreaker(registry, { maxFailures: 5, windowMs: 5000 });
  });

  after(() => {
    db.close();
    fs.removeSync(TEST_DIR);
  });

  it('old failures outside window are not counted', () => {
    const agent = registry.register({ name: 'window-test-agent', capabilities: ['code'] });

    // Record 4 failures (below threshold of 5)
    breaker.recordFailure(agent.id);
    breaker.recordFailure(agent.id);
    breaker.recordFailure(agent.id);
    breaker.recordFailure(agent.id);

    expect(breaker.getFailureCount(agent.id)).to.equal(4);

    // Access the internal errors map to manually backdate timestamps
    // This simulates time passing without needing to actually wait
    const errorsMap = (breaker as any).errors as Map<string, { timestamps: number[] }>;
    const record = errorsMap.get(agent.id)!;

    // Move all existing timestamps outside the window (> 5 seconds ago)
    const expiredTime = Date.now() - 10000; // 10 seconds ago, well outside 5s window
    record.timestamps = record.timestamps.map(() => expiredTime);

    // Record one fresh failure within the window
    const result = breaker.recordFailure(agent.id);

    // The breaker should NOT trip because old failures are pruned
    expect(result.tripped).to.be.false;

    // Only the recent failure should be counted
    expect(breaker.getFailureCount(agent.id)).to.equal(1);

    // Verify agent is still active (not quarantined)
    const agentRecord = registry.getById(agent.id);
    expect(agentRecord!.status).to.equal('active');
  });

  it('reset() clears all failure history for an agent', () => {
    const agent = registry.register({ name: 'reset-test-agent', capabilities: ['review'] });

    // Record some failures
    breaker.recordFailure(agent.id);
    breaker.recordFailure(agent.id);
    breaker.recordFailure(agent.id);

    expect(breaker.getFailureCount(agent.id)).to.equal(3);

    // Reset the agent's failure history
    breaker.reset(agent.id);

    // Verify all failures are cleared
    expect(breaker.getFailureCount(agent.id)).to.equal(0);

    // Recording new failures after reset starts from zero
    breaker.recordFailure(agent.id);
    expect(breaker.getFailureCount(agent.id)).to.equal(1);
  });
});
