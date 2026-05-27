import type { RawDB, LockRecord } from './types.js';

export class LocksRepository {
  constructor(private db: RawDB) {}

  acquire(path: string, agentId: string, durationMs: number = 300000, mode: 'read' | 'write' = 'write'): boolean {
    const now = Date.now();
    const expiresAt = now + durationMs;

    // Clean expired locks on this path first
    this.db.prepare(`DELETE FROM locks WHERE path = ? AND expires_at < ?`).run(path, now);

    if (mode === 'write') {
      // Write lock: reject if ANY lock by another agent exists on this path
      const blocker = this.db.prepare(
        `SELECT agent_id, mode FROM locks WHERE path = ? AND agent_id != ?`
      ).get(path, agentId) as { agent_id: string; mode: string } | undefined;
      if (blocker) return false;

      // Upsert write lock for this agent (INSERT OR REPLACE on composite PK)
      this.db.prepare(`
        INSERT INTO locks (path, agent_id, mode, expires_at, created_at)
        VALUES (?, ?, 'write', ?, ?)
        ON CONFLICT(path, agent_id, mode) DO UPDATE SET
          expires_at = excluded.expires_at
      `).run(path, agentId, expiresAt, now);
      return true;
    }

    // Read lock: reject only if a WRITE lock by another agent exists
    const writeBlocker = this.db.prepare(
      `SELECT agent_id FROM locks WHERE path = ? AND mode = 'write' AND agent_id != ?`
    ).get(path, agentId) as { agent_id: string } | undefined;
    if (writeBlocker) return false;

    // Insert read lock (composite PK allows multiple readers with different agent_ids)
    this.db.prepare(`
      INSERT INTO locks (path, agent_id, mode, expires_at, created_at)
      VALUES (?, ?, 'read', ?, ?)
      ON CONFLICT(path, agent_id, mode) DO UPDATE SET
        expires_at = excluded.expires_at
    `).run(path, agentId, expiresAt, now);
    return true;
  }

  release(path: string, agentId: string): void {
    this.db.prepare(`DELETE FROM locks WHERE path = ? AND agent_id = ?`).run(path, agentId);
  }

  releaseWrite(path: string, agentId: string): void {
    this.db.prepare(`DELETE FROM locks WHERE path = ? AND agent_id = ? AND mode = 'write'`).run(path, agentId);
  }

  releaseRead(path: string, agentId: string): void {
    this.db.prepare(`DELETE FROM locks WHERE path = ? AND agent_id = ? AND mode = 'read'`).run(path, agentId);
  }

  get(path: string): LockRecord | undefined {
    const now = Date.now();
    const lock = this.db.prepare(
      `SELECT path, agent_id, mode, expires_at, created_at FROM locks WHERE path = ? AND mode = 'write' AND expires_at >= ?`
    ).get(path, now) as LockRecord | undefined;
    return lock;
  }

  getWrite(path: string): LockRecord | undefined {
    return this.get(path);
  }

  getReaders(path: string): string[] {
    const now = Date.now();
    // Clean expired read locks
    this.db.prepare(`DELETE FROM locks WHERE path = ? AND mode = 'read' AND expires_at < ?`).run(path, now);
    const rows = this.db.prepare(
      `SELECT agent_id FROM locks WHERE path = ? AND mode = 'read' AND expires_at >= ?`
    ).all(path, now) as Array<{ agent_id: string }>;
    return rows.map(r => r.agent_id);
  }

  isLocked(path: string): boolean {
    const now = Date.now();
    const row = this.db.prepare(
      `SELECT 1 FROM locks WHERE path = ? AND expires_at >= ?`
    ).get(path, now);
    return !!row;
  }

  hasReadLocks(path: string): number {
    const now = Date.now();
    const result = this.db.prepare(
      `SELECT COUNT(*) as count FROM locks WHERE path = ? AND mode = 'read' AND expires_at >= ?`
    ).get(path, now) as { count: number };
    return result.count;
  }

  hasWriteLock(path: string, excludeAgent?: string): boolean {
    const now = Date.now();
    if (excludeAgent) {
      const row = this.db.prepare(
        `SELECT 1 FROM locks WHERE path = ? AND mode = 'write' AND expires_at >= ? AND agent_id != ?`
      ).get(path, now, excludeAgent);
      return !!row;
    }
    const row = this.db.prepare(
      `SELECT 1 FROM locks WHERE path = ? AND mode = 'write' AND expires_at >= ?`
    ).get(path, now);
    return !!row;
  }

  cleanExpired(): number {
    const now = Date.now();
    const result = this.db.prepare(`DELETE FROM locks WHERE expires_at < ?`).run(now);
    return result.changes;
  }
}
