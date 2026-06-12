import type { RawDB } from '../database/types.js';
import type { EmbeddingService } from '../services/embedding.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('cognitive:similarity');

/**
 * Shared relevance primitives for the cognitive layer (memory stream,
 * reflection engine, skill library). One module so the cosine path, the
 * token-overlap fallback, and the companion vec0 storage convention live in a
 * single place (DRY).
 *
 * RELEVANCE STRATEGY
 * ------------------
 * Relevance is computed as **cosine similarity over embeddings** when an
 * {@link EmbeddingService} is wired in and a stored vector exists, and falls
 * back to **token (Jaccard) overlap** otherwise. The fallback mirrors the
 * grep-vs-vector degradation used elsewhere in the codebase: an offline /
 * unconfigured embedding backend never breaks retrieval, it just lowers the
 * relevance signal to lexical overlap.
 *
 * WRITE-TIME EMBEDDING (fire-and-forget)
 * --------------------------------------
 * The cognitive APIs (`observe`, `reflect`, skill `store`) are synchronous and
 * the existing suite depends on that. `EmbeddingService.generate` is async, so
 * we embed in the background — the same `Promise.resolve().then(...)` pattern
 * MemoryStream already uses for auto-reflection. The row is written
 * immediately; its vector lands shortly after. Retrieval reads whatever vector
 * is already present (a plain synchronous SELECT) and degrades to token overlap
 * for rows whose vector has not yet been computed.
 *
 * DIMENSION HAZARD
 * ----------------
 * Providers emit different widths (local MiniLM 384, Gemini/Ollama 768). Each
 * stored vector carries its `dimension` + `model_id`, and cosine is only
 * computed between same-dimension vectors. A query embedded by one provider
 * against a row embedded by another (different dimension) SKIPS the cosine path
 * and degrades to token overlap rather than comparing incompatible spaces and
 * returning garbage — mirroring the foundation's vec_documents gate.
 */

// ---------------------------------------------------------------------------
// Token overlap (offline fallback)
// ---------------------------------------------------------------------------

/** Lowercase, split on non-word chars, drop short tokens. */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter(word => word.length > 2),
  );
}

/**
 * Jaccard token overlap: |A ∩ B| / |A ∪ B|. Stable, dependency-free, and used
 * as the relevance term whenever an embedding-based score is unavailable.
 */
export function tokenOverlap(queryTokens: Set<string>, contentTokens: Set<string>): number {
  if (queryTokens.size === 0 || contentTokens.size === 0) return 0;
  let shared = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) shared++;
  }
  const union = new Set([...queryTokens, ...contentTokens]).size;
  return union === 0 ? 0 : shared / union;
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

/**
 * Cosine similarity in [-1, 1] (clamped here to [0, 1] for non-negative
 * relevance, matching the token-overlap range so the two are interchangeable in
 * the blend). Vectors of differing length return 0 — the dimension gate.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return cos < 0 ? 0 : cos > 1 ? 1 : cos;
}

// ---------------------------------------------------------------------------
// Companion vec0 storage for cognitive rows
// ---------------------------------------------------------------------------

/** A stored cognitive vector plus the metadata needed to gate cross-provider reads. */
export interface StoredVector {
  readonly embedding: Float32Array;
  readonly dimension: number;
  readonly modelId: string;
}

/**
 * Per-table companion vector store, mirroring the foundation's `vec_documents`
 * vec0 convention: a vec0 virtual table keyed by the owning row's id, carrying a
 * `dimension` partition key + `model_id`/`provider` aux columns so a provider
 * switch can never silently mix dimensions.
 *
 * The table width is fixed at 384 (the local MiniLM fallback dimension, the same
 * width the foundation pins `vec_documents` to). A wider provider vector (768)
 * is SKIPPED on write — re-embedding to a different width is a tracked migration,
 * not a silent runtime mix.
 *
 * Creation is idempotent (`IF NOT EXISTS`) and guarded: if the sqlite-vec
 * extension is not loaded on this connection, construction quietly disables the
 * store and the owning class degrades to token overlap.
 */
export const COGNITIVE_VECTOR_DIM = 384;

export class CognitiveVectorStore {
  private readonly enabled: boolean;
  private readonly table: string;

