import { ServiceContainer } from './container.js';
import { TOKENS } from './tokens.js';
import { getSharedDatabase } from '../database/index.js';
import { WorkspaceEventBus } from '../events/index.js';
import { AgentRegistry } from '../agents/registry.js';
import { MessageBus } from '../agents/message-bus.js';

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

  return container;
}
