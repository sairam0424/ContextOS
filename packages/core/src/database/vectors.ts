import { createHash } from 'node:crypto';
import type { RawDB } from './types.js';

const CACHE_MAX_SIZE = 100;
const searchCache = new Map<string, { result: any; timestamp: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCacheKey(queryText: string, limit: number, offset: number, includePrivate: boolean, providerName?: string): string {
  const prefix = providerName ? `${providerName}:` : '';
  return createHash('md5').update(`${prefix}${queryText}:${limit}:${offset}:${includePrivate}`).digest('hex');
}

function pruneCache(): void {
  if (searchCache.size <= CACHE_MAX_SIZE) return;
  const entries = Array.from(searchCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
  const toRemove = entries.slice(0, entries.length - CACHE_MAX_SIZE);
  for (const [key] of toRemove) searchCache.delete(key);
}

/**
 * Sanitizes a user-provided query string for safe use with FTS5 MATCH.
 * Removes FTS5 operators, wildcards, and column prefixes, then wraps
 * each remaining token in double quotes.
 */
function sanitizeFTS5(query: string): string {
  let sanitized = query
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')
    .replace(/\*/g, '')
    .replace(/\w+:/g, '');

  const tokens = sanitized
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (tokens.length === 0) return '';

  return tokens
    .map(t => '"' + t.replace(/"/g, '""') + '"')
    .join(' ');
}

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

  searchHybrid(queryEmbedding: Float32Array, queryText: string, limit: number = 10, includePrivate: boolean = false, offset: number = 0, providerName?: string) {
    const cacheKey = getCacheKey(queryText, limit, offset, includePrivate, providerName);
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }

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

    const sanitizedQuery = sanitizeFTS5(queryText);
    const keywordStmt = this.db.prepare(`
      SELECT d.id, d.path, d.title, d.excerpt, rank
      FROM fts_documents fts
      JOIN documents d ON fts.rowid = d.id
      WHERE fts_documents MATCH ? AND d.status = 'active' ${privateFilter}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `);
    const keywordResults = sanitizedQuery
      ? keywordStmt.all(sanitizedQuery, limit, offset) as any[]
      : [];

    const combined = this.fuseResults(semanticResults, keywordResults, limit);
    const result = { semanticResults, keywordResults, combined };
    searchCache.set(cacheKey, { result, timestamp: Date.now() });
    pruneCache();
    return result;
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
