import type { RawDB } from '../types.js';

/**
 * Cognitive Engine tables (Phase 1: Beast Mode v3): memory entries,
 * reflections, and learned skills.
 *
 * SQL is byte-identical to the original monolithic schema — moved, not rewritten.
 */
export function createCognitiveTables(db: RawDB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'observation',
      importance REAL DEFAULT 0.5,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      accessed_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      access_count INTEGER DEFAULT 0,
      parent_ids TEXT DEFAULT '[]'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_entries(agent_id, type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_entries(importance DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reflections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      trial INTEGER NOT NULL DEFAULT 1,
      observation TEXT NOT NULL,
      diagnosis TEXT NOT NULL,
      prescription TEXT NOT NULL,
      validated INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reflections_task ON reflections(task_id, trial)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reflections_agent ON reflections(agent_id, validated)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      code TEXT NOT NULL,
      prerequisites TEXT DEFAULT '[]',
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      last_used_at INTEGER,
      created_by TEXT NOT NULL,
      version INTEGER DEFAULT 1
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name)`);
}
