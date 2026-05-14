import type { RawDB, DBRecord } from './types.js';

export class DocumentsRepository {
  constructor(private db: RawDB) {}

  upsert(record: Omit<DBRecord, 'id'>): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO documents (path, title, content, excerpt, mtime, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        excerpt = excluded.excerpt,
        mtime = excluded.mtime,
        metadata = excluded.metadata
      RETURNING id
    `);
    return stmt.get(record.path, record.title, record.content, record.excerpt, record.mtime, record.metadata) as { id: number };
  }

  updateStatus(path: string, status: string): void {
    this.db.prepare(`UPDATE documents SET status = ? WHERE path = ?`).run(status, path);
  }

  setIntelligenceStatus(docId: number, status: 'pending' | 'processing' | 'ready' | 'failed'): void {
    this.db.prepare(`UPDATE documents SET intelligence_status = ? WHERE id = ?`).run(status, docId);
  }

  getById(id: number): DBRecord | undefined {
    return this.db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DBRecord | undefined;
  }

  getByPath(filePath: string): DBRecord | undefined {
    return this.db.prepare(`SELECT * FROM documents WHERE path = ?`).get(filePath) as DBRecord | undefined;
  }

  remove(filePath: string): void {
    this.db.prepare(`DELETE FROM documents WHERE path = ?`).run(filePath);
  }

  getAll(): DBRecord[] {
    return this.db.prepare(`SELECT * FROM documents`).all() as DBRecord[];
  }
}
