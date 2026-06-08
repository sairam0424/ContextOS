import { createHash } from 'node:crypto';
import type { RawDB } from './types.js';
import { rrf, type RankedList } from './fusion.js';

/**
 * Physical embedding width of the vec0 `vec_documents` table (`embedding
 * float[384]`). vec0 rejects any query/insert vector whose length differs from
 * this, so the repository gates on it: a mismatched vector (e.g. a 768-dim
 * Gemini/Ollama embedding against this 384-dim local-model table) is SKIPPED —
 * reads return empty and writes no-op — rather than throwing or comparing
 * incompatible spaces and returning garbage. A provider switch to 768 dims is a
 * tracked re-embed migration, not a silent runtime mix.
 */
const STORED_EMBEDDING_DIM = 384;

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
    // vec0 has no UPSERT; emulate it with DELETE + INSERT inside a transaction
    // so a re-embed never leaves the row half-written. vec0 INTEGER columns
    // (the `id` PRIMARY KEY and the `dimension` partition key) must be bound as
    // BigInt — better-sqlite3 binds plain JS numbers as FLOAT, which vec0
    // rejects on write. `model_id` mirrors `provider` (1:1 today); both are
    // stored so cross-provider reads can be gated.
    //
    // Dimension gate: the table is fixed at float[384]; a vector of any other
    // width (e.g. a 768-dim provider) cannot be stored here. Skip rather than
    // throw — re-embedding to a different dimension is a tracked migration.
    if (embedding.length !== STORED_EMBEDDING_DIM) return;
    const del = this.db.prepare('DELETE FROM vec_documents WHERE id = ?');
    const ins = this.db.prepare(`
      INSERT INTO vec_documents (id, dimension, embedding, model_id, provider)
      VALUES (?, ?, ?, ?, ?)
    `);
    const run = this.db.transaction(() => {
      del.run(docId);
      ins.run(BigInt(docId), BigInt(embedding.length), Buffer.from(embedding.buffer), provider, provider);
    });
    run();
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
    // Empty query vector (embedding backend unavailable) → no semantic results.
    // A wrong-dimension query vector (cross-provider mismatch) also SKIPS:
    // comparing 768-dim against this 384-dim table is meaningless, so we return
    // empty rather than letting vec0 throw on the dimension mismatch.
    if (queryEmbedding.length !== STORED_EMBEDDING_DIM) return [];
    // vec0 KNN: `embedding MATCH ? AND k = ?`. The `dimension` partition-key
    // filter further gates stored rows to the querying dimension. `distance` is
    // cosine distance (0 = identical, 1 = orthogonal).
    const stmt = this.db.prepare(`
      SELECT
        d.id, d.path, d.title, d.excerpt,
        v.distance as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE v.embedding MATCH ? AND k = ? AND v.dimension = ?
      ORDER BY v.distance ASC
      LIMIT ?
    `);
    return stmt.all(
      Buffer.from(queryEmbedding.buffer), limit, queryEmbedding.length, limit,
    ) as any[];
  }

  getTopKNeighbors(docId: number, k: number = 3): any[] {
    const embedding = this.getForDocument(docId);
    if (!embedding) return [];

    // Over-fetch by one then drop self, since the doc's own vector is its
    // nearest neighbour (distance 0). Same dimension gate as searchSemantic.
    const stmt = this.db.prepare(`
      SELECT
        d.id, d.path, d.title,
        v.distance as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE v.embedding MATCH ? AND k = ? AND v.dimension = ?
      ORDER BY v.distance ASC
    `);

    const rows = stmt.all(
      Buffer.from(embedding.buffer), k + 1, embedding.length,
    ) as any[];

    return rows.filter((r) => r.id !== docId).slice(0, k);
  }

  searchHybrid(queryEmbedding: Float32Array, queryText: string, limit: number = 10, includePrivate: boolean = false, offset: number = 0, providerName?: string) {
    const cacheKey = getCacheKey(queryText, limit, offset, includePrivate, providerName);
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }

    const privateFilter = includePrivate ? '' : 'AND d.is_private = 0';

    // vec0 KNN returns the k nearest by vector distance, then the JOIN-side
    // predicates (status / privacy) prune them. Over-fetch (limit + offset
    // plus a margin) so post-JOIN pruning still leaves enough rows to satisfy
    // the requested window. Empty OR wrong-dimension query vector → skip the
    // semantic leg entirely and degrade to keyword-only (FTS5) results.
    const knnK = limit + offset + 10;
    const semanticUsable = queryEmbedding.length === STORED_EMBEDDING_DIM;
    const semanticStmt = this.db.prepare(`
      SELECT
        d.id, d.path, d.title, d.excerpt,
        v.distance as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE v.embedding MATCH ? AND k = ? AND v.dimension = ?
        AND d.status = 'active' ${privateFilter}
      ORDER BY v.distance ASC
      LIMIT ? OFFSET ?
    `);
    const semanticResults = semanticUsable
      ? semanticStmt.all(
          Buffer.from(queryEmbedding.buffer), knnK, queryEmbedding.length, limit, offset,
        ) as any[]
      : [];

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
    // Canonical Reciprocal Rank Fusion (DRY: same helper as fusion-scoring.ts).
    // Both lists are already sorted best-first — semantic by ascending cosine
    // distance, keyword by FTS5 rank — so RRF needs only their ordering, not the
    // (incomparable) raw scores the old magic-weight formula tried to blend.
    const lists: RankedList<any>[] = [
      { items: semantic, key: (r) => r.path },
      { items: keyword, key: (r) => r.path },
    ];

    return rrf(lists)
      .slice(0, limit)
      // Preserve the public `fusedScore` field consumers read downstream.
      .map((entry) => ({ ...entry.record, fusedScore: entry.rrfScore }));
  }
}
