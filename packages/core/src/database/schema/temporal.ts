import type { RawDB } from '../types.js';

/**
 * Temporal Knowledge Graph tables (Phase 2: Beast Mode v3): temporal edges,
 * node states/events/metrics, and hyperedges with their members.
 *
 * SQL is byte-identical to the original monolithic schema — moved, not rewritten.
 */
export function createTemporalTables(db: RawDB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS temporal_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      valid_from INTEGER NOT NULL,
      valid_until INTEGER,
      confidence REAL DEFAULT 1.0,
      evidence INTEGER DEFAULT 1,
      decay_rate REAL DEFAULT 0.99
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_temporal_edges_source ON temporal_edges(source, valid_from)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_temporal_edges_target ON temporal_edges(target, valid_from)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_temporal_edges_time ON temporal_edges(valid_from, valid_until)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS node_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      state_key TEXT NOT NULL,
      state_value TEXT,
      valid_from INTEGER NOT NULL,
      valid_until INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_node_states_node ON node_states(node_id, state_key, valid_from)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS node_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      agent_id TEXT,
      metadata TEXT DEFAULT '{}'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_node_events_node ON node_events(node_id, timestamp)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS node_metrics (
      node_id TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      value REAL NOT NULL,
      computed_at_version INTEGER NOT NULL,
      PRIMARY KEY (node_id, metric_type)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS hyperedges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS hyperedge_members (
      hyperedge_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      PRIMARY KEY (hyperedge_id, node_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_hyperedge_members_node ON hyperedge_members(node_id)`);
}
