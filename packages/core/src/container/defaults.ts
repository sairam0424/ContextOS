import { ServiceContainer } from './container.js';
import { TOKENS } from './tokens.js';
import { getSharedDatabase } from '../database/index.js';
import { WorkspaceEventBus } from '../events/index.js';
import { AgentRegistry } from '../agents/registry.js';
import { MessageBus } from '../agents/message-bus.js';
import { TaskGraph } from '../orchestration/task-graph.js';
import { TaskScheduler } from '../orchestration/scheduler.js';
import { ConflictResolver } from '../orchestration/conflict-resolver.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { AuditLog } from '../resilience/audit-log.js';

/**
 * Creates a default DI container using the shared (lazy) database singleton.
 * @deprecated Prefer `createContextOS()` for new code — it provides explicit lifecycle control.
 */
export function createDefaultContainer(): ServiceContainer {
  const container = new ServiceContainer();

  container.register(TOKENS.EventBus, () => new WorkspaceEventBus());
  container.register(TOKENS.Database, () => getSharedDatabase());
  container.register(TOKENS.AgentRegistry, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new AgentRegistry(db.getRawDb(), bus);
  });
  container.register(TOKENS.MessageBus, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new MessageBus(db.getRawDb(), bus);
  });
  container.register(TOKENS.TaskGraph, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new TaskGraph(db.getRawDb(), bus);
  });
  container.register(TOKENS.TaskScheduler, (c) => {
    const db = c.resolve(TOKENS.Database);
    const registry = c.resolve(TOKENS.AgentRegistry);
    const msgBus = c.resolve(TOKENS.MessageBus);
    const bus = c.resolve(TOKENS.EventBus);
    return new TaskScheduler(db.getRawDb(), registry, msgBus, bus);
  });
  container.register(TOKENS.ConflictResolver, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new ConflictResolver(db.getRawDb());
  });
  container.register(TOKENS.CircuitBreaker, (c) => {
    const registry = c.resolve(TOKENS.AgentRegistry);
    return new CircuitBreaker(registry);
  });
  container.register(TOKENS.AuditLog, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new AuditLog(db.getRawDb());
  });

  return container;
}
