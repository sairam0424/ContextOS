import type { RawDB } from '../database/types.js';

export type MemoryLevel = 0 | 1 | 2 | 3;

export interface MemorySummary {
  readonly id: number;
  readonly level: MemoryLevel;
  readonly agentId: string;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly summary: string;
  readonly tokenCount: number;
  readonly createdAt: number;
}

export interface CompactionConfig {
  readonly level: MemoryLevel;
  readonly label: string;
  readonly maxTokens: number;
  readonly retentionMs: number;
}

export interface CompactionResult {
  readonly level: MemoryLevel;
  readonly periodsCompacted: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}

interface MemorySummaryRow {
  id: number;
  level: number;
  agent_id: string;
  period_start: number;
  period_end: number;
  summary: string;
  token_count: number;
  created_at: number;
}

function rowToMemorySummary(row: MemorySummaryRow): MemorySummary {
  return {
    id: row.id,
    level: row.level as MemoryLevel,
    agentId: row.agent_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    summary: row.summary,
    tokenCount: row.token_count,
    createdAt: row.created_at,
  };
}

const LEVEL_CONFIGS: readonly CompactionConfig[] = [
  { level: 0, label: 'raw', maxTokens: Infinity, retentionMs: 604800000 },
  { level: 1, label: 'hourly', maxTokens: 500, retentionMs: 2592000000 },
  { level: 2, label: 'daily', maxTokens: 200, retentionMs: 7776000000 },
  { level: 3, label: 'weekly', maxTokens: 100, retentionMs: Infinity },
];

export class HierarchicalMemory {
  private readonly db: RawDB;

  constructor(db: RawDB) {
    this.db = db;
  }

  compact(
    agentId: string,
    level: MemoryLevel,
    periodStart: number,
    periodEnd: number,
    content: string
  ): MemorySummary {
    const config = LEVEL_CONFIGS[level];
    const maxChars = config.maxTokens * 4;
    const truncatedContent = content.length > maxChars ? content.slice(0, maxChars) : content;
    const tokenCount = Math.ceil(truncatedContent.length / 4);
    const now = Date.now();

    const result = this.db
      .prepare(
        'INSERT INTO memory_summaries (level, agent_id, period_start, period_end, summary, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(level, agentId, periodStart, periodEnd, truncatedContent, tokenCount, now);

    return {
      id: Number(result.lastInsertRowid),
      level,
      agentId,
      periodStart,
      periodEnd,
      summary: truncatedContent,
      tokenCount,
      createdAt: now,
    };
  }

  getSummaries(agentId: string, level?: MemoryLevel, since?: number): MemorySummary[] {
    let sql = 'SELECT * FROM memory_summaries WHERE agent_id = ?';
    const params: Array<string | number> = [agentId];

    if (level !== undefined) {
      sql += ' AND level = ?';
      params.push(level);
    }

    if (since !== undefined) {
      sql += ' AND period_start >= ?';
      params.push(since);
    }

    sql += ' ORDER BY period_start DESC';

    const rows = this.db.prepare(sql).all(...params) as MemorySummaryRow[];
    return rows.map(rowToMemorySummary);
  }

  getLatestAtLevel(agentId: string, level: MemoryLevel): MemorySummary | null {
    const row = this.db
      .prepare(
        'SELECT * FROM memory_summaries WHERE agent_id = ? AND level = ? ORDER BY period_end DESC LIMIT 1'
      )
      .get(agentId, level) as MemorySummaryRow | undefined;

    if (!row) return null;
    return rowToMemorySummary(row);
  }

  pruneExpired(agentId: string): number {
    const now = Date.now();
    let totalPruned = 0;

    for (let level = 0; level <= 2; level++) {
      const config = LEVEL_CONFIGS[level];
      const cutoff = now - config.retentionMs;

      const result = this.db
        .prepare('DELETE FROM memory_summaries WHERE level = ? AND agent_id = ? AND period_end < ?')
        .run(level, agentId, cutoff);

      totalPruned += result.changes;
    }

    return totalPruned;
  }

  getContextBudget(agentId: string, maxTokens = 2000): MemorySummary[] {
    const selected: MemorySummary[] = [];
    let remainingTokens = maxTokens;

    for (let level = 3; level >= 0; level--) {
      const rows = this.db
        .prepare(
          'SELECT * FROM memory_summaries WHERE agent_id = ? AND level = ? ORDER BY period_end DESC'
        )
        .all(agentId, level) as MemorySummaryRow[];

      for (const row of rows) {
        if (remainingTokens <= 0) break;
        const summary = rowToMemorySummary(row);
        if (summary.tokenCount <= remainingTokens) {
          selected.push(summary);
          remainingTokens -= summary.tokenCount;
        }
      }

      if (remainingTokens <= 0) break;
    }

    return selected;
  }

  getLevelConfig(level: MemoryLevel): CompactionConfig {
    return LEVEL_CONFIGS[level];
  }
}
