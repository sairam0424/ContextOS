import * as sqliteVec from 'sqlite-vec';
import type { RawDB } from '../types.js';

/**
 * Core foundational tables: documents (+ FTS, triggers), vectors, graph edges,
 * symbols, intelligence queue, locks, access log, workspace config, missions,
 * agent messaging/task graph primitives, and the event log.
 *
 * SQL is byte-identical to the original monolithic schema — moved, not rewritten.
 */
export function createCoreTables(db: RawDB): void {
  // vec_documents is a sqlite-vec vec0 virtual table, so the extension must be
  // loaded before the CREATE below. The canonical createConnection() already
  // loads it; this defensive (idempotent) load keeps schema init self-sufficient
  // for connections built without it (e.g. a bare `new Database(':memory:')`).
  sqliteVec.load(db);

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

  // vec0 virtual table (sqlite-vec) — KNN-indexed instead of brute-force scans.
  // `dimension` is a PARTITION KEY so cross-provider reads can be gated inside
  // the KNN WHERE clause (vec0 forbids WHERE constraints on `+` aux columns, but
  // allows them on partition keys). `embedding` is fixed at float[384]; the
  // stored `dimension`/`model_id` let a 384-vs-768 mismatch SKIP rather than
  // return garbage. distance_metric=cosine preserves the previous
  // vec_distance_cosine semantics (0 = identical, 1 = orthogonal).
  // Migration 009 (schema.ts) converts legacy plain-table installs to this form.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents USING vec0(
      id INTEGER PRIMARY KEY,
      dimension INTEGER partition key,
      embedding float[384] distance_metric=cosine,
      +model_id TEXT,
      +provider TEXT
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
}
