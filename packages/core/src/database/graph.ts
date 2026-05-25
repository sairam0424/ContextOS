import type { RawDB } from './types.js';

export class GraphRepository {
  constructor(private db: RawDB) {}

  getVersion(): number {
    const row = this.db.prepare(`SELECT value FROM graph_metadata WHERE key = 'graph_version'`).get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  bumpVersion(): void {
    this.db.prepare(`UPDATE graph_metadata SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'graph_version'`).run();
  }

  upsertEdge(source: string, target: string, type: string, weight: number): void {
    this.db.prepare(`
      INSERT INTO edges (source, target, type, weight)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source, target, type) DO UPDATE SET weight = excluded.weight
    `).run(source, target, type, weight);
    this.bumpVersion();
  }

  removeEdgesForSource(source: string): void {
    this.db.prepare(`DELETE FROM edges WHERE source = ?`).run(source);
    this.bumpVersion();
  }

  removeEdgesForSourceByType(source: string, type: string): void {
    this.db.prepare(`DELETE FROM edges WHERE source = ? AND type = ?`).run(source, type);
    this.bumpVersion();
  }

  removeEdge(source: string, target: string, type: string): void {
    this.db.prepare(`DELETE FROM edges WHERE source = ? AND target = ? AND type = ?`).run(source, target, type);
    this.bumpVersion();
  }

  getAll(): any[] {
    return this.db.prepare(`SELECT * FROM edges`).all();
  }

  getAffinities(nodePath: string, maxHops: number = 3, minWeight: number = 0.05, maxResults: number = 100): Map<string, number> {
    const stmt = this.db.prepare(`
      WITH RECURSIVE walk(node, depth, weight) AS (
        SELECT target, 1, weight FROM edges WHERE source = ?
        UNION ALL
        SELECT e.target, w.depth + 1, w.weight * e.weight * 0.4
        FROM walk w
        JOIN edges e ON e.source = w.node
        WHERE w.depth < ? AND w.weight * e.weight * 0.4 > ?
      )
      SELECT node, MAX(weight) as affinity FROM walk GROUP BY node
      ORDER BY affinity DESC
      LIMIT ?
    `);

    const rows = stmt.all(nodePath, maxHops, minWeight, maxResults) as any[];
    const affinities = new Map<string, number>();
    rows.forEach(r => affinities.set(r.node, r.affinity));
    return affinities;
  }
}
