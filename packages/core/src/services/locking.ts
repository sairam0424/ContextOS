import { DatabaseService, getSharedDatabase } from '../database/index.js';

export class LockingService {
  constructor(private db: DatabaseService) {}

  /**
   * Attempts to acquire a lock on a file path.
   * Returns true if successful, false if already locked by another agent.
   */
  public async acquire(filePath: string, agentId: string): Promise<boolean> {
    this.db.acquireLock(filePath, agentId);
    const lock = this.db.getLock(filePath);
    if (lock?.agent_id === agentId) {
      this.db.logAccess(filePath, 'focus');
      return true;
    }
    return false;
  }

  /**
   * Releases a lock if owned by the agent.
   */
  public async release(filePath: string, agentId: string): Promise<void> {
    this.db.releaseLock(filePath, agentId);
  }

  /**
   * Checks if a path is locked by anyone.
   */
  public isLocked(filePath: string): { locked: boolean, agentId?: string } {
    const lock = this.db.getLock(filePath);
    return {
      locked: !!lock,
      agentId: lock?.agent_id
    };
  }
}

let _lockingInstance: LockingService | null = null;

/** @deprecated Use container.resolve(TOKENS.Locking) from createContextOS() instead. */
export function getLockingService(): LockingService {
  if (!_lockingInstance) {
    _lockingInstance = new LockingService(getSharedDatabase());
  }
  return _lockingInstance;
}

/**
 * @deprecated Use `getLockingService()` or inject via DI container.
 * This proxy defers DB initialization until first method call.
 */
export const lockingService: LockingService = new Proxy({} as LockingService, {
  get(_target, prop, receiver) {
    const real = getLockingService();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === 'function' ? value.bind(real) : value;
  }
});
