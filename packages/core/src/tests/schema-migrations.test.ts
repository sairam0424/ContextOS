import assert from 'node:assert';
import { createTestDb, cleanupTestDb, type TestDB } from './helpers.js';
import { migrateSchema } from '../database/schema.js';

const EXPECTED_TABLES = [
  // core
  'documents', 'vec_documents', 'edges', 'graph_metadata', 'symbols',
  'intelligence_queue', 'locks', 'access_log', 'workspace_config', 'missions',
  // agents
  'agents', 'agent_messages', 'task_nodes', 'task_dependencies',
  'circuit_breaker_state', 'dead_letters', 'event_log',
  // cognitive
  'memory_entries', 'reflections', 'skills',
  // temporal
  'temporal_edges', 'node_states', 'node_events', 'node_metrics',
  'hyperedges', 'hyperedge_members',
  // swarm
  'swarm_sessions', 'proposals', 'vote_requests', 'votes',
  // governance
  'capability_tokens', 'trust_scores', 'trust_events', 'policies', 'anomaly_alerts',
  // streaming + predictive
  'distilled_knowledge', 'memory_summaries', 'co_change_edges',
  'file_ownership', 'community_summaries',
  // ledger
  'schema_migrations',
];

function tableNames(testDb: TestDB): Set<string> {
  const rows = testDb.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as any[];
  return new Set(rows.map((r: any) => r.name).filter((n: string) => !n.startsWith('sqlite_')));
}

function indexExists(testDb: TestDB, name: string): boolean {
  const row = testDb.db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(name) as any;
  return Boolean(row);
}

describe('Schema migrations ledger', function () {
  this.timeout(10000);

  let testDb: TestDB;

  beforeEach(() => {
    // createTestDb runs initializeSchema + migrateSchema on a fresh temp DB.
    testDb = createTestDb('schema-migrations');
  });

  afterEach(() => {
    cleanupTestDb(testDb);
  });

  it('produces the expected table set after init + migrate', () => {
    const tables = tableNames(testDb);
    for (const expected of EXPECTED_TABLES) {
      assert.ok(tables.has(expected), `expected table "${expected}" to exist`);
    }
  });

  it('records every migration unit in schema_migrations', () => {
    const rows = testDb.db.prepare(`SELECT name FROM schema_migrations ORDER BY name`).all() as any[];
    assert.ok(rows.length >= 8, `expected >= 8 recorded migrations, got ${rows.length}`);
    const names = rows.map((r: any) => r.name);
    assert.ok(names.includes('008_hotpath_indexes'), 'hot-path index migration recorded');
  });

  it('is idempotent: re-running migrateSchema does not throw and keeps the ledger stable', () => {
    const before = testDb.db.prepare(`SELECT name FROM schema_migrations ORDER BY name`).all() as any[];

    assert.doesNotThrow(() => {
      migrateSchema(testDb.db);
      migrateSchema(testDb.db);
    });

    const after = testDb.db.prepare(`SELECT name FROM schema_migrations ORDER BY name`).all() as any[];
    assert.strictEqual(after.length, before.length, 'no duplicate migration rows added on re-run');
    assert.deepStrictEqual(
      after.map((r: any) => r.name),
      before.map((r: any) => r.name),
      'recorded migration names are stable across re-runs',
    );
  });

  it('creates the two new hot-path indexes', () => {
    assert.ok(indexExists(testDb, 'idx_intelligence_queue_priority'), 'idx_intelligence_queue_priority exists');
    assert.ok(indexExists(testDb, 'idx_missions_status'), 'idx_missions_status exists');
  });
});
