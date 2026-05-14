import type { RawDB, QueueItem } from './types.js';

export class QueueRepository {
  constructor(private db: RawDB) {}

  add(docId: number, priority: number = 1): void {
    this.db.prepare(`
      INSERT INTO intelligence_queue (doc_id, priority)
      VALUES (?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET priority = excluded.priority
    `).run(docId, priority);
  }

  getNext(): QueueItem | undefined {
    return this.db.prepare(`SELECT id, doc_id FROM intelligence_queue ORDER BY priority DESC, id ASC LIMIT 1`).get() as QueueItem | undefined;
  }

  getBatch(n: number): QueueItem[] {
    return this.db.prepare(`SELECT id, doc_id FROM intelligence_queue ORDER BY priority DESC, id ASC LIMIT ?`).all(n) as QueueItem[];
  }

  remove(id: number): void {
    this.db.prepare(`DELETE FROM intelligence_queue WHERE id = ?`).run(id);
  }

  incrementRetry(id: number, errorMsg: string): void {
    this.db.prepare(`UPDATE intelligence_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`).run(errorMsg, id);
  }

  getRetryCount(id: number): number {
    const row = this.db.prepare(`SELECT retry_count FROM intelligence_queue WHERE id = ?`).get(id) as { retry_count: number } | undefined;
    return row?.retry_count ?? 0;
  }

  getFailedCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM documents WHERE intelligence_status = 'failed'`).get() as { count: number };
    return row.count;
  }
}
