import type { RawDB } from './types.js';

export class VectorsRepository {
  constructor(private db: RawDB) {}

  upsert(docId: number, embedding: Float32Array, provider: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO vec_documents (id, embedding, provider, dimension)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        embedding = excluded.embedding,
        provider = excluded.provider,
        dimension = excluded.dimension
    `);
    stmt.run(docId, Buffer.from(embedding.buffer), provider, embedding.length);
  }

  getForDocument(docId: number): Float32Array | undefined {
    const row = this.db.prepare('SELECT embedding FROM vec_documents WHERE id = ?').get(docId) as { embedding: Buffer } | undefined;
    if (!row) return undefined;
    return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
  }

  getDimension(docId: number): number | undefined {
    const row = this.db.prepare('SELECT dimension FROM vec_documents WHERE id = ?').get(docId) as { dimension: number } | undefined;
    return row?.dimension;
  }

  searchSemantic(queryEmbedding: Float32Array, limit: number = 10): any[] {
    const stmt = this.db.prepare(`
      SELECT
        d.id, d.path, d.title, d.excerpt,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE v.dimension = ?
      ORDER BY distance ASC
      LIMIT ?
    `);
    return stmt.all(Buffer.from(queryEmbedding.buffer), queryEmbedding.length, limit) as any[];
  }

  getTopKNeighbors(docId: number, k: number = 3): any[] {
    const embedding = this.getForDocument(docId);
    if (!embedding) return [];

    const stmt = this.db.prepare(`
      SELECT
        d.path, d.title,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE d.id != ? AND v.dimension = ?
      ORDER BY distance ASC
      LIMIT ?
    `);

    return stmt.all(Buffer.from(embedding.buffer), docId, embedding.length, k) as any[];
  }

  searchHybrid(queryEmbedding: Float32Array, queryText: string, limit: number = 10, includePrivate: boolean = false, offset: number = 0) {
    const privateFilter = includePrivate ? '' : 'AND d.is_private = 0';

    const semanticStmt = this.db.prepare(`
      SELECT
        d.id, d.path, d.title, d.excerpt,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE d.status = 'active' AND v.dimension = ? ${privateFilter}
      ORDER BY distance ASC
      LIMIT ? OFFSET ?
    `);
    const semanticResults = semanticStmt.all(
      Buffer.from(queryEmbedding.buffer), queryEmbedding.length, limit, offset
    ) as any[];

    const safeQuery = queryText.replace(/"/g, '""');
    const keywordStmt = this.db.prepare(`
      SELECT d.id, d.path, d.title, d.excerpt, rank
      FROM fts_documents fts
      JOIN documents d ON fts.rowid = d.id
      WHERE fts_documents MATCH ? AND d.status = 'active' ${privateFilter}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `);
    const keywordResults = keywordStmt.all('"' + safeQuery + '"', limit, offset) as any[];

    const combined = this.fuseResults(semanticResults, keywordResults, limit);
    return { semanticResults, keywordResults, combined };
  }

  private fuseResults(semantic: any[], keyword: any[], limit: number): any[] {
    const scores = new Map<string, { score: number; record: any }>();

    semantic.forEach((r, i) => {
      const score = (1 - r.distance) * 0.7 + (1 / (i + 1)) * 0.3;
      scores.set(r.path, { score, record: r });
    });

    keyword.forEach((r, i) => {
      const score = (1 / (i + 1)) * 0.5;
      const existing = scores.get(r.path);
      if (existing) {
        existing.score += score;
      } else {
        scores.set(r.path, { score, record: r });
      }
    });

    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(v => ({ ...v.record, fusedScore: v.score }));
  }
}
