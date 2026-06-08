import type { RawDB } from '../database/types.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';
import type { EmbeddingService } from '../services/embedding.js';
import type { MemoryEntry, MemoryType, MemoryStreamConfig } from './types.js';
import {
  CognitiveVectorStore,
  embedRowInBackground,
  resolveQueryVector,
  relevanceScore,
  tokenize,
} from './similarity.js';

const DEFAULT_CONFIG: MemoryStreamConfig = {
  recencyDecayLambda: 0.995,
  importanceWeight: 1.0,
  relevanceWeight: 1.0,
  reflectionThreshold: 150,
  maxRetrievalResults: 10,
};

const SQL_INSERT_MEMORY =
  `INSERT INTO memory_entries (agent_id, content, type, importance, created_at, accessed_at, access_count, parent_ids) VALUES (?, ?, ?, ?, ?, ?, 0, '[]')`;

const SQL_GET_BY_AGENT =
  `SELECT * FROM memory_entries WHERE agent_id = ? ORDER BY created_at DESC`;

const SQL_GET_BY_AGENT_AND_TYPE =
  `SELECT * FROM memory_entries WHERE agent_id = ? AND type = ? ORDER BY created_at DESC`;

const SQL_GET_RECENT =
  `SELECT * FROM memory_entries WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`;

const SQL_UPDATE_ACCESS =
  `UPDATE memory_entries SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?`;

interface ObserveOptions {
  readonly type?: MemoryType;
  readonly importance?: number;
}

interface RetrieveOptions {
  readonly limit?: number;
  readonly type?: MemoryType;
}

interface RawMemoryRow {
  readonly id: number;
  readonly agent_id: string;
  readonly content: string;
  readonly type: string;
  readonly importance: number;
  readonly created_at: number;
  readonly accessed_at: number;
  readonly access_count: number;
  readonly parent_ids: string;
}

function rowToMemoryEntry(row: RawMemoryRow): MemoryEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    content: row.content,
    type: row.type as MemoryType,
    importance: row.importance,
    createdAt: row.created_at,
    accessedAt: row.accessed_at,
    accessCount: row.access_count,
    parentIds: JSON.parse(row.parent_ids),
  };
}

/** vec0 companion table holding one embedding per `memory_entries` row. */
const MEMORY_VECTOR_TABLE = 'vec_memory_entries';

export class MemoryStream {
  private readonly config: MemoryStreamConfig;
  private readonly db: RawDB;
  private readonly eventBus: WorkspaceEventBus;
  private readonly embedding?: EmbeddingService;
  private readonly vectors: CognitiveVectorStore;
  private readonly accumulatedImportance: Map<string, number> = new Map();

  constructor(
    db: RawDB,
    eventBus: WorkspaceEventBus,
    config?: Partial<MemoryStreamConfig>,
    embedding?: EmbeddingService,
  ) {
    this.db = db;
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.embedding = embedding;
    this.vectors = new CognitiveVectorStore(db, MEMORY_VECTOR_TABLE);
  }

  observe(agentId: string, content: string, opts?: ObserveOptions): MemoryEntry {
    const now = Date.now();
    const type: MemoryType = opts?.type ?? 'observation';
    const importance = opts?.importance ?? this.scoreImportance(content);

    const result = this.db.prepare(SQL_INSERT_MEMORY).run(agentId, content, type, importance, now, now);

    // Embed the content at write time (fire-and-forget): the row is returned
    // immediately, its vector lands shortly after for cosine-based retrieval.
    embedRowInBackground(this.embedding, this.vectors, Number(result.lastInsertRowid), content);

    const createdEntry: MemoryEntry = {
      id: Number(result.lastInsertRowid),
      agentId,
      content,
      type,
      importance,
      createdAt: now,
      accessedAt: now,
      accessCount: 0,
      parentIds: [],
    };

    this.eventBus.emit({
      type: 'memory.observed' as any,
      agentId,
      memoryId: result.lastInsertRowid,
    } as any);

    const currentAccumulated = (this.accumulatedImportance.get(agentId) ?? 0) + importance;
    this.accumulatedImportance.set(agentId, currentAccumulated);

    if (currentAccumulated >= this.config.reflectionThreshold) {
      Promise.resolve().then(() => this.triggerReflection(agentId));
    }

    return createdEntry;
  }

