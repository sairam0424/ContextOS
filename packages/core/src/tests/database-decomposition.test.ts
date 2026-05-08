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
