import type { RawDB } from './types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('database:schema');

export function initializeSchema(db: RawDB): void {
  log.debug('Initializing database schema');

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      title TEXT,
      content TEXT,
      excerpt TEXT,
      mtime INTEGER,
      metadata TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      is_private INTEGER DEFAULT 0,
      intelligence_status TEXT DEFAULT 'pending'
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_documents USING fts5(
      title,
      content,
      content='documents',
      content_rowid='id'
    )
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO fts_documents(rowid, title, content) VALUES (new.id, new.title, new.content);
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO fts_documents(fts_documents, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO fts_documents(fts_documents, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
      INSERT INTO fts_documents(rowid, title, content) VALUES (new.id, new.title, new.content);
    END
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS vec_documents (
      id INTEGER PRIMARY KEY,
      embedding BLOB,
      provider TEXT,
      dimension INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      UNIQUE(source, target, type)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.exec(`
    INSERT OR IGNORE INTO graph_metadata (key, value) VALUES ('graph_version', '0')
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER,
      type TEXT,
      signature TEXT,
      hash TEXT,
      UNIQUE(name, path)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS intelligence_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER UNIQUE NOT NULL,
      priority INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      retry_count INTEGER DEFAULT 0,
      last_error TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS locks (
      path TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'write',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (path, agent_id, mode)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_locks_path ON locks(path)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      action TEXT NOT NULL,
      timestamp INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      priority INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      due_at INTEGER,
      metadata TEXT DEFAULT '{}'
    )
  `);

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

  // --- Cognitive Engine tables (Phase 1: Beast Mode v3) ---

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

  // --- Temporal Knowledge Graph tables (Phase 2: Beast Mode v3) ---

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

  log.debug('Schema initialization complete');
}

export function migrateSchema(db: RawDB): void {
  log.debug('Running schema migrations');

  const docCols = new Set((db.pragma('table_info(documents)') as any[]).map((c: any) => c.name));
  if (!docCols.has('status')) db.exec(`ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'active'`);
  if (!docCols.has('is_private')) db.exec(`ALTER TABLE documents ADD COLUMN is_private INTEGER DEFAULT 0`);
  if (!docCols.has('intelligence_status')) db.exec(`ALTER TABLE documents ADD COLUMN intelligence_status TEXT DEFAULT 'pending'`);

  const symCols = new Set((db.pragma('table_info(symbols)') as any[]).map((c: any) => c.name));
  if (!symCols.has('hash')) db.exec(`ALTER TABLE symbols ADD COLUMN hash TEXT`);

  const vecCols = new Set((db.pragma('table_info(vec_documents)') as any[]).map((c: any) => c.name));
  if (!vecCols.has('dimension')) db.exec(`ALTER TABLE vec_documents ADD COLUMN dimension INTEGER NOT NULL DEFAULT 0`);

  const qCols = new Set((db.pragma('table_info(intelligence_queue)') as any[]).map((c: any) => c.name));
  if (!qCols.has('retry_count')) db.exec(`ALTER TABLE intelligence_queue ADD COLUMN retry_count INTEGER DEFAULT 0`);
  if (!qCols.has('last_error')) db.exec(`ALTER TABLE intelligence_queue ADD COLUMN last_error TEXT`);

  const taskCols = new Set((db.pragma('table_info(task_nodes)') as any[]).map((c: any) => c.name));
  if (!taskCols.has('assigned_at')) db.exec(`ALTER TABLE task_nodes ADD COLUMN assigned_at INTEGER`);
  if (!taskCols.has('priority')) db.exec(`ALTER TABLE task_nodes ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`);
  if (!taskCols.has('required_capabilities')) db.exec(`ALTER TABLE task_nodes ADD COLUMN required_capabilities TEXT DEFAULT '[]'`);
  if (!taskCols.has('retry_config')) db.exec(`ALTER TABLE task_nodes ADD COLUMN retry_config TEXT`);

  // Migrate locks table from single-column PK (path) to composite PK (path, agent_id, mode)
  const lockCols = db.pragma('table_info(locks)') as any[];
  const pathCol = lockCols.find((c: any) => c.name === 'path');
  const hasSinglePK = pathCol && pathCol.pk === 1 && lockCols.filter((c: any) => c.pk > 0).length === 1;

  if (hasSinglePK) {
    log.debug('Migrating locks table from single-column PK to composite PK');
    db.exec(`
      CREATE TABLE IF NOT EXISTS locks_new (
        path TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'write',
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (path, agent_id, mode)
      )
    `);

    // Migrate existing rows: split encoded read lock keys (path#read:agentId)
    const existingRows = db.prepare(`SELECT * FROM locks`).all() as any[];
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO locks_new (path, agent_id, mode, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const row of existingRows) {
      const rawPath: string = row.path;
      const readMarker = rawPath.indexOf('#read:');
      if (readMarker !== -1) {
        // Encoded read lock: extract real path and agentId
        const realPath = rawPath.substring(0, readMarker);
        const encodedAgent = rawPath.substring(readMarker + '#read:'.length);
        insertStmt.run(realPath, encodedAgent, 'read', row.expires_at, row.created_at);
      } else {
        // Normal write lock or legacy lock
        const mode = row.mode || 'write';
        insertStmt.run(rawPath, row.agent_id, mode, row.expires_at, row.created_at);
      }
    }

    db.exec(`DROP TABLE locks`);
    db.exec(`ALTER TABLE locks_new RENAME TO locks`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_locks_path ON locks(path)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at)`);
    log.debug('Locks table migration complete');
  }

  // Performance indexes for common query patterns
  db.exec(`CREATE INDEX IF NOT EXISTS idx_access_path_ts ON access_log(path, timestamp)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(status, intelligence_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(status, last_heartbeat)`);

  log.debug('Migrations complete');
}
