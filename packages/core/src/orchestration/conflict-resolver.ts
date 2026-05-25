import type { RawDB } from '../database/types.js';
import { LocksRepository } from '../database/locks.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('conflict-resolver');

export interface LockRequest {
  path: string;
  agentId: string;
  mode: 'read' | 'write';
}

export class ConflictResolver {
  private locksRepo: LocksRepository;

  constructor(private db: RawDB) {
    this.locksRepo = new LocksRepository(db);
  }

  acquireRead(path: string, agentId: string): boolean {
    const acquired = this.locksRepo.acquire(path, agentId, 300_000, 'read');
    if (!acquired) {
      log.debug({ path, agentId }, 'Read lock blocked by write lock');
      return false;
    }
    log.debug({ path, agentId }, 'Read lock acquired');
    return true;
  }

  acquireWrite(path: string, agentId: string): boolean {
    // Check for other readers in the DB
    const readers = this.locksRepo.getReaders(path);
    const otherReaders = readers.filter(id => id !== agentId);
    if (otherReaders.length > 0) {
      log.debug({ path, agentId, readers: otherReaders }, 'Write blocked by readers');
      return false;
    }

    const existingLock = this.locksRepo.get(path);
    if (existingLock && existingLock.agent_id !== agentId) {
      log.debug({ path, agentId, holder: existingLock.agent_id }, 'Write blocked by another writer');
      return false;
    }

    const acquired = this.locksRepo.acquire(path, agentId);
    if (!acquired) {
      log.debug({ path, agentId }, 'Write lock acquire failed at DB layer');
      return false;
    }
    log.debug({ path, agentId }, 'Write lock acquired');
    return true;
  }

  upgradeToWrite(path: string, agentId: string): boolean {
    const readers = this.locksRepo.getReaders(path);
    const hasOwnRead = readers.includes(agentId);

    if (!hasOwnRead) {
      return this.acquireWrite(path, agentId);
    }

    const otherReaders = readers.filter(id => id !== agentId);
    if (otherReaders.length > 0) {
      log.debug({ path, agentId }, 'Cannot upgrade — other readers present');
      return false;
    }

    // Release own read lock before acquiring write
    this.locksRepo.release(path, agentId);
    return this.acquireWrite(path, agentId);
  }

  release(path: string, agentId: string): void {
    this.locksRepo.release(path, agentId);
    log.debug({ path, agentId }, 'Lock released');
  }

  getHolder(path: string): { agentId: string; mode: 'read' | 'write' } | null {
    const lock = this.locksRepo.get(path);
    if (lock) return { agentId: lock.agent_id, mode: 'write' };

    const readers = this.locksRepo.getReaders(path);
    if (readers.length > 0) {
      return { agentId: readers[0], mode: 'read' };
    }
    return null;
  }
}
