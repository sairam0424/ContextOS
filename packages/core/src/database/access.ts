import type { RawDB, AccessLogEntry } from './types.js';

function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

export class AccessRepository {
  constructor(private db: RawDB) {}

  log(path: string, action: 'read' | 'write' | 'focus'): void {
    this.db.prepare(`INSERT INTO access_log (path, action) VALUES (?, ?)`).run(path, action);
  }

  getPathHeat(path: string, windowMs: number = 3600000): number {
    const cutoff = Date.now() - windowMs;
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM access_log WHERE path = ? AND timestamp > ?`).get(path, cutoff) as { count: number };
    return row.count;
  }

  prune(maxAgeMs: number = 86400000): void {
    const cutoff = Date.now() - maxAgeMs;
    this.db.prepare(`DELETE FROM access_log WHERE timestamp < ?`).run(cutoff);
  }

  getLog(limit: number = 50, pathFilter?: string): AccessLogEntry[] {
    if (pathFilter) {
      const escaped = escapeLikePattern(pathFilter);
      return this.db.prepare(
        `SELECT * FROM access_log WHERE path LIKE ? ESCAPE '\\' ORDER BY timestamp DESC LIMIT ?`
      ).all(`%${escaped}%`, limit) as AccessLogEntry[];
    }
    return this.db.prepare(`SELECT * FROM access_log ORDER BY timestamp DESC LIMIT ?`).all(limit) as AccessLogEntry[];
  }
}
