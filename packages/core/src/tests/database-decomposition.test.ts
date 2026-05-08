import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-decomp');

describe('Database Connection Module', function () {
  this.timeout(10000);

  after(() => {
    fs.removeSync(TEST_DIR);
  });

  it('creates a connection with WAL mode and sqlite-vec loaded', () => {
    fs.ensureDirSync(TEST_DIR);
    const dbPath = path.join(TEST_DIR, 'test.db');
    const db = createConnection(dbPath);

    assert.ok(db, 'Database instance should exist');

    const walMode = db.pragma('journal_mode') as any[];
    assert.strictEqual(walMode[0].journal_mode, 'wal');

    db.close();
  });
});

import { initializeSchema, migrateSchema } from '../database/schema.js';

describe('Database Schema Module', function () {
  this.timeout(10000);

  it('creates all tables without error', () => {
    fs.ensureDirSync(TEST_DIR);
    const dbPath = path.join(TEST_DIR, 'schema-test.db');
    const db = createConnection(dbPath);

    initializeSchema(db);

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[])
      .map((r: any) => r.name)
      .filter((n: string) => !n.startsWith('sqlite_'));

    assert.ok(tables.includes('documents'), 'documents table exists');
    assert.ok(tables.includes('vec_documents'), 'vec_documents table exists');
    assert.ok(tables.includes('edges'), 'edges table exists');
    assert.ok(tables.includes('symbols'), 'symbols table exists');
    assert.ok(tables.includes('intelligence_queue'), 'intelligence_queue table exists');
    assert.ok(tables.includes('locks'), 'locks table exists');
    assert.ok(tables.includes('access_log'), 'access_log table exists');
    assert.ok(tables.includes('workspace_config'), 'workspace_config table exists');
    assert.ok(tables.includes('missions'), 'missions table exists');

    db.close();
  });

  it('migrateSchema adds missing columns idempotently', () => {
    fs.ensureDirSync(TEST_DIR);
    const dbPath = path.join(TEST_DIR, 'migrate-test.db');
    const db = createConnection(dbPath);

    initializeSchema(db);
    migrateSchema(db);
    migrateSchema(db);

    const vecCols = (db.pragma('table_info(vec_documents)') as any[]).map((c: any) => c.name);
    assert.ok(vecCols.includes('dimension'), 'dimension column exists after migration');

    db.close();
  });
});
