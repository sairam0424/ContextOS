import { ServiceContainer } from './container.js';
import { TOKENS } from './tokens.js';
import { getSharedDatabase } from '../database/index.js';
import { WorkspaceEventBus } from '../events/index.js';

export function createDefaultContainer(): ServiceContainer {
  const container = new ServiceContainer();

  container.register(TOKENS.EventBus, () => new WorkspaceEventBus());
  container.register(TOKENS.Database, () => getSharedDatabase());

  return container;
}
