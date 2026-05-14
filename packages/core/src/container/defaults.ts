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

export function createDefaultContainer(): ServiceContainer {
  const container = new ServiceContainer();

  container.register(TOKENS.EventBus, () => new WorkspaceEventBus());
  container.register(TOKENS.Database, () => getSharedDatabase());
  container.register(TOKENS.AgentRegistry, (c) => {
    const db = c.resolve<ReturnType<typeof getSharedDatabase>>(TOKENS.Database);
    const bus = c.resolve<WorkspaceEventBus>(TOKENS.EventBus);
    return new AgentRegistry(db.getRawDb(), bus);
  });
  container.register(TOKENS.MessageBus, (c) => {
    const db = c.resolve<ReturnType<typeof getSharedDatabase>>(TOKENS.Database);
    const bus = c.resolve<WorkspaceEventBus>(TOKENS.EventBus);
    return new MessageBus(db.getRawDb(), bus);
  });
  container.register(TOKENS.TaskGraph, (c) => {
    const db = c.resolve<ReturnType<typeof getSharedDatabase>>(TOKENS.Database);
    const bus = c.resolve<WorkspaceEventBus>(TOKENS.EventBus);
    return new TaskGraph(db.getRawDb(), bus);
  });
  container.register(TOKENS.TaskScheduler, (c) => {
    const db = c.resolve<ReturnType<typeof getSharedDatabase>>(TOKENS.Database);
    const registry = c.resolve<AgentRegistry>(TOKENS.AgentRegistry);
    const msgBus = c.resolve<MessageBus>(TOKENS.MessageBus);
    const bus = c.resolve<WorkspaceEventBus>(TOKENS.EventBus);
    return new TaskScheduler(db.getRawDb(), registry, msgBus, bus);
  });
  container.register(TOKENS.ConflictResolver, (c) => {
    const db = c.resolve<ReturnType<typeof getSharedDatabase>>(TOKENS.Database);
    return new ConflictResolver(db.getRawDb());
  });
  container.register(TOKENS.CircuitBreaker, (c) => {
    const registry = c.resolve<AgentRegistry>(TOKENS.AgentRegistry);
    return new CircuitBreaker(registry);
  });
  container.register(TOKENS.AuditLog, (c) => {
    const db = c.resolve<ReturnType<typeof getSharedDatabase>>(TOKENS.Database);
    return new AuditLog(db.getRawDb());
  });

  return container;
}
