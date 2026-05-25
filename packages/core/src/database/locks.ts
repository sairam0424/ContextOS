import type { RawDB, LockRecord } from './types.js';

export class LocksRepository {
  constructor(private db: RawDB) {}

  acquire(path: string, agentId: string, durationMs: number = 300000, mode: 'read' | 'write' = 'write'): boolean {
    const now = Date.now();
    const expiresAt = now + durationMs;

    if (mode === 'write') {
      // Write lock: reject if ANY non-expired lock by another agent exists
      const existing = this.db.prepare(
        `SELECT agent_id, mode FROM locks WHERE path = ? AND expires_at >= ? AND agent_id != ?`
      ).get(path, now, agentId) as any | undefined;
      if (existing) return false;

      // Upsert: replace our own lock or insert new
      const result = this.db.prepare(`
        INSERT INTO locks (path, agent_id, expires_at, created_at, mode)
        VALUES (?, ?, ?, ?, 'write')
        ON CONFLICT(path) DO UPDATE SET
          agent_id = excluded.agent_id,
          expires_at = excluded.expires_at,
          mode = 'write'
        WHERE locks.expires_at < ? OR locks.agent_id = ?
      `).run(path, agentId, expiresAt, now, now, agentId);
      return result.changes > 0;
    }

    // Read lock: reject only if a WRITE lock by another agent exists
    const writeHolder = this.db.prepare(
      `SELECT agent_id FROM locks WHERE path = ? AND expires_at >= ? AND agent_id != ? AND mode = 'write'`
    ).get(path, now, agentId) as any | undefined;
    if (writeHolder) return false;

    // For read locks we need to allow multiple readers. Since locks has a PRIMARY KEY on path,
    // we use a composite key of path + agent_id for read locks by encoding into path column.
    // Actually the table has PRIMARY KEY on path alone, so we need a different approach:
    // Insert with a composite path key for reads: path + '#read:' + agentId
    const readKey = `${path}#read:${agentId}`;
    this.db.prepare(`
      INSERT OR REPLACE INTO locks (path, agent_id, expires_at, created_at, mode)
      VALUES (?, ?, ?, ?, 'read')
    `).run(readKey, agentId, expiresAt, now);
    return true;
  }

  release(path: string, agentId: string): void {
    // Release exact path lock (write lock or legacy)
    this.db.prepare(`DELETE FROM locks WHERE path = ? AND agent_id = ?`).run(path, agentId);
    // Also release read lock keyed entry
    const readKey = `${path}#read:${agentId}`;
    this.db.prepare(`DELETE FROM locks WHERE path = ?`).run(readKey);
  }

  get(path: string): LockRecord | undefined {
    const lock = this.db.prepare(`SELECT * FROM locks WHERE path = ? AND mode = 'write'`).get(path) as LockRecord | undefined;
    if (lock && lock.expires_at < Date.now()) {
      this.db.prepare(`DELETE FROM locks WHERE path = ? AND mode = 'write'`).run(path);
      return undefined;
    }
    return lock;
  }

  getReaders(path: string): string[] {
    const now = Date.now();
    // Clean expired read locks
    this.db.prepare(`DELETE FROM locks WHERE path LIKE ? AND mode = 'read' AND expires_at < ?`)
      .run(`${path}#read:%`, now);
    const rows = this.db.prepare(
      `SELECT agent_id FROM locks WHERE path LIKE ? AND mode = 'read' AND expires_at >= ?`
    ).all(`${path}#read:%`, now) as Array<{ agent_id: string }>;
    return rows.map(r => r.agent_id);
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
}
