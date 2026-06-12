import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'fs-extra';
import path from 'path';
import { createChildLogger } from '../logger.js';
import { instrumentConnection } from './query-metrics.js';
import type { MetricsCollector } from '../metrics/collector.js';

const log = createChildLogger('database:connection');

export interface ConnectionOptions {
  /**
   * When provided, query latency is recorded into this collector and slow
   * queries are logged. Omit it (the default) for zero instrumentation
   * overhead on the hot path.
   */
  metrics?: MetricsCollector;
}

export function createConnection(dbPath: string, options: ConnectionOptions = {}): Database.Database {
  const dbDir = path.dirname(dbPath);
  fs.ensureDirSync(dbDir);

  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');     // 64MB
  db.pragma('mmap_size = 268435456');   // 256MB
  db.pragma('temp_store = MEMORY');

  log.debug({ dbPath }, 'Database connection opened');

  // Off-by-default-safe: only wrap when a collector is supplied so the
  // uninstrumented path keeps the raw better-sqlite3 connection untouched.
  return options.metrics ? instrumentConnection(db, options.metrics) : db;
}
