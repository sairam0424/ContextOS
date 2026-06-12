import type { RawDB } from '../types.js';

/**
 * Streaming Intelligence (Phase 5) and Predictive Self-Healing (Phase 6)
 * tables (Beast Mode v3): distilled knowledge, hierarchical memory summaries,
 * git co-change edges, file ownership, and community summaries.
 *
 * SQL is byte-identical to the original monolithic schema — moved, not rewritten.
 */
export function createStreamingTables(db: RawDB): void {
  // --- Streaming Intelligence tables (Phase 5: Beast Mode v3) ---

  db.exec(`
    CREATE TABLE IF NOT EXISTS distilled_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      corridor TEXT UNIQUE NOT NULL,
      summary TEXT NOT NULL,
      query_cluster TEXT NOT NULL DEFAULT '[]',
      access_count INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_distilled_corridor ON distilled_knowledge(corridor)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_distilled_access ON distilled_knowledge(access_count DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      summary TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_summaries_agent ON memory_summaries(agent_id, level, period_start)`);

  // --- Predictive Self-Healing tables (Phase 6: Beast Mode v3) ---

  db.exec(`
    CREATE TABLE IF NOT EXISTS co_change_edges (
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      last_co_change INTEGER NOT NULL,
      authors TEXT DEFAULT '[]',
      PRIMARY KEY (source, target)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cochange_source ON co_change_edges(source)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cochange_target ON co_change_edges(target)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS file_ownership (
      path TEXT PRIMARY KEY,
      primary_author TEXT NOT NULL,
      author_shares TEXT NOT NULL DEFAULT '{}',
      last_modified INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS community_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level INTEGER NOT NULL DEFAULT 0,
      node_ids TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL,
      parent_community_id INTEGER,
      modularity REAL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_community_level ON community_summaries(level)`);
}
