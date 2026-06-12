import type { RawDB } from '../types.js';

/**
 * Governance & Trust tables (Phase 4: Beast Mode v3): capability tokens,
 * trust scores/events, policies, and anomaly alerts.
 *
 * SQL is byte-identical to the original monolithic schema — moved, not rewritten.
 */
export function createGovernanceTables(db: RawDB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_tokens (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '[]',
      issued_by TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER DEFAULT 0,
      parent_token_id TEXT,
      max_delegation_depth INTEGER DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cap_tokens_agent ON capability_tokens(agent_id, revoked)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS trust_scores (
      agent_id TEXT PRIMARY KEY,
      overall REAL DEFAULT 0.5,
      reliability REAL DEFAULT 0.5,
      timeliness REAL DEFAULT 0.5,
      accuracy REAL DEFAULT 0.5,
      compliance REAL DEFAULT 0.5,
      resource_efficiency REAL DEFAULT 0.5,
      last_updated INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS trust_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      dimension TEXT NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trust_events_agent ON trust_events(agent_id, timestamp)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      rules TEXT NOT NULL DEFAULT '[]',
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS anomaly_alerts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      evidence TEXT DEFAULT '{}',
      detected_at INTEGER NOT NULL,
      resolved INTEGER DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_agent ON anomaly_alerts(agent_id, resolved)`);
}