  constructor(
    private readonly db: RawDB,
    tableName: string,
  ) {
    // Defensive table-name guard: callers pass compile-time constants, never
    // user input, but keep the identifier strict since it is interpolated.
    if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) {
      throw new Error(`Invalid cognitive vector table name: ${tableName}`);
    }
    this.table = tableName;
    this.enabled = this.tryCreateTable();
  }

  /** Whether the vec0 backing store is usable on this connection. */
  isEnabled(): boolean {
    return this.enabled;
  }

  private tryCreateTable(): boolean {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table} USING vec0(
          id INTEGER PRIMARY KEY,
          dimension INTEGER partition key,
          embedding float[${COGNITIVE_VECTOR_DIM}] distance_metric=cosine,
          +model_id TEXT,
          +provider TEXT
        )
      `);
      return true;
    } catch (err) {
      // sqlite-vec not loaded (e.g. a bare connection) — disable the vector path.
      log.debug({ table: this.table, err: String(err) }, 'cognitive vector store disabled (vec0 unavailable)');
      return false;
    }
  }

  /**
   * Store (or replace) the vector for a row. vec0 has no UPSERT, so DELETE +
   * INSERT inside a transaction; INTEGER columns are bound as BigInt because
   * better-sqlite3 binds plain numbers as FLOAT, which vec0 rejects.
   * A vector whose width differs from the fixed table dimension is SKIPPED.
   */
  upsert(rowId: number, vec: StoredVector): void {
    if (!this.enabled) return;
    if (vec.embedding.length !== COGNITIVE_VECTOR_DIM) return;
    try {
      const del = this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`);
      const ins = this.db.prepare(`
        INSERT INTO ${this.table} (id, dimension, embedding, model_id, provider)
        VALUES (?, ?, ?, ?, ?)
      `);
      const run = this.db.transaction(() => {
        del.run(rowId);
        ins.run(
          BigInt(rowId),
          BigInt(vec.dimension),
          Buffer.from(vec.embedding.buffer, vec.embedding.byteOffset, vec.embedding.byteLength),
          vec.modelId,
          vec.modelId,
        );
      });
      run();
    } catch (err) {
      // A late provider/dimension change can race the table; never let a vector
      // write break the synchronous caller — it just falls back to token overlap.
      log.debug({ table: this.table, rowId, err: String(err) }, 'cognitive vector upsert skipped');
    }
  }

  /** Synchronous read of a stored vector, or undefined if none yet. */
  get(rowId: number): StoredVector | undefined {
    if (!this.enabled) return undefined;
    try {
      const row = this.db
        .prepare(`SELECT dimension, embedding, model_id FROM ${this.table} WHERE id = ?`)
        .get(rowId) as { dimension: number; embedding: Buffer; model_id: string } | undefined;
      if (!row) return undefined;
      return {
        dimension: row.dimension,
        modelId: row.model_id,
        embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
      };
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Write-time embedding helper (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Embed `content` in the background and persist it to `store` under `rowId`.
 * Synchronous callers fire this and return immediately; the vector lands
 * shortly after. Failures (offline backend, dimension mismatch) are swallowed —
 * retrieval simply degrades to token overlap for that row.
 *
 * Skipped entirely when no service is wired in or the store is disabled.
 */
export function embedRowInBackground(
  embedding: EmbeddingService | undefined,
  store: CognitiveVectorStore,
  rowId: number,
  content: string,
): void {
  if (!embedding || !store.isEnabled()) return;
  Promise.resolve()
    .then(async () => {
      const vector = await embedding.generate(content);
      const modelId = await embedding.getProviderName();
      store.upsert(rowId, { embedding: vector, dimension: vector.length, modelId });
    })
    .catch(err => {
      log.debug({ rowId, err: String(err) }, 'background cognitive embedding failed; retrieval will use token overlap');
    });
}

/**
 * Synchronous query-vector cache.
 *
 * Retrieval is synchronous but embedding is async, so a query vector cannot be
 * produced inline on the first call. The cache resolves this without changing
 * the API contract:
 *   - On a cache MISS, retrieval scores with token overlap AND kicks off a
 *     background embed of the query; the vector is cached for next time.
 *   - On a cache HIT (a repeated query — the common case for an agent revisiting
 *     a task), retrieval scores with cosine.
 * This is the same warm-cache degradation the foundation's search layer uses,
 * and it keeps the hot path synchronous and the existing suite green.
 *
 * The cache is keyed by `provider:text` so a provider/dimension switch cannot
 * return a stale, wrong-width query vector.
 */
const QUERY_CACHE_MAX = 256;
const queryVectorCache = new Map<string, Float32Array>();

function queryCacheKey(provider: string, text: string): string {
  return `${provider}:${text}`;
}

/**
 * Resolve a query vector synchronously from the warm cache, scheduling a
 * background embed on a miss. Returns `undefined` on a miss (caller falls back
 * to token overlap for this call). No-op when no service is wired in.
 */
export function resolveQueryVector(
  embedding: EmbeddingService | undefined,
  provider: string,
  text: string,
): Float32Array | undefined {
  if (!embedding) return undefined;
  const key = queryCacheKey(provider, text);
  const cached = queryVectorCache.get(key);
  if (cached) return cached;

  // Miss: warm the cache in the background for subsequent identical queries.
  Promise.resolve()
    .then(async () => {
      const vector = await embedding.generate(text);
      if (queryVectorCache.size >= QUERY_CACHE_MAX) {
        const oldest = queryVectorCache.keys().next().value;
        if (oldest !== undefined) queryVectorCache.delete(oldest);
      }
      queryVectorCache.set(key, vector);
    })
    .catch(err => {
      log.debug({ err: String(err) }, 'background query embedding failed');
    });
  return undefined;
}

/**
 * Resolve a synchronous query vector for retrieval scoring. Embedding is async,
 * but the only same-process synchronous source of a query vector is one the
 * caller already computed. Retrieval therefore prefers cosine **between stored
 * row vectors** (query row vs candidate rows) and uses this when a query vector
 * is supplied; otherwise the caller falls back to token overlap. Returning a
 * cached/precomputed vector keeps the hot retrieval path synchronous.
 */
export function relevanceScore(
  queryVector: Float32Array | undefined,
  candidate: StoredVector | undefined,
  queryTokens: Set<string>,
  candidateText: string,
): number {
  // Cosine path: both sides present AND same dimension (cross-provider gate).
  if (queryVector && candidate && queryVector.length === candidate.dimension) {
    return cosineSimilarity(queryVector, candidate.embedding);
  }
  // Offline / not-yet-embedded / dimension-mismatch → lexical fallback.
  return tokenOverlap(queryTokens, tokenize(candidateText));
}
