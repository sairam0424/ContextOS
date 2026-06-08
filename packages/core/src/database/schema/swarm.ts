import type { RawDB } from '../types.js';

/**
 * Swarm Orchestration tables (Phase 3: Beast Mode v3): swarm sessions,
 * proposals, vote requests, and votes.
 *
 * SQL is byte-identical to the original monolithic schema — moved, not rewritten.
 */
export function createSwarmTables(db: RawDB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS swarm_sessions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      topology TEXT NOT NULL DEFAULT 'supervisor',
      task_ledger TEXT NOT NULL DEFAULT '{}',
      progress_ledger TEXT NOT NULL DEFAULT '{}',
      status TEXT DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_sessions_status ON swarm_sessions(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_sessions_mission ON swarm_sessions(mission_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      resource TEXT NOT NULL,
      type TEXT NOT NULL,
      bid REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      counter_payload TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status, expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_proposals_to_agent ON proposals(to_agent, status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS vote_requests (
      id TEXT PRIMARY KEY,
      proposer_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      quorum INTEGER NOT NULL DEFAULT 1,
      deadline INTEGER NOT NULL,
      result TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS votes (
      request_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      choice TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (request_id, voter_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_votes_request ON votes(request_id)`);
}
