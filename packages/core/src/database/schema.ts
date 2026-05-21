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
      path TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

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
