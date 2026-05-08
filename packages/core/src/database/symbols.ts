import type { RawDB } from './types.js';

export class SymbolsRepository {
  constructor(private db: RawDB) {}

  upsert(name: string, filePath: string, line: number, type: string, signature: string, hash: string): void {
    this.db.prepare(`
      INSERT INTO symbols (name, path, line, type, signature, hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name, path) DO UPDATE SET
        line = excluded.line,
        type = excluded.type,
        signature = excluded.signature,
        hash = excluded.hash
    `).run(name, filePath, line, type, signature, hash);
  }

  removeForPath(filePath: string): void {
    this.db.prepare(`DELETE FROM symbols WHERE path = ?`).run(filePath);
  }

  getByName(name: string): any | undefined {
    return this.db.prepare(`SELECT * FROM symbols WHERE name = ?`).get(name);
  }

  getAll(): any[] {
    return this.db.prepare(`SELECT * FROM symbols`).all();
  }
}
