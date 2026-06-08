import type { RawDB } from './types.js';
import { createChildLogger } from '../logger.js';
import { createCoreTables } from './schema/core.js';
import { createAgentTables } from './schema/agents.js';
import { createCognitiveTables } from './schema/cognitive.js';
import { createTemporalTables } from './schema/temporal.js';
import { createSwarmTables } from './schema/swarm.js';
import { createGovernanceTables } from './schema/governance.js';
import { createStreamingTables } from './schema/streaming.js';

const log = createChildLogger('database:schema');

/**
 * Initializes the full database schema by delegating to per-domain modules.
 * The call order is preserved from the original monolithic schema so that
 * cross-table inserts (e.g. graph_metadata seed) and FTS triggers resolve
 * against tables that already exist.
 */
export function initializeSchema(db: RawDB): void {
  log.debug('Initializing database schema');

  createCoreTables(db);
  createAgentTables(db);
  createCognitiveTables(db);
  createTemporalTables(db);
  createSwarmTables(db);
  createGovernanceTables(db);
  createStreamingTables(db);

  log.debug('Schema initialization complete');
}

/** A single, idempotent, atomically-applied migration unit. */
interface Migration {
  readonly name: string;
  up(db: RawDB): void;
}

function hasColumn(db: RawDB, table: string, column: string): boolean {
  return (db.pragma(`table_info(${table})`) as any[]).some((c: any) => c.name === column);
}

/**
 * Ordered, in-code migration registry (KISS — no SQL files, no framework).
 * Each unit is recorded in `schema_migrations` once applied and runs exactly
 * once. Every unit is also independently idempotent so it remains safe to
 * re-run against legacy databases created before the ledger existed.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_documents_columns',
    up(db) {
      if (!hasColumn(db, 'documents', 'status')) db.exec(`ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'active'`);
      if (!hasColumn(db, 'documents', 'is_private')) db.exec(`ALTER TABLE documents ADD COLUMN is_private INTEGER DEFAULT 0`);
      if (!hasColumn(db, 'documents', 'intelligence_status')) db.exec(`ALTER TABLE documents ADD COLUMN intelligence_status TEXT DEFAULT 'pending'`);
    },
  },
  {
    name: '002_symbols_hash',
    up(db) {
      if (!hasColumn(db, 'symbols', 'hash')) db.exec(`ALTER TABLE symbols ADD COLUMN hash TEXT`);
    },
  },
  {
    name: '003_vec_documents_dimension',
    up(db) {
      if (!hasColumn(db, 'vec_documents', 'dimension')) db.exec(`ALTER TABLE vec_documents ADD COLUMN dimension INTEGER NOT NULL DEFAULT 0`);
    },
  },
  {
    name: '004_intelligence_queue_columns',
    up(db) {
      if (!hasColumn(db, 'intelligence_queue', 'retry_count')) db.exec(`ALTER TABLE intelligence_queue ADD COLUMN retry_count INTEGER DEFAULT 0`);
      if (!hasColumn(db, 'intelligence_queue', 'last_error')) db.exec(`ALTER TABLE intelligence_queue ADD COLUMN last_error TEXT`);
    },
  },
  {
    name: '005_task_nodes_columns',
    up(db) {
      if (!hasColumn(db, 'task_nodes', 'assigned_at')) db.exec(`ALTER TABLE task_nodes ADD COLUMN assigned_at INTEGER`);
      if (!hasColumn(db, 'task_nodes', 'priority')) db.exec(`ALTER TABLE task_nodes ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`);
      if (!hasColumn(db, 'task_nodes', 'required_capabilities')) db.exec(`ALTER TABLE task_nodes ADD COLUMN required_capabilities TEXT DEFAULT '[]'`);
      if (!hasColumn(db, 'task_nodes', 'retry_config')) db.exec(`ALTER TABLE task_nodes ADD COLUMN retry_config TEXT`);
    },
  },
  {
    name: '006_locks_composite_pk',
    up(db) {
      // Migrate locks table from single-column PK (path) to composite PK (path, agent_id, mode).
      const lockCols = db.pragma('table_info(locks)') as any[];
      const pathCol = lockCols.find((c: any) => c.name === 'path');
      const hasSinglePK = pathCol && pathCol.pk === 1 && lockCols.filter((c: any) => c.pk > 0).length === 1;
      if (!hasSinglePK) return;

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
    },
  },
  {
    name: '007_performance_indexes',
    up(db) {
      // Performance indexes for common query patterns
      db.exec(`CREATE INDEX IF NOT EXISTS idx_access_path_ts ON access_log(path, timestamp)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(status, intelligence_status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(status, last_heartbeat)`);
    },
  },
  {
    name: '008_hotpath_indexes',
    up(db) {
      // Hot-path indexes (v4 opportunity #14): priority-ordered queue drain and mission status scans.
      db.exec(`CREATE INDEX IF NOT EXISTS idx_intelligence_queue_priority ON intelligence_queue(priority DESC, id ASC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status)`);
    },
  },
];

/**
 * Applies pending migrations through a recorded ledger.
 *
 * Each not-yet-applied unit runs inside a single transaction together with the
 * `schema_migrations` insert, so a partial failure rolls back cleanly and the
 * unit is retried on the next run. Re-running against an up-to-date database is
 * a no-op; legacy databases predating the ledger record their already-effective
 * units the first time this runs (the unit bodies are independently idempotent).
 */
export function migrateSchema(db: RawDB): void {
  log.debug('Running schema migrations');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare(`SELECT name FROM schema_migrations`).all() as any[]).map((r: any) => r.name),
  );

  const recordApplied = db.prepare(`INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)`);

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;

    const runUnit = db.transaction(() => {
      migration.up(db);
      recordApplied.run(migration.name, Date.now());
    });
    runUnit();

    log.debug({ migration: migration.name }, 'Applied schema migration');
  }

  log.debug('Migrations complete');
}
