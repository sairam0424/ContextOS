import type { RawDB, MissionRecord } from './types.js';

export class MissionsRepository {
  constructor(private db: RawDB) {}

  create(title: string, path: string, priority: number = 1, dueAt?: number, metadata?: string): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO missions (title, path, priority, due_at, metadata)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `);
    return stmt.get(title, path, priority, dueAt ?? null, metadata ?? '{}') as { id: number };
  }

  list(status?: string): MissionRecord[] {
    if (status) {
      return this.db.prepare(`SELECT * FROM missions WHERE status = ? ORDER BY priority DESC`).all(status) as MissionRecord[];
    }
    return this.db.prepare(`SELECT * FROM missions ORDER BY priority DESC`).all() as MissionRecord[];
  }

  updateStatus(path: string, status: string): void {
    this.db.prepare(`UPDATE missions SET status = ? WHERE path = ?`).run(status, path);
  }

  getAll(): MissionRecord[] {
    return this.db.prepare(`SELECT * FROM missions`).all() as MissionRecord[];
  }
}