  retrieve(agentId: string, query: string, opts?: RetrieveOptions): MemoryEntry[] {
    const limit = opts?.limit ?? this.config.maxRetrievalResults;

    const rows: RawMemoryRow[] = opts?.type
      ? (this.db.prepare(SQL_GET_BY_AGENT_AND_TYPE).all(agentId, opts.type) as RawMemoryRow[])
      : (this.db.prepare(SQL_GET_BY_AGENT).all(agentId) as RawMemoryRow[]);

    const now = Date.now();
    const queryTokens = tokenize(query);
    // Cosine query vector when the embedding backend is wired in AND this query
    // is warm in the cache; otherwise undefined → token-overlap fallback. The
    // 3-factor blend (recency x importance x relevance) is untouched — only the
    // RELEVANCE term changes from Jaccard overlap to cosine. The dimension gate
    // inside relevanceScore guards any cross-provider mismatch.
    const queryVector = resolveQueryVector(this.embedding, 'memory', query);

    const scoredEntries: Array<{ readonly entry: MemoryEntry; readonly score: number }> = rows.map(row => {
      const entry = rowToMemoryEntry(row);
      const hoursSinceAccess = (now - entry.accessedAt) / 3600000;
      const recencyScore = Math.pow(this.config.recencyDecayLambda, hoursSinceAccess);
      const importanceScore = entry.importance * this.config.importanceWeight;
      const relevance = relevanceScore(
        queryVector,
        this.vectors.get(entry.id),
        queryTokens,
        entry.content,
      );
      const weightedRelevance = relevance * this.config.relevanceWeight;
      const totalScore = recencyScore + importanceScore + weightedRelevance;
      return { entry, score: totalScore };
    });

    const sortedEntries = [...scoredEntries].sort((a, b) => b.score - a.score);
    const topEntries = sortedEntries.slice(0, limit);

    const accessedNow = Date.now();
    for (const { entry } of topEntries) {
      this.db.prepare(SQL_UPDATE_ACCESS).run(accessedNow, entry.id);
    }

    return topEntries.map(({ entry }) => ({
      ...entry,
      accessedAt: accessedNow,
      accessCount: entry.accessCount + 1,
    }));
  }

  getRecentMemories(agentId: string, limit: number): MemoryEntry[] {
    const rows = this.db.prepare(SQL_GET_RECENT).all(agentId, limit) as RawMemoryRow[];
    return rows.map(rowToMemoryEntry);
  }

  getAccumulatedImportance(agentId: string): number {
    return this.accumulatedImportance.get(agentId) ?? 0;
  }

  private scoreImportance(content: string): number {
    const lowerContent = content.toLowerCase();
    let score = 0.3;

    if (/error|failure|bug|crash/.test(lowerContent)) score += 0.2;
    if (/decision|architecture|design/.test(lowerContent)) score += 0.2;
    if (/security|vulnerability/.test(lowerContent)) score += 0.1;
    if (content.length > 500) score += 0.1;

    return Math.min(score, 1.0);
  }

  private triggerReflection(agentId: string): void {
    this.accumulatedImportance.set(agentId, 0);

    const recentRows = this.db.prepare(SQL_GET_RECENT).all(agentId, 20) as RawMemoryRow[];
    const observationCount = recentRows.length;

    const reflectionContent = `[Auto-reflection] Synthesized from ${observationCount} recent observations for agent ${agentId}`;
    const now = Date.now();

    const result = this.db.prepare(SQL_INSERT_MEMORY).run(agentId, reflectionContent, 'reflection', 0.8, now, now);

    embedRowInBackground(this.embedding, this.vectors, Number(result.lastInsertRowid), reflectionContent);

    this.eventBus.emit({
      type: 'memory.reflected' as any,
      agentId,
      reflectionId: result.lastInsertRowid,
    } as any);
  }
}
