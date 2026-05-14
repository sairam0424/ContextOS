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
  private locks: LocksRepository;
  // In-memory only by design — read locks are advisory and volatile across restarts.
  // Write locks persist via LocksRepository (SQLite). This asymmetry is intentional
  // for single-process use; multi-process requires DB-backed readers.
  private readers: Map<string, Set<string>> = new Map();

  constructor(private db: RawDB) {
    this.locks = new LocksRepository(db);
  }

  acquireRead(path: string, agentId: string): boolean {
    const existingLock = this.locks.get(path);
    if (existingLock && existingLock.agent_id !== agentId) {
      log.debug({ path, agentId, holder: existingLock.agent_id }, 'Read blocked by write lock');
      return false;
    }

    if (!this.readers.has(path)) {
      this.readers.set(path, new Set());
    }
    this.readers.get(path)!.add(agentId);
    log.debug({ path, agentId }, 'Read lock acquired');
    return true;
  }

  acquireWrite(path: string, agentId: string): boolean {
    const readers = this.readers.get(path);
    if (readers && readers.size > 0) {
      const otherReaders = new Set(readers);
      otherReaders.delete(agentId);
      if (otherReaders.size > 0) {
        log.debug({ path, agentId, readers: [...otherReaders] }, 'Write blocked by readers');
        return false;
      }
    }

    const existingLock = this.locks.get(path);
    if (existingLock && existingLock.agent_id !== agentId) {
      log.debug({ path, agentId, holder: existingLock.agent_id }, 'Write blocked by another writer');
      return false;
    }

    this.locks.acquire(path, agentId);
    log.debug({ path, agentId }, 'Write lock acquired');
    return true;
  }

  upgradeToWrite(path: string, agentId: string): boolean {
    const readers = this.readers.get(path);
    if (!readers || !readers.has(agentId)) {
      return this.acquireWrite(path, agentId);
    }

    const otherReaders = new Set(readers);
    otherReaders.delete(agentId);
    if (otherReaders.size > 0) {
      log.debug({ path, agentId }, 'Cannot upgrade — other readers present');
      return false;
    }

    readers.delete(agentId);
    return this.acquireWrite(path, agentId);
  }

  release(path: string, agentId: string): void {
    const readers = this.readers.get(path);
    if (readers) {
      readers.delete(agentId);
      if (readers.size === 0) this.readers.delete(path);
    }
    this.locks.release(path, agentId);
    log.debug({ path, agentId }, 'Lock released');
  }

  getHolder(path: string): { agentId: string; mode: 'read' | 'write' } | null {
    const lock = this.locks.get(path);
    if (lock) return { agentId: lock.agent_id, mode: 'write' };

    const readers = this.readers.get(path);
    if (readers && readers.size > 0) {
      return { agentId: [...readers][0], mode: 'read' };
    }
    return null;
  }
}
