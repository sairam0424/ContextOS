import * as sqliteVec from 'sqlite-vec';
import type { RawDB } from '../database/types.js';
import type { EmbeddingService } from './embedding.js';

export interface Community {
  readonly id: number;
  readonly level: number;
  readonly nodeIds: readonly string[];
  readonly summary: string;
  readonly parentCommunityId: number | null;
  readonly modularity: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CommunitySearchResult {
  readonly community: Community;
  readonly relevanceScore: number;
}

export interface GraphRAGResult {
  readonly globalAnswer: string;
  readonly communities: readonly CommunitySearchResult[];
  readonly localDetails: readonly { nodeId: string; relevance: number }[];
}

interface CommunityRow {
  id: number;
  level: number;
  node_ids: string;
  summary: string;
  parent_community_id: number | null;
  modularity: number;
  created_at: number;
  updated_at: number;
}

/**
 * Physical embedding width of the `vec_community_summaries` vec0 table
 * (`embedding float[384]`). Mirrors the `vec_documents` foundation contract:
 * vec0 rejects any vector whose length differs from this, so a mismatched
 * vector (e.g. a 768-dim Gemini/Ollama embedding against this 384-dim
 * local-model table) is SKIPPED — community embed-writes no-op and semantic
 * search degrades to the lexical fallback — rather than comparing
 * incompatible spaces and ranking garbage. Switching the active provider to a
 * 768-dim model is a tracked re-embed migration, not a silent runtime mix.
 */
const STORED_EMBEDDING_DIM = 384;

function rowToCommunity(row: CommunityRow): Community {
  return {
    id: row.id,
    level: row.level,
    nodeIds: JSON.parse(row.node_ids) as string[],
    summary: row.summary,
    parentCommunityId: row.parent_community_id,
    modularity: row.modularity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lexical fallback used only when no embedding backend is available (or the
 * active provider's dimension does not match the stored vec0 width, or no
 * community has an embedding yet). Substring token-overlap — the original
 * O(n) behaviour, preserved verbatim so search never returns empty just
 * because vectors are unavailable.
 */
function computeTextOverlap(query: string, text: string): number {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (queryTokens.length === 0) return 0;
  const textLower = text.toLowerCase();
  const matchCount = queryTokens.filter(token => textLower.includes(token)).length;
  return matchCount / queryTokens.length;
}

export class GraphRAGService {
  private readonly db: RawDB;
  private readonly embedding: EmbeddingService | null;
  private vecReady = false;

  constructor(db: RawDB, embedding?: EmbeddingService) {
    this.db = db;
    this.embedding = embedding ?? null;
  }

  /**
   * Idempotently create the community vec0 store. Keyed on
   * `community_summaries.id` — a SEPARATE table from `vec_documents` because
   * community summaries are not documents (sharing `vec_documents` would
   * collide PKs with real docs and break its JOIN to `documents`). Mirrors the
   * foundation's hazard-gating: `dimension` is a partition key and
   * `model_id`/`provider` are stored so a 384-vs-768 mismatch can SKIP rather
   * than return garbage. distance_metric=cosine preserves cosine semantics
   * (0 = identical, 1 = orthogonal). sqlite-vec is loaded defensively in case
   * the connection was built without it.
   */
  private ensureVecTable(): void {
    if (this.vecReady) return;
    sqliteVec.load(this.db);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_community_summaries USING vec0(
        id INTEGER PRIMARY KEY,
        dimension INTEGER partition key,
        embedding float[${STORED_EMBEDDING_DIM}] distance_metric=cosine,
        +model_id TEXT,
        +provider TEXT
      )
    `);
    this.vecReady = true;
  }

  /**
   * Embed `summary` and upsert it into the community vec0 store. Best-effort:
   * any failure (no backend, provider error, dimension mismatch) is swallowed
   * so the relational write that triggered it still succeeds — search simply
   * falls back to lexical for that community until a later re-embed.
   *
   * vec0 has no UPSERT, so DELETE + INSERT runs inside a transaction. vec0
   * INTEGER columns (the `id` PK and `dimension` partition key) must be bound
   * as BigInt — better-sqlite3 binds plain numbers as FLOAT, which vec0
   * rejects on write.
   */
  private async embedCommunity(communityId: number, summary: string): Promise<void> {
    if (!this.embedding) return;
    try {
      this.ensureVecTable();
      const vector = await this.embedding.generate(summary);
      // Dimension gate: the table is fixed at float[384]; a vector of any
      // other width (e.g. a 768-dim provider) cannot be stored here. Skip
      // rather than throw — re-embedding to a different dimension is a tracked
      // migration, not a silent runtime mix.
      if (vector.length !== STORED_EMBEDDING_DIM) return;
      const provider = await this.embedding.getProviderName();
      const del = this.db.prepare('DELETE FROM vec_community_summaries WHERE id = ?');
      const ins = this.db.prepare(`
        INSERT INTO vec_community_summaries (id, dimension, embedding, model_id, provider)
        VALUES (?, ?, ?, ?, ?)
      `);
      const run = this.db.transaction(() => {
        del.run(communityId);
        ins.run(BigInt(communityId), BigInt(vector.length), Buffer.from(vector.buffer), provider, provider);
      });
      run();
    } catch {
      // Embedding unavailable / provider failure — degrade silently to lexical.
    }
  }

  async storeCommunity(opts: {
    level: number;
    nodeIds: string[];
    summary: string;
    parentCommunityId?: number;
    modularity?: number;
  }): Promise<Community> {
    const now = Date.now();
    const nodeIdsJson = JSON.stringify(opts.nodeIds);
    const modularity = opts.modularity ?? 0;
    const parentCommunityId = opts.parentCommunityId ?? null;

    const result = this.db.prepare(`
      INSERT INTO community_summaries (level, node_ids, summary, parent_community_id, modularity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(opts.level, nodeIdsJson, opts.summary, parentCommunityId, modularity, now, now);

    const id = Number(result.lastInsertRowid);
    await this.embedCommunity(id, opts.summary);

    return {
      id,
      level: opts.level,
      nodeIds: opts.nodeIds,
      summary: opts.summary,
      parentCommunityId,
      modularity,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateSummary(communityId: number, summary: string): Promise<void> {
    const now = Date.now();
    this.db.prepare(`
      UPDATE community_summaries SET summary = ?, updated_at = ? WHERE id = ?
    `).run(summary, now, communityId);
    await this.embedCommunity(communityId, summary);
  }

  getCommunities(level?: number): Community[] {
    if (level !== undefined) {
      const rows = this.db.prepare(`
        SELECT * FROM community_summaries WHERE level = ?
      `).all(level) as CommunityRow[];
      return rows.map(rowToCommunity);
    }

    const rows = this.db.prepare(`
      SELECT * FROM community_summaries
    `).all() as CommunityRow[];
    return rows.map(rowToCommunity);
  }

  getCommunityForNode(nodeId: string): Community | null {
    const row = this.db.prepare(`
      SELECT * FROM community_summaries WHERE node_ids LIKE ?
    `).get(`%"${nodeId}"%`) as CommunityRow | undefined;

    if (!row) return null;
    return rowToCommunity(row);
  }

  /**
   * Embed the query and run a vec0 KNN over the community vector store,
   * mapping cosine distance to a [0,1] relevance score (1 - distance, higher
   * = closer). Falls back to lexical token-overlap over the supplied rows when
   * no backend is available, the active provider's dimension does not match,
   * or no community has been embedded yet. Returns null on fallback so callers
   * can run the lexical path over their own row set (which may be level-scoped).
   */
  private async semanticScores(
    query: string,
    candidateIds: ReadonlySet<number>,
  ): Promise<Map<number, number> | null> {
    if (!this.embedding) return null;
    let vector: Float32Array;
    try {
      this.ensureVecTable();
      vector = await this.embedding.generate(query);
    } catch {
      return null;
    }
    // Wrong-dimension query vector (cross-provider mismatch) is meaningless
    // against this 384-dim table — fall back rather than letting vec0 throw.
    if (vector.length !== STORED_EMBEDDING_DIM) return null;

    // Over-fetch generously: the KNN spans every community (all levels), and
    // callers may restrict to a subset (e.g. level 1). k must comfortably cover
    // the candidate set so a level filter still has matches.
    const k = Math.max(candidateIds.size, 1) + 10;
    let rows: Array<{ id: number; distance: number }>;
    try {
      rows = this.db.prepare(`
        SELECT id, distance
        FROM vec_community_summaries
        WHERE embedding MATCH ? AND k = ? AND dimension = ?
        ORDER BY distance ASC
      `).all(Buffer.from(vector.buffer), k, vector.length) as Array<{ id: number; distance: number }>;
    } catch {
      return null;
    }
    if (rows.length === 0) return null;

    return rows.reduce((acc, r) => {
      // Cosine distance in [0,2]; clamp the relevance to [0,1] so it stays
      // comparable to the lexical fallback's range.
      const relevance = Math.max(0, Math.min(1, 1 - r.distance));
      acc.set(r.id, relevance);
      return acc;
    }, new Map<number, number>());
  }

  async searchCommunities(query: string, limit?: number): Promise<CommunitySearchResult[]> {
    const effectiveLimit = limit ?? 5;
    const rows = this.db.prepare(`
      SELECT * FROM community_summaries
    `).all() as CommunityRow[];

    return this.rankRows(query, rows, effectiveLimit);
  }

  async globalSearch(query: string): Promise<GraphRAGResult> {
    const rows = this.db.prepare(`
      SELECT * FROM community_summaries WHERE level = 1
    `).all() as CommunityRow[];

    const topCommunities = await this.rankRows(query, rows, 5);

    const localDetails = topCommunities.flatMap(entry =>
      entry.community.nodeIds.map(nodeId => ({
        nodeId,
        relevance: entry.relevanceScore,
      }))
    );

    const globalAnswer = topCommunities.length > 0
      ? topCommunities.map(c => c.community.summary).join(' ')
      : '';

    return {
      globalAnswer,
      communities: topCommunities,
      localDetails,
    };
  }

  /**
   * Rank a set of community rows for a query: cosine over the vec0 store when a
   * backend is available, lexical token-overlap otherwise. Both paths share the
   * same filter (score > 0), sort (descending), and slice so callers get
   * identical shapes regardless of which leg ran. Immutable throughout.
   */
  private async rankRows(
    query: string,
    rows: readonly CommunityRow[],
    limit: number,
  ): Promise<CommunitySearchResult[]> {
    const candidateIds = new Set(rows.map(r => r.id));
    const semantic = await this.semanticScores(query, candidateIds);

    const scored = rows.map(row => ({
      community: rowToCommunity(row),
      relevanceScore: semantic
        ? semantic.get(row.id) ?? 0
        : computeTextOverlap(query, row.summary),
    }));

    return scored
      .filter(entry => entry.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  getHierarchy(communityId: number): Community[] {
    const chain: Community[] = [];
    let currentId: number | null = communityId;

    while (currentId !== null) {
      const row = this.db.prepare(`
        SELECT * FROM community_summaries WHERE id = ?
      `).get(currentId) as CommunityRow | undefined;

      if (!row) break;

      const community = rowToCommunity(row);
      chain.push(community);
      currentId = community.parentCommunityId;
    }

    return chain;
  }

  pruneStale(olderThanMs?: number): number {
    const threshold = olderThanMs ?? 2592000000;
    const cutoff = Date.now() - threshold;

    // Capture the rows about to be deleted so their vectors can be pruned too,
    // keeping the vec0 store from accumulating orphans. Best-effort: a missing
    // vec table (no backend ever ran) just means nothing to clean up.
    const stale = this.db.prepare(`
      SELECT id FROM community_summaries WHERE updated_at < ?
    `).all(cutoff) as Array<{ id: number }>;

    const result = this.db.prepare(`
      DELETE FROM community_summaries WHERE updated_at < ?
    `).run(cutoff);

    if (stale.length > 0) {
      try {
        this.ensureVecTable();
        const delVec = this.db.prepare('DELETE FROM vec_community_summaries WHERE id = ?');
        for (const { id } of stale) delVec.run(id);
      } catch {
        // No vec store / backend — nothing to prune.
      }
    }

    return result.changes;
  }
}
