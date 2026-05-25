import type { RawDB } from '../database/types.js';
import type { WorkspaceEvent } from './types.js';

export class EventStore {
  constructor(private db: RawDB) {}

  append(event: WorkspaceEvent): number {
    const { type, ...rest } = event;
    const result = this.db.prepare(
      'INSERT INTO event_log (type, payload, timestamp) VALUES (?, ?, ?)'
    ).run(type, JSON.stringify(rest), Date.now());
    return Number(result.lastInsertRowid);
  }

  getUnreplayed(limit = 100): Array<{ id: number; event: WorkspaceEvent }> {
    const rows = this.db.prepare(
      'SELECT id, type, payload, timestamp FROM event_log WHERE replayed = 0 ORDER BY id ASC LIMIT ?'
    ).all(limit) as Array<{ id: number; type: string; payload: string; timestamp: number }>;

    return rows.map(row => ({
      id: row.id,
      event: { type: row.type, ...JSON.parse(row.payload) } as WorkspaceEvent,
    }));
  }

  markReplayed(id: number): void {
    this.db.prepare('UPDATE event_log SET replayed = 1 WHERE id = ?').run(id);
  }

  getSince(afterId: number, type?: string, limit = 100): WorkspaceEvent[] {
    let rows: Array<{ type: string; payload: string }>;
    if (type) {
      rows = this.db.prepare(
        'SELECT type, payload FROM event_log WHERE id > ? AND type = ? ORDER BY id ASC LIMIT ?'
      ).all(afterId, type, limit) as Array<{ type: string; payload: string }>;
    } else {
      rows = this.db.prepare(
        'SELECT type, payload FROM event_log WHERE id > ? ORDER BY id ASC LIMIT ?'
      ).all(afterId, limit) as Array<{ type: string; payload: string }>;
    }

    return rows.map(row => ({ type: row.type, ...JSON.parse(row.payload) } as WorkspaceEvent));
  }

  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare(
      'DELETE FROM event_log WHERE replayed = 1 AND timestamp < ?'
    ).run(cutoff);
    return result.changes;
  }
}
