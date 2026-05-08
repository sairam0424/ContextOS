import type { RawDB, LockRecord } from './types.js';

export class LocksRepository {
  constructor(private db: RawDB) {}

  acquire(path: string, agentId: string, durationMs: number = 300000): void {
    const expiresAt = Date.now() + durationMs;
    this.db.prepare(`
      INSERT INTO locks (path, agent_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        agent_id = excluded.agent_id,
        expires_at = excluded.expires_at
      WHERE locks.expires_at < ? OR locks.agent_id = ?
    `).run(path, agentId, expiresAt, Date.now(), Date.now(), agentId);
  }

  release(path: string, agentId: string): void {
    this.db.prepare(`DELETE FROM locks WHERE path = ? AND agent_id = ?`).run(path, agentId);
  }

  get(path: string): LockRecord | undefined {
    const lock = this.db.prepare(`SELECT * FROM locks WHERE path = ?`).get(path) as LockRecord | undefined;
    if (lock && lock.expires_at < Date.now()) {
      this.db.prepare(`DELETE FROM locks WHERE path = ?`).run(path);
      return undefined;
    }
    return lock;
  }
}
