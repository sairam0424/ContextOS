import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'fs-extra';
import path from 'path';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('database:connection');

export function createConnection(dbPath: string): Database.Database {
  const dbDir = path.dirname(dbPath);
  fs.ensureDirSync(dbDir);

  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  log.debug({ dbPath }, 'Database connection opened');
  return db;
}
