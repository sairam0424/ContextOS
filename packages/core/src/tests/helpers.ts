import path from 'node:path';
import fs from 'fs-extra';
import os from 'node:os';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import type { RawDB } from '../database/types.js';

export interface TestDB {
  db: RawDB;
  dir: string;
  path: string;
}

export function createTestDb(name: string): TestDB {
  const dir = path.join(os.tmpdir(), `contextos-test-${name}-${Date.now()}`);
  fs.ensureDirSync(dir);
  const dbPath = path.join(dir, 'test.db');
  const db = createConnection(dbPath);
  initializeSchema(db);
  migrateSchema(db);
  return { db, dir, path: dbPath };
}

export function cleanupTestDb(testDb: TestDB): void {
  try {
    testDb.db.close();
  } catch { /* already closed */ }
  try {
    fs.removeSync(testDb.dir);
  } catch { /* best effort */ }
}
