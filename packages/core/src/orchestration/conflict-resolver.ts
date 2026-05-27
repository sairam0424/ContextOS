import type { RawDB } from '../database/types.js';
import { LocksRepository } from '../database/locks.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('conflict-resolver');

export interface LockRequest {
  path: string;
  agentId: string;
  mode: 'read' | 'write';
}

export class DeadlockError extends Error {
  public readonly cycle: readonly string[];

  constructor(cycle: string[]) {
    super(`Deadlock detected: ${cycle.join(' → ')} → ${cycle[0]}`);
    this.name = 'DeadlockError';
    this.cycle = Object.freeze([...cycle]);
  }
}

export class ConflictResolver {
  private locksRepo: LocksRepository;
  private waitingFor: Map<string, string> = new Map();

  constructor(private db: RawDB) {
    this.locksRepo = new LocksRepository(db);
  }

  /** Record that an agent is waiting for a lock on a given path. */
  recordWait(agentId: string, path: string): void {
    this.waitingFor = new Map(this.waitingFor).set(agentId, path);
  }

  /** Clear the wait record when an agent acquires or abandons a lock attempt. */
  clearWait(agentId: string): void {
    const next = new Map(this.waitingFor);
    next.delete(agentId);
    this.waitingFor = next;
  }

  /**
   * Build a wait-for graph and run DFS cycle detection.
   * Returns the array of agentIds forming the cycle, or null if no cycle exists.
   */
  detectDeadlock(): string[] | null {
    // Build adjacency list: waiter → set of holders blocking them
    const graph = new Map<string, Set<string>>();

    for (const [agentId, waitingPath] of this.waitingFor) {
      const holders = new Set<string>();

      // Check write lock holder
      const writeLock = this.locksRepo.getWrite(waitingPath);
      if (writeLock && writeLock.agent_id !== agentId) {
        holders.add(writeLock.agent_id);
      }

      // Check read lock holders
      const readers = this.locksRepo.getReaders(waitingPath);
      for (const readerId of readers) {
        if (readerId !== agentId) {
          holders.add(readerId);
        }
      }

      if (holders.size > 0) {
        graph.set(agentId, holders);
      }
    }

    // DFS cycle detection
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): string[] | null => {
      if (inStack.has(node)) {
        // Found cycle — extract the cycle from path
        const cycleStart = path.indexOf(node);
        return path.slice(cycleStart);
      }
      if (visited.has(node)) return null;

      visited.add(node);
      inStack.add(node);
      path.push(node);

      const neighbors = graph.get(node);
      if (neighbors) {
        for (const neighbor of neighbors) {
          const cycle = dfs(neighbor);
          if (cycle) return cycle;
        }
      }

      path.pop();
      inStack.delete(node);
      return null;
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        const cycle = dfs(node);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  acquireRead(path: string, agentId: string): boolean {
    const acquired = this.locksRepo.acquire(path, agentId, 300_000, 'read');
    if (!acquired) {
      log.debug({ path, agentId }, 'Read lock blocked by write lock');
      this.recordWait(agentId, path);
      const cycle = this.detectDeadlock();
      if (cycle) {
        this.clearWait(agentId);
        log.warn({ path, agentId, cycle }, 'Deadlock detected on read acquire');
        throw new DeadlockError(cycle);
      }
      return false;
    }
    this.clearWait(agentId);
    log.debug({ path, agentId }, 'Read lock acquired');
    return true;
  }

  acquireWrite(path: string, agentId: string): boolean {
    // Check for other readers in the DB
    const readers = this.locksRepo.getReaders(path);
    const otherReaders = readers.filter(id => id !== agentId);
    if (otherReaders.length > 0) {
      log.debug({ path, agentId, readers: otherReaders }, 'Write blocked by readers');
      this.recordWait(agentId, path);
      const cycle = this.detectDeadlock();
      if (cycle) {
        this.clearWait(agentId);
        log.warn({ path, agentId, cycle }, 'Deadlock detected on write acquire (readers blocking)');
        throw new DeadlockError(cycle);
      }
      return false;
    }

    const existingLock = this.locksRepo.get(path);
    if (existingLock && existingLock.agent_id !== agentId) {
      log.debug({ path, agentId, holder: existingLock.agent_id }, 'Write blocked by another writer');
      this.recordWait(agentId, path);
      const cycle = this.detectDeadlock();
      if (cycle) {
        this.clearWait(agentId);
        log.warn({ path, agentId, cycle }, 'Deadlock detected on write acquire (writer blocking)');
        throw new DeadlockError(cycle);
      }
      return false;
    }

    const acquired = this.locksRepo.acquire(path, agentId);
    if (!acquired) {
      log.debug({ path, agentId }, 'Write lock acquire failed at DB layer');
      this.recordWait(agentId, path);
      const cycle = this.detectDeadlock();
      if (cycle) {
        this.clearWait(agentId);
        log.warn({ path, agentId, cycle }, 'Deadlock detected on write acquire (DB layer failure)');
        throw new DeadlockError(cycle);
      }
      return false;
    }
    this.clearWait(agentId);
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
