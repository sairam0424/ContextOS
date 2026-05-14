import { DatabaseService, databaseService } from '../database/index.js';
import { workspaceRoot } from '../context.js';

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

// Singleton for easier core integration
export const lockingService = new LockingService(databaseService);
