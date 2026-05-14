import { expect } from 'chai';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { ServiceContainer } from '../container/container.js';
import { TOKENS } from '../container/tokens.js';
import { AgentRegistry } from '../agents/registry.js';
import { MessageBus } from '../agents/message-bus.js';
import { TaskGraph } from '../orchestration/task-graph.js';
import { TaskScheduler } from '../orchestration/scheduler.js';
import { ConflictResolver } from '../orchestration/conflict-resolver.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { AuditLog } from '../resilience/audit-log.js';
import { WorkspaceEventBus } from '../events/event-bus.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-integration');

function createTestContainer(): ServiceContainer {
  const container = new ServiceContainer();

  fs.ensureDirSync(TEST_DIR);
  const db = createConnection(path.join(TEST_DIR, 'integration.db'));
  initializeSchema(db);
  migrateSchema(db);

  container.register(TOKENS.EventBus, () => new WorkspaceEventBus());
  container.register(TOKENS.Database, () => ({ getRawDb: () => db, close: () => db.close() }));
  container.register(TOKENS.AgentRegistry, (c) => {
    const dbSvc = c.resolve<{ getRawDb: () => any }>(TOKENS.Database);
    const bus = c.resolve<WorkspaceEventBus>(TOKENS.EventBus);
    return new AgentRegistry(dbSvc.getRawDb(), bus);
  });
  container.register(TOKENS.MessageBus, (c) => {
    const dbSvc = c.resolve<{ getRawDb: () => any }>(TOKENS.Database);
    const bus = c.resolve<WorkspaceEventBus>(TOKENS.EventBus);
    return new MessageBus(dbSvc.getRawDb(), bus);
  });
  container.register(TOKENS.TaskGraph, (c) => {
    const dbSvc = c.resolve<{ getRawDb: () => any }>(TOKENS.Database);
    const bus = c.resolve<WorkspaceEventBus>(TOKENS.EventBus);
    return new TaskGraph(dbSvc.getRawDb(), bus);
  });
  container.register(TOKENS.TaskScheduler, (c) => {
    const dbSvc = c.resolve<{ getRawDb: () => any }>(TOKENS.Database);
    const registry = c.resolve<AgentRegistry>(TOKENS.AgentRegistry);
    const msgBus = c.resolve<MessageBus>(TOKENS.MessageBus);
    const bus = c.resolve<WorkspaceEventBus>(TOKENS.EventBus);
    return new TaskScheduler(dbSvc.getRawDb(), registry, msgBus, bus);
  });
  container.register(TOKENS.ConflictResolver, (c) => {
    const dbSvc = c.resolve<{ getRawDb: () => any }>(TOKENS.Database);
    return new ConflictResolver(dbSvc.getRawDb());
  });
  container.register(TOKENS.CircuitBreaker, (c) => {
    const registry = c.resolve<AgentRegistry>(TOKENS.AgentRegistry);
    return new CircuitBreaker(registry);
  });
  container.register(TOKENS.AuditLog, (c) => {
    const dbSvc = c.resolve<{ getRawDb: () => any }>(TOKENS.Database);
    return new AuditLog(dbSvc.getRawDb());
  });

  return container;
}

describe('Integration: Default Container', function () {
  this.timeout(15000);
  let container: ServiceContainer;

  before(() => {
    container = createTestContainer();
  });

  after(() => {
    const dbSvc = container.resolve<{ close: () => void }>(TOKENS.Database);
    dbSvc.close();
    fs.removeSync(TEST_DIR);
  });

  it('resolves all registered tokens without error', () => {
    const registeredTokens = [
      TOKENS.EventBus,
      TOKENS.Database,
      TOKENS.AgentRegistry,
      TOKENS.MessageBus,
      TOKENS.TaskGraph,
      TOKENS.TaskScheduler,
      TOKENS.ConflictResolver,
      TOKENS.CircuitBreaker,
      TOKENS.AuditLog,
    ];

    for (const token of registeredTokens) {
      expect(() => container.resolve(token)).to.not.throw();
      const instance = container.resolve(token);
      expect(instance).to.not.be.null;
      expect(instance).to.not.be.undefined;
    }
  });

  it('scheduler assigns task and message appears in agent inbox', () => {
    const registry = container.resolve<AgentRegistry>(TOKENS.AgentRegistry);
    const scheduler = container.resolve<TaskScheduler>(TOKENS.TaskScheduler);
    const messageBus = container.resolve<MessageBus>(TOKENS.MessageBus);

    const agent = registry.register({ name: 'integration-worker', capabilities: ['code'] });
    const graph = scheduler.getGraph();
    graph.addTask({ missionId: 'integration-mission', title: 'Integration Task', description: 'Verify cross-module wiring' });

    const assigned = scheduler.assignNext('integration-mission');
    expect(assigned).to.not.be.null;
    expect(assigned!.status).to.equal('assigned');
    expect(assigned!.assignedTo).to.equal(agent.id);

    const messages = messageBus.getUndelivered(agent.id);
    expect(messages.length).to.be.greaterThan(0);

    const taskMessage = messages.find(m => m.intent === 'task.assign');
    expect(taskMessage).to.not.be.undefined;
    expect(taskMessage!.from).to.equal('scheduler');
    expect(taskMessage!.to).to.equal(agent.id);
    expect((taskMessage!.payload as any).taskId).to.equal(assigned!.id);
  });
});

describe('Integration: CircuitBreaker + AgentRegistry', function () {
  this.timeout(15000);
  let container: ServiceContainer;

  before(() => {
    fs.removeSync(TEST_DIR);
    container = createTestContainer();
  });

  after(() => {
    const dbSvc = container.resolve<{ close: () => void }>(TOKENS.Database);
    dbSvc.close();
    fs.removeSync(TEST_DIR);
  });

  it('quarantined agent is excluded from scheduler assignment', () => {
    const registry = container.resolve<AgentRegistry>(TOKENS.AgentRegistry);
    const scheduler = container.resolve<TaskScheduler>(TOKENS.TaskScheduler);
    const breaker = container.resolve<CircuitBreaker>(TOKENS.CircuitBreaker);

    const agent1 = registry.register({ name: 'reliable-agent', capabilities: ['code'] });
    const agent2 = registry.register({ name: 'unstable-agent', capabilities: ['code'] });

    // Trip the circuit breaker on agent2 (default maxFailures is 5)
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(agent2.id);
    }

    // Verify agent2 is quarantined
    const quarantined = registry.getById(agent2.id);
    expect(quarantined!.status).to.equal('quarantined');

    // Add a task and verify it gets assigned to agent1 (the only active one)
    const graph = scheduler.getGraph();
    graph.addTask({ missionId: 'breaker-mission', title: 'Breaker Task', description: 'Should go to reliable agent' });

    const assigned = scheduler.assignNext('breaker-mission');
    expect(assigned).to.not.be.null;
    expect(assigned!.assignedTo).to.equal(agent1.id);
  });
});
