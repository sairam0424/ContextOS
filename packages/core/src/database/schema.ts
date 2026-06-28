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

/** True once `table` already declares at least one FOREIGN KEY (idempotency guard). */
function hasForeignKey(db: RawDB, table: string): boolean {
  return (db.pragma(`foreign_key_list(${table})`) as any[]).length > 0;
}

/** True once `table`'s DDL contains a CHECK constraint (idempotency guard for CHECK-only rebuilds). */
function hasCheckConstraint(db: RawDB, table: string): boolean {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { sql: string | null } | undefined;
  return /\bCHECK\s*\(/i.test(row?.sql ?? '');
}

/**
 * Rebuilds a child table to attach FOREIGN KEY / CHECK constraints that SQLite
 * cannot add via ALTER TABLE. Reuses the proven create-new + copy-all + drop +
 * rename pattern from migration '006_locks_composite_pk' and adds two safety nets:
 *
 *  - Row-count verification: the copied row count MUST equal the source count, or
 *    we throw and the surrounding transaction rolls the whole unit back (no
 *    half-migrated table is ever committed). Content preservation is mandatory.
 *  - Index re-creation: DROP TABLE silently drops a table's indexes, so each
 *    rebuild re-issues the CREATE INDEX statements the table originally owned.
 *
 * `copyColumns` is the explicit, ordered column list copied INTO the new table
 * (SELECTed from the old one) so a column whose NOT NULL was relaxed for an
 * ON DELETE SET NULL FK still maps 1:1. Only child tables are rebuilt here; the
 * referenced parents are untouched, so no cascade fires during migration.
 *
 * `preCopyFixups` (optional) is a list of statements run BEFORE the copy that
 * reconcile a legacy DB built without FK enforcement to the new constraint:
 *   - CASCADE tables: DELETE orphan rows (a child whose parent is already gone is
 *     dead data — the very violation the FK forbids — and copying it would raise
 *     "FOREIGN KEY constraint failed", rolling the unit back and wedging migration
 *     forever).
 *   - SET NULL tables: UPDATE orphan references to NULL (preserving the audit row
 *     while satisfying the FK), so no rows are lost.
 * The row-count check compares the FIXED-UP source against the copy, still proving
 * the copy step itself loses nothing; only pre-existing orphans are reconciled,
 * and any DELETEd count is logged.
 */
function rebuildTableWithConstraints(
  db: RawDB,
  table: string,
  newTableDDL: string,
  copyColumns: readonly string[],
  indexes: readonly string[],
  preCopyFixups: readonly string[] = [],
): void {
  const cols = copyColumns.join(', ');
  const tmp = `${table}_fk_new`;

  const original = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  for (const fixup of preCopyFixups) db.exec(fixup);
  const before = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  if (before !== original) {
    log.debug({ table, purgedOrphans: original - before }, 'Purged orphan rows before FK rebuild');
  }

  db.exec(newTableDDL.replace(`__TMP__`, tmp));
  db.exec(`INSERT INTO ${tmp} (${cols}) SELECT ${cols} FROM ${table}`);

  const copied = (db.prepare(`SELECT COUNT(*) AS n FROM ${tmp}`).get() as { n: number }).n;
  if (copied !== before) {
    throw new Error(`FK rebuild of "${table}" lost rows: ${before} -> ${copied}`);
  }

  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
  for (const idx of indexes) db.exec(idx);
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
  {
    name: '009_vec0_virtual_table',
    up(db) {
      // Convert the legacy plain `vec_documents` (id, embedding BLOB, provider,
      // dimension) into a sqlite-vec vec0 virtual table so semantic search uses a
      // real KNN index instead of brute-force vec_distance_cosine scans.
      //
      // DESTRUCTIVE for derived vectors only: a table cannot be turned into a
      // virtual table in place, so we DROP + recreate. No source data is lost —
      // document content lives in `documents`; we requeue affected docs so the
      // existing IntelligenceQueue re-embeds them into the new table.
      //
      // Idempotent: once `vec_documents` is already a vec0 virtual table this
      // no-ops. Fresh databases created by initializeSchema() also no-op here
      // because createCoreTables() already builds the vec0 form.
      const masterRow = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vec_documents'`)
        .get() as { sql: string | null } | undefined;

      // No table at all (shouldn't happen post-init) — nothing to migrate.
      if (!masterRow) return;

      const ddl = (masterRow.sql ?? '').toUpperCase();
      const isVirtual = ddl.includes('USING VEC0');

      // Already the vec0 form — recorded as applied, no work to do.
      if (isVirtual) return;

      log.debug('Migrating vec_documents from plain table to vec0 virtual table');

      // Capture which documents had a vector so we can requeue exactly them.
      // (If the legacy table is empty this is a no-op set.)
      const affected = db
        .prepare(`SELECT id FROM vec_documents`)
        .all() as Array<{ id: number }>;

      db.exec(`DROP TABLE vec_documents`);
      db.exec(`
        CREATE VIRTUAL TABLE vec_documents USING vec0(
          id INTEGER PRIMARY KEY,
          dimension INTEGER partition key,
          embedding float[384] distance_metric=cosine,
          +model_id TEXT,
          +provider TEXT
        )
      `);

      // Reset affected documents to 'pending' and enqueue them so the existing
      // IntelligenceQueue regenerates their (now dropped) vectors. INSERT OR
      // IGNORE keeps it safe if a queue row already exists.
      const setPending = db.prepare(`UPDATE documents SET intelligence_status = 'pending' WHERE id = ?`);
      const enqueue = db.prepare(`INSERT OR IGNORE INTO intelligence_queue (doc_id, priority) VALUES (?, 1)`);
      for (const { id } of affected) {
        setPending.run(id);
        enqueue.run(id);
      }

      log.debug({ requeued: affected.length }, 'vec0 migration complete — affected documents requeued for re-embedding');
    },
  },
  {
    name: '010_capability_token_signature',
    up(db) {
      // v4 opportunity #12: capability tokens were stored unsigned, so anything
      // with DB write access could mint or escalate a grant. Add an HMAC
      // `signature` column (verified at authorize()) plus a `principal` column
      // (the initiating human/root authority, distinct from the acting agent)
      // to defeat confused-deputy abuse across delegation chains.
      //
      // Idempotent: column adds are guarded by hasColumn(). Legacy rows keep
      // NULL signatures and are therefore rejected at authorize() until reissued
      // — that is the intended fail-closed behavior for unsigned/forged rows.
      if (!hasColumn(db, 'capability_tokens', 'signature')) {
        db.exec(`ALTER TABLE capability_tokens ADD COLUMN signature TEXT`);
      }
      if (!hasColumn(db, 'capability_tokens', 'principal')) {
        db.exec(`ALTER TABLE capability_tokens ADD COLUMN principal TEXT`);
      }
    },
  },
  {
    name: '011_edges_source_target_index',
    up(db) {
      // v4 opportunity #15: graph.ts getAffinities() runs a WITH RECURSIVE walk
      // whose hot inner step is `JOIN edges e ON e.source = w.node`. Only the
      // single-column idx_edges_source (migration 007) existed, so each hop still
      // touched the row to read `target`/`weight`. A composite (source, target)
      // index is covering for the join's lookup side, letting SQLite resolve every
      // hop with an index seek. Idempotent via IF NOT EXISTS.
      db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_source_target ON edges(source, target)`);
    },
  },
  {
    name: '012_foreign_keys',
    up(db) {
      // v4 opportunity #20: connection.ts sets PRAGMA foreign_keys=ON but the
      // schema declared ZERO foreign keys, so referential integrity was never
      // actually enforced. SQLite cannot ALTER TABLE ADD CONSTRAINT, so each FK
      // requires the create-new + copy + rename rebuild proven in migration 006.
      //
      // Only CHILD tables are rebuilt; their referenced PARENTS (documents,
      // agents, task_nodes, hyperedges, vote_requests) are left untouched, so no
      // cascade fires during the migration itself. Each rebuild is guarded by
      // hasForeignKey()/hasCheckConstraint() so re-running this unit no-ops, and
      // rebuildTableWithConstraints() verifies row counts to guarantee content
      // preservation (a row-loss throws and rolls back the whole unit).
      //
      // PRAGMA foreign_keys cannot be toggled inside a transaction (SQLite
      // ignores it), and migrateSchema wraps this unit in one — that is fine here
      // because we never drop a referenced parent, only childen with no inbound
      // references of their own.

      // --- ON DELETE CASCADE (ownership: child is meaningless without its parent) ---

      // task_dependencies (task_id, depends_on) both reference task_nodes(id).
      // Deleting a task removes every dependency edge that names it on either side.
      if (!hasForeignKey(db, 'task_dependencies')) {
        rebuildTableWithConstraints(
          db,
          'task_dependencies',
          `CREATE TABLE __TMP__ (
            task_id TEXT NOT NULL,
            depends_on TEXT NOT NULL,
            PRIMARY KEY (task_id, depends_on),
            FOREIGN KEY (task_id) REFERENCES task_nodes(id) ON DELETE CASCADE,
            FOREIGN KEY (depends_on) REFERENCES task_nodes(id) ON DELETE CASCADE
          )`,
          ['task_id', 'depends_on'],
          [],
          // Drop dependency edges that name a task which no longer exists.
          [`DELETE FROM task_dependencies WHERE task_id NOT IN (SELECT id FROM task_nodes)
              OR depends_on NOT IN (SELECT id FROM task_nodes)`],
        );
      }

      // hyperedge_members.hyperedge_id references hyperedges(id). Deleting a
      // hyperedge removes its membership rows.
      if (!hasForeignKey(db, 'hyperedge_members')) {
        rebuildTableWithConstraints(
          db,
          'hyperedge_members',
          `CREATE TABLE __TMP__ (
            hyperedge_id INTEGER NOT NULL,
            node_id TEXT NOT NULL,
            role TEXT DEFAULT 'member',
            PRIMARY KEY (hyperedge_id, node_id),
            FOREIGN KEY (hyperedge_id) REFERENCES hyperedges(id) ON DELETE CASCADE
          )`,
          ['hyperedge_id', 'node_id', 'role'],
          [`CREATE INDEX IF NOT EXISTS idx_hyperedge_members_node ON hyperedge_members(node_id)`],
          [`DELETE FROM hyperedge_members WHERE hyperedge_id NOT IN (SELECT id FROM hyperedges)`],
        );
      }

      // votes.request_id references vote_requests(id). Deleting a vote request
      // discards the ballots cast for it.
      if (!hasForeignKey(db, 'votes')) {
        rebuildTableWithConstraints(
          db,
          'votes',
          `CREATE TABLE __TMP__ (
            request_id TEXT NOT NULL,
            voter_id TEXT NOT NULL,
            choice TEXT NOT NULL,
            weight REAL DEFAULT 1.0,
            timestamp INTEGER NOT NULL,
            PRIMARY KEY (request_id, voter_id),
            FOREIGN KEY (request_id) REFERENCES vote_requests(id) ON DELETE CASCADE
          )`,
          ['request_id', 'voter_id', 'choice', 'weight', 'timestamp'],
          [`CREATE INDEX IF NOT EXISTS idx_votes_request ON votes(request_id)`],
          [`DELETE FROM votes WHERE request_id NOT IN (SELECT id FROM vote_requests)`],
        );
      }

      // intelligence_queue.doc_id references documents(id) (it IS the document
      // rowid — see core.ts upsert/enqueue paths). Deleting a document drops its
      // queued (re-)embedding work. Preserves the UNIQUE(doc_id) contract.
      if (!hasForeignKey(db, 'intelligence_queue')) {
        rebuildTableWithConstraints(
          db,
          'intelligence_queue',
          `CREATE TABLE __TMP__ (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id INTEGER UNIQUE NOT NULL,
            priority INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            retry_count INTEGER DEFAULT 0,
            last_error TEXT,
            FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
          )`,
          ['id', 'doc_id', 'priority', 'created_at', 'retry_count', 'last_error'],
          [`CREATE INDEX IF NOT EXISTS idx_intelligence_queue_priority ON intelligence_queue(priority DESC, id ASC)`],
          [`DELETE FROM intelligence_queue WHERE doc_id NOT IN (SELECT id FROM documents)`],
        );
      }

      // --- ON DELETE SET NULL (audit-preserving: keep the row, forget the ref) ---
      // SET NULL requires the FK column to be nullable, so each rebuild RELAXES
      // the original NOT NULL on the referencing column(s).

      // agent_messages.from_agent / to_agent reference agents(id). A deregistered
      // agent must not erase its message history (audit trail), so the agent
      // pointer is nulled rather than cascaded.
      if (!hasForeignKey(db, 'agent_messages')) {
        rebuildTableWithConstraints(
          db,
          'agent_messages',
          `CREATE TABLE __TMP__ (
            id TEXT PRIMARY KEY,
            correlation_id TEXT,
            from_agent TEXT,
            to_agent TEXT,
            intent TEXT NOT NULL,
            payload TEXT DEFAULT '{}',
            timestamp INTEGER NOT NULL,
            delivered_at INTEGER,
            ttl INTEGER,
            FOREIGN KEY (from_agent) REFERENCES agents(id) ON DELETE SET NULL,
            FOREIGN KEY (to_agent) REFERENCES agents(id) ON DELETE SET NULL
          )`,
          ['id', 'correlation_id', 'from_agent', 'to_agent', 'intent', 'payload', 'timestamp', 'delivered_at', 'ttl'],
          [`CREATE INDEX IF NOT EXISTS idx_messages_to ON agent_messages(to_agent, delivered_at)`],
          // Null dangling agent pointers (preserve the message audit row).
          [
            `UPDATE agent_messages SET from_agent = NULL WHERE from_agent IS NOT NULL AND from_agent NOT IN (SELECT id FROM agents)`,
            `UPDATE agent_messages SET to_agent = NULL WHERE to_agent IS NOT NULL AND to_agent NOT IN (SELECT id FROM agents)`,
          ],
        );
      }

      // trust_events.agent_id references agents(id). Trust history is an audit
      // ledger; preserve the events but null the agent pointer on deregistration.
      if (!hasForeignKey(db, 'trust_events')) {
        rebuildTableWithConstraints(
          db,
          'trust_events',
          `CREATE TABLE __TMP__ (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT,
            event_type TEXT NOT NULL,
            dimension TEXT NOT NULL,
            delta REAL NOT NULL,
            reason TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
          )`,
          ['id', 'agent_id', 'event_type', 'dimension', 'delta', 'reason', 'timestamp'],
          [`CREATE INDEX IF NOT EXISTS idx_trust_events_agent ON trust_events(agent_id, timestamp)`],
          [`UPDATE trust_events SET agent_id = NULL WHERE agent_id IS NOT NULL AND agent_id NOT IN (SELECT id FROM agents)`],
        );
      }

      // capability_tokens.agent_id references agents(id) (SET NULL: keep the token
      // audit row when an agent leaves). ALSO add the self-reference CHECK
      // (id != parent_token_id) since this table is already being rebuilt — a
      // token must never list itself as its own delegation parent. parent_token_id
      // is left WITHOUT a FK on purpose: revocation/expiry semantics are handled in
      // application code and a CASCADE here could silently mass-revoke a chain.
      if (!hasForeignKey(db, 'capability_tokens')) {
        rebuildTableWithConstraints(
          db,
          'capability_tokens',
          `CREATE TABLE __TMP__ (
            id TEXT PRIMARY KEY,
            agent_id TEXT,
            capabilities TEXT NOT NULL DEFAULT '[]',
            issued_by TEXT NOT NULL,
            issued_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            revoked INTEGER DEFAULT 0,
            parent_token_id TEXT,
            max_delegation_depth INTEGER DEFAULT 0,
            signature TEXT,
            principal TEXT,
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
            CHECK (parent_token_id IS NULL OR id != parent_token_id)
          )`,
          ['id', 'agent_id', 'capabilities', 'issued_by', 'issued_at', 'expires_at', 'revoked', 'parent_token_id', 'max_delegation_depth', 'signature', 'principal'],
          [`CREATE INDEX IF NOT EXISTS idx_cap_tokens_agent ON capability_tokens(agent_id, revoked)`],
          // Null the agent pointer on tokens whose agent is gone; also break any
          // self-referencing parent pointer that would violate the new CHECK.
          [
            `UPDATE capability_tokens SET agent_id = NULL WHERE agent_id IS NOT NULL AND agent_id NOT IN (SELECT id FROM agents)`,
            `UPDATE capability_tokens SET parent_token_id = NULL WHERE parent_token_id = id`,
          ],
        );
      }

      // --- CHECK-only rebuild (no FK): community_summaries self-reference guard ---
      // community_summaries has no ownership FK to add (its node_ids are a JSON
      // blob, not a referencing column), but a community must never be its own
      // parent. Rebuild solely to attach CHECK(id != parent_community_id), guarded
      // by hasCheckConstraint() so it runs at most once.
      if (!hasCheckConstraint(db, 'community_summaries')) {
        rebuildTableWithConstraints(
          db,
          'community_summaries',
          `CREATE TABLE __TMP__ (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level INTEGER NOT NULL DEFAULT 0,
            node_ids TEXT NOT NULL DEFAULT '[]',
            summary TEXT NOT NULL,
            parent_community_id INTEGER,
            modularity REAL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            CHECK (parent_community_id IS NULL OR id != parent_community_id)
          )`,
          ['id', 'level', 'node_ids', 'summary', 'parent_community_id', 'modularity', 'created_at', 'updated_at'],
          [`CREATE INDEX IF NOT EXISTS idx_community_level ON community_summaries(level)`],
          // Break any self-referencing parent pointer so the new CHECK accepts the copy.
          [`UPDATE community_summaries SET parent_community_id = NULL WHERE parent_community_id = id`],
        );
      }
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
