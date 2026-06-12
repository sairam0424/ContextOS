import type { RawDB } from '../types.js';

/**
 * Agent runtime tables: agent registry, inter-agent messaging, task graph
 * (nodes + dependencies), circuit breaker state, dead letters, and event log.
 *
 * SQL is byte-identical to the original monolithic schema — moved, not rewritten.
 */
export function createAgentTables(db: RawDB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      capabilities TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      transport TEXT DEFAULT 'stdio',
      last_heartbeat INTEGER NOT NULL,
      registered_at INTEGER NOT NULL,
      metadata TEXT DEFAULT '{}'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      correlation_id TEXT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      intent TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      timestamp INTEGER NOT NULL,
      delivered_at INTEGER,
      ttl INTEGER
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_to ON agent_messages(to_agent, delivered_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_nodes (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assigned_to TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      timeout INTEGER DEFAULT 300,
      retries INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_mission ON task_nodes(mission_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON task_nodes(assigned_to, status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS circuit_breaker_state (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'closed',
      tripped_at INTEGER,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dead_letters (
      id TEXT PRIMARY KEY,
      original_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      target_id TEXT,
      topic TEXT,
      content TEXT NOT NULL,
      expired_at INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT 'ttl_expired'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dead_letters_sender ON dead_letters(sender_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      replayed INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(type, timestamp)`);
}
