# Phase 0: Foundation Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical bugs (B1, B3, B5), decompose the 639-line database god-object into focused modules, and add structured logging — creating a solid foundation for service composability in Phase 1.

**Architecture:** The database decomposition follows a "split by domain" strategy: one module per responsibility (schema, documents, vectors, graph, queue, locks, access, missions, config). Each module receives a raw `Database` instance and exposes domain-specific methods. The facade (`DatabaseService`) re-exports everything for backward compatibility while new code imports domain modules directly.

**Tech Stack:** TypeScript (strict, ESNext, NodeNext), better-sqlite3, sqlite-vec, pino (new), Mocha + assert (existing test framework)

---

## File Structure

### New Files (database decomposition)

```
packages/core/src/database/
  connection.ts        — Database connection factory, WAL mode, sqlite-vec loading
  schema.ts            — All CREATE TABLE statements + migrations
  documents.ts         — Document CRUD operations
  vectors.ts           — Vector embeddings + semantic search
  graph.ts             — Edge CRUD + affinity BFS + graph versioning
  queue.ts             — Intelligence queue operations
  locks.ts             — Concurrency lock acquire/release
  access.ts            — Access log + path heat
  missions.ts          — Mission CRUD
  config.ts            — Workspace config key-value store
  symbols.ts           — Code symbol tracking
  index.ts             — DatabaseService facade (backward-compatible)
  types.ts             — Shared interfaces (DBRecord, etc.)
```

### New Files (logging)

```
packages/core/src/logger.ts  — pino logger factory with workspace context
```

### Modified Files

```
packages/core/src/services/database.ts       — DELETE (replaced by database/ modules)
packages/core/src/services/intelligence-queue.ts  — Add structured logging on failure
packages/core/src/services/sampling.ts        — Add 'failed' count to pulse
packages/core/src/services/intelligence.ts    — Structured logging
packages/core/src/index.ts                    — Update exports
packages/core/package.json                    — Add pino dependency
```

### New Test Files

```
packages/core/src/tests/database-decomposition.test.ts  — Verify decomposed modules work
packages/core/src/tests/dead-letter.test.ts             — Verify failed embedding visibility
packages/core/src/tests/vector-dimension.test.ts        — Verify dimension filtering
```

---

## Task 1: Add pino Logger

**Files:**
- Create: `packages/core/src/logger.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Install pino**

```bash
cd packages/core && npm install pino
```

- [ ] **Step 2: Create logger module**

Create `packages/core/src/logger.ts`:

```typescript
import pino from 'pino';

const level = process.env.CONTEXTOS_LOG_LEVEL || 'info';

export const logger = pino({
  name: 'context-os',
  level,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino/file', options: { destination: 1 } }
    : undefined,
});

export function createChildLogger(module: string) {
  return logger.child({ module });
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/logger.ts packages/core/package.json packages/core/package-lock.json
git commit -m "feat(core): add pino structured logger"
```

---

## Task 2: Create Database Types Module

**Files:**
- Create: `packages/core/src/database/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
import type Database from 'better-sqlite3';

export interface DBRecord {
  id?: number;
  path: string;
  title: string;
  content: string;
  excerpt: string;
  mtime: number;
  metadata: string;
  intelligence_status?: string;
  status?: string;
  is_private?: number;
}

export interface EdgeRecord {
  id?: number;
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface LockRecord {
  path: string;
  agent_id: string;
  expires_at: number;
  created_at: number;
}

export interface MissionRecord {
  id?: number;
  path: string;
  title: string;
  status: string;
  priority: number;
  created_at: number;
  due_at?: number;
  metadata?: string;
}

export interface QueueItem {
  id: number;
  doc_id: number;
  priority?: number;
  retry_count?: number;
  last_error?: string;
}

export interface AccessLogEntry {
  id: number;
  path: string;
  action: 'read' | 'write' | 'focus';
  timestamp: number;
}

export type RawDB = Database.Database;
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/database/types.ts
git commit -m "feat(core): add database types module"
```

---

## Task 3: Create Connection Module

**Files:**
- Create: `packages/core/src/database/connection.ts`
- Create: `packages/core/src/tests/database-decomposition.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/tests/database-decomposition.test.ts`:

```typescript
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
```

- [ ] **Step 2: Create connection module**

Create `packages/core/src/database/connection.ts`:

```typescript
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
```

- [ ] **Step 3: Build and run test**

```bash
cd packages/core && npm run build && npx mocha dist/tests/database-decomposition.test.js
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/database/connection.ts packages/core/src/tests/database-decomposition.test.ts
git commit -m "feat(core): extract database connection module"
```

---

## Task 4: Create Schema Module

**Files:**
- Create: `packages/core/src/database/schema.ts`
- Modify: `packages/core/src/tests/database-decomposition.test.ts`

- [ ] **Step 1: Add schema tests to existing test file**

Append to `packages/core/src/tests/database-decomposition.test.ts`:

```typescript
import { initializeSchema, migrateSchema } from '../database/schema.js';

describe('Database Schema Module', function () {
  this.timeout(10000);

  it('creates all tables without error', () => {
    fs.ensureDirSync(TEST_DIR);
    const dbPath = path.join(TEST_DIR, 'schema-test.db');
    const db = createConnection(dbPath);

    initializeSchema(db);

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[])
      .map(r => r.name)
      .filter(n => !n.startsWith('sqlite_'));

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
    migrateSchema(db); // Second call should not throw

    const vecCols = (db.pragma('table_info(vec_documents)') as any[]).map((c: any) => c.name);
    assert.ok(vecCols.includes('dimension'), 'dimension column exists after migration');

    db.close();
  });
});
```

- [ ] **Step 2: Create schema module**

Create `packages/core/src/database/schema.ts`:

```typescript
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

  log.debug('Migrations complete');
}
```

- [ ] **Step 3: Build and run tests**

```bash
cd packages/core && npm run build && npx mocha dist/tests/database-decomposition.test.js
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/database/schema.ts packages/core/src/tests/database-decomposition.test.ts
git commit -m "feat(core): extract database schema and migrations module"
```

---

## Task 5: Create Documents Repository

**Files:**
- Create: `packages/core/src/database/documents.ts`
- Modify: `packages/core/src/tests/database-decomposition.test.ts`

- [ ] **Step 1: Add test for documents repository**

Append to `packages/core/src/tests/database-decomposition.test.ts`:

```typescript
import { DocumentsRepository } from '../database/documents.js';

describe('Documents Repository', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let repo: DocumentsRepository;

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    const dbPath = path.join(TEST_DIR, 'docs-test.db');
    db = createConnection(dbPath);
    initializeSchema(db);
    migrateSchema(db);
    repo = new DocumentsRepository(db);
  });

  after(() => { db.close(); });

  it('upserts and retrieves a document by path', () => {
    repo.upsert({
      path: 'test/doc.md',
      title: 'Test Doc',
      content: 'Hello world',
      excerpt: 'Hello',
      mtime: Date.now(),
      metadata: '["test"]'
    });

    const doc = repo.getByPath('test/doc.md');
    assert.ok(doc);
    assert.strictEqual(doc.title, 'Test Doc');
  });

  it('removes a document', () => {
    repo.remove('test/doc.md');
    const doc = repo.getByPath('test/doc.md');
    assert.strictEqual(doc, undefined);
  });
});
```

- [ ] **Step 2: Create documents module**

Create `packages/core/src/database/documents.ts`:

```typescript
import type { RawDB, DBRecord } from './types.js';

export class DocumentsRepository {
  constructor(private db: RawDB) {}

  upsert(record: Omit<DBRecord, 'id'>): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO documents (path, title, content, excerpt, mtime, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        excerpt = excluded.excerpt,
        mtime = excluded.mtime,
        metadata = excluded.metadata
      RETURNING id
    `);
    return stmt.get(record.path, record.title, record.content, record.excerpt, record.mtime, record.metadata) as { id: number };
  }

  updateStatus(path: string, status: string): void {
    this.db.prepare(`UPDATE documents SET status = ? WHERE path = ?`).run(status, path);
  }

  setIntelligenceStatus(docId: number, status: 'pending' | 'processing' | 'ready' | 'failed'): void {
    this.db.prepare(`UPDATE documents SET intelligence_status = ? WHERE id = ?`).run(status, docId);
  }

  getById(id: number): DBRecord | undefined {
    return this.db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DBRecord | undefined;
  }

  getByPath(filePath: string): DBRecord | undefined {
    return this.db.prepare(`SELECT * FROM documents WHERE path = ?`).get(filePath) as DBRecord | undefined;
  }

  remove(filePath: string): void {
    this.db.prepare(`DELETE FROM documents WHERE path = ?`).run(filePath);
  }

  getAll(): DBRecord[] {
    return this.db.prepare(`SELECT * FROM documents`).all() as DBRecord[];
  }
}
```

- [ ] **Step 3: Build and run tests**

```bash
cd packages/core && npm run build && npx mocha dist/tests/database-decomposition.test.js
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/database/documents.ts packages/core/src/tests/database-decomposition.test.ts
git commit -m "feat(core): extract documents repository module"
```

---

## Task 6: Create Vectors Repository (Bug B1 Fix)

**Files:**
- Create: `packages/core/src/database/vectors.ts`
- Create: `packages/core/src/tests/vector-dimension.test.ts`

- [ ] **Step 1: Write the failing test for dimension filtering**

Create `packages/core/src/tests/vector-dimension.test.ts`:

```typescript
import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { DocumentsRepository } from '../database/documents.js';
import { VectorsRepository } from '../database/vectors.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-vectors');

describe('Vectors Repository - Dimension Filtering (Bug B1)', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let docs: DocumentsRepository;
  let vectors: VectorsRepository;

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'vectors.db'));
    initializeSchema(db);
    migrateSchema(db);
    docs = new DocumentsRepository(db);
    vectors = new VectorsRepository(db);

    const doc384 = docs.upsert({ path: 'a.md', title: 'A', content: 'alpha', excerpt: 'a', mtime: 1, metadata: '[]' });
    const doc768 = docs.upsert({ path: 'b.md', title: 'B', content: 'beta', excerpt: 'b', mtime: 1, metadata: '[]' });

    vectors.upsert(doc384.id, new Float32Array(384).fill(0.1), 'local');
    vectors.upsert(doc768.id, new Float32Array(768).fill(0.2), 'gemini');
  });

  after(() => {
    db.close();
    fs.removeSync(TEST_DIR);
  });

  it('searchSemantic only returns vectors matching query dimension', () => {
    const query384 = new Float32Array(384).fill(0.1);
    const results = vectors.searchSemantic(query384, 10);

    assert.ok(results.length > 0, 'Should return results');
    results.forEach((r: any) => {
      assert.notStrictEqual(r.path, 'b.md', 'Should not return 768D doc when querying with 384D');
    });
  });

  it('getTopKNeighbors only compares same-dimension vectors', () => {
    const doc = docs.getByPath('a.md');
    assert.ok(doc);
    const neighbors = vectors.getTopKNeighbors(doc.id!, 5);

    neighbors.forEach((n: any) => {
      assert.notStrictEqual(n.path, 'b.md', 'Should not compare across dimensions');
    });
  });
});
```

- [ ] **Step 2: Create vectors module with dimension filtering**

Create `packages/core/src/database/vectors.ts`:

```typescript
import type { RawDB } from './types.js';

export class VectorsRepository {
  constructor(private db: RawDB) {}

  upsert(docId: number, embedding: Float32Array, provider: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO vec_documents (id, embedding, provider, dimension)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        embedding = excluded.embedding,
        provider = excluded.provider,
        dimension = excluded.dimension
    `);
    stmt.run(docId, Buffer.from(embedding.buffer), provider, embedding.length);
  }

  getForDocument(docId: number): Float32Array | undefined {
    const row = this.db.prepare('SELECT embedding FROM vec_documents WHERE id = ?').get(docId) as { embedding: Buffer } | undefined;
    if (!row) return undefined;
    return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
  }

  getDimension(docId: number): number | undefined {
    const row = this.db.prepare('SELECT dimension FROM vec_documents WHERE id = ?').get(docId) as { dimension: number } | undefined;
    return row?.dimension;
  }

  searchSemantic(queryEmbedding: Float32Array, limit: number = 10): any[] {
    const stmt = this.db.prepare(`
      SELECT
        d.id, d.path, d.title, d.excerpt,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE v.dimension = ?
      ORDER BY distance ASC
      LIMIT ?
    `);
    return stmt.all(Buffer.from(queryEmbedding.buffer), queryEmbedding.length, limit) as any[];
  }

  getTopKNeighbors(docId: number, k: number = 3): any[] {
    const embedding = this.getForDocument(docId);
    if (!embedding) return [];

    const stmt = this.db.prepare(`
      SELECT
        d.path, d.title,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE d.id != ? AND v.dimension = ?
      ORDER BY distance ASC
      LIMIT ?
    `);

    return stmt.all(Buffer.from(embedding.buffer), docId, embedding.length, k) as any[];
  }

  searchHybrid(queryEmbedding: Float32Array, queryText: string, limit: number = 10, includePrivate: boolean = false, offset: number = 0) {
    const privateFilter = includePrivate ? '' : 'AND d.is_private = 0';

    const semanticStmt = this.db.prepare(`
      SELECT
        d.id, d.path, d.title, d.excerpt,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE d.status = 'active' AND v.dimension = ? ${privateFilter}
      ORDER BY distance ASC
      LIMIT ? OFFSET ?
    `);
    const semanticResults = semanticStmt.all(
      Buffer.from(queryEmbedding.buffer), queryEmbedding.length, limit, offset
    ) as any[];

    const safeQuery = queryText.replace(/"/g, '""');
    const keywordStmt = this.db.prepare(`
      SELECT d.id, d.path, d.title, d.excerpt, rank
      FROM fts_documents fts
      JOIN documents d ON fts.rowid = d.id
      WHERE fts_documents MATCH ? AND d.status = 'active' ${privateFilter}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `);
    const keywordResults = keywordStmt.all('"' + safeQuery + '"', limit, offset) as any[];

    const combined = this.fuseResults(semanticResults, keywordResults, limit);
    return { semanticResults, keywordResults, combined };
  }

  private fuseResults(semantic: any[], keyword: any[], limit: number): any[] {
    const scores = new Map<string, { score: number; record: any }>();

    semantic.forEach((r, i) => {
      const score = (1 - r.distance) * 0.7 + (1 / (i + 1)) * 0.3;
      scores.set(r.path, { score, record: r });
    });

    keyword.forEach((r, i) => {
      const score = (1 / (i + 1)) * 0.5;
      const existing = scores.get(r.path);
      if (existing) {
        existing.score += score;
      } else {
        scores.set(r.path, { score, record: r });
      }
    });

    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(v => ({ ...v.record, fusedScore: v.score }));
  }
}
```

- [ ] **Step 3: Build and run tests**

```bash
cd packages/core && npm run build && npx mocha dist/tests/vector-dimension.test.js
```

Expected: All tests PASS (dimension filtering works)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/database/vectors.ts packages/core/src/tests/vector-dimension.test.ts
git commit -m "fix(core): add dimension filtering to searchSemantic and getTopKNeighbors (B1)"
```

---

## Task 7: Create Graph Repository

**Files:**
- Create: `packages/core/src/database/graph.ts`

- [ ] **Step 1: Create graph module**

Create `packages/core/src/database/graph.ts`:

```typescript
import type { RawDB } from './types.js';

export class GraphRepository {
  constructor(private db: RawDB) {}

  getVersion(): number {
    const row = this.db.prepare(`SELECT value FROM graph_metadata WHERE key = 'graph_version'`).get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  bumpVersion(): void {
    this.db.prepare(`UPDATE graph_metadata SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'graph_version'`).run();
  }

  upsertEdge(source: string, target: string, type: string, weight: number): void {
    this.db.prepare(`
      INSERT INTO edges (source, target, type, weight)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source, target, type) DO UPDATE SET weight = excluded.weight
    `).run(source, target, type, weight);
    this.bumpVersion();
  }

  removeEdgesForSource(source: string): void {
    this.db.prepare(`DELETE FROM edges WHERE source = ?`).run(source);
    this.bumpVersion();
  }

  removeEdgesForSourceByType(source: string, type: string): void {
    this.db.prepare(`DELETE FROM edges WHERE source = ? AND type = ?`).run(source, type);
    this.bumpVersion();
  }

  removeEdge(source: string, target: string, type: string): void {
    this.db.prepare(`DELETE FROM edges WHERE source = ? AND target = ? AND type = ?`).run(source, target, type);
    this.bumpVersion();
  }

  getAll(): any[] {
    return this.db.prepare(`SELECT * FROM edges`).all();
  }

  getAffinities(nodePath: string, maxHops: number = 3, minWeight: number = 0.05): Map<string, number> {
    const stmt = this.db.prepare(`
      WITH RECURSIVE walk(node, depth, weight) AS (
        SELECT target, 1, weight FROM edges WHERE source = ?
        UNION ALL
        SELECT e.target, w.depth + 1, w.weight * e.weight * 0.4
        FROM walk w
        JOIN edges e ON e.source = w.node
        WHERE w.depth < ? AND w.weight * e.weight * 0.4 > ?
      )
      SELECT node, MAX(weight) as affinity FROM walk GROUP BY node
    `);

    const rows = stmt.all(nodePath, maxHops, minWeight) as any[];
    const affinities = new Map<string, number>();
    rows.forEach(r => affinities.set(r.node, r.affinity));
    return affinities;
  }
}
```

- [ ] **Step 2: Build and verify compilation**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/database/graph.ts
git commit -m "feat(core): extract graph repository module"
```

---

## Task 8: Create Remaining Repository Modules

**Files:**
- Create: `packages/core/src/database/queue.ts`
- Create: `packages/core/src/database/locks.ts`
- Create: `packages/core/src/database/access.ts`
- Create: `packages/core/src/database/missions.ts`
- Create: `packages/core/src/database/config.ts`
- Create: `packages/core/src/database/symbols.ts`

- [ ] **Step 1: Create queue module**

Create `packages/core/src/database/queue.ts`:

```typescript
import type { RawDB, QueueItem } from './types.js';

export class QueueRepository {
  constructor(private db: RawDB) {}

  add(docId: number, priority: number = 1): void {
    this.db.prepare(`
      INSERT INTO intelligence_queue (doc_id, priority)
      VALUES (?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET priority = excluded.priority
    `).run(docId, priority);
  }

  getNext(): QueueItem | undefined {
    return this.db.prepare(`SELECT id, doc_id FROM intelligence_queue ORDER BY priority DESC, id ASC LIMIT 1`).get() as QueueItem | undefined;
  }

  getBatch(n: number): QueueItem[] {
    return this.db.prepare(`SELECT id, doc_id FROM intelligence_queue ORDER BY priority DESC, id ASC LIMIT ?`).all(n) as QueueItem[];
  }

  remove(id: number): void {
    this.db.prepare(`DELETE FROM intelligence_queue WHERE id = ?`).run(id);
  }

  incrementRetry(id: number, errorMsg: string): void {
    this.db.prepare(`UPDATE intelligence_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`).run(errorMsg, id);
  }

  getRetryCount(id: number): number {
    const row = this.db.prepare(`SELECT retry_count FROM intelligence_queue WHERE id = ?`).get(id) as { retry_count: number } | undefined;
    return row?.retry_count ?? 0;
  }

  getFailedCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM documents WHERE intelligence_status = 'failed'`).get() as { count: number };
    return row.count;
  }
}
```

- [ ] **Step 2: Create locks module**

Create `packages/core/src/database/locks.ts`:

```typescript
import type { RawDB, LockRecord } from './types.js';

export class LocksRepository {
  constructor(private db: RawDB) {}

  acquire(path: string, agentId: string, durationMs: number = 300000): void {
    const expiresAt = Date.now() + durationMs;
    this.db.prepare(`
      INSERT INTO locks (path, agent_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        agent_id = excluded.agent_id,
        expires_at = excluded.expires_at
      WHERE locks.expires_at < ? OR locks.agent_id = ?
    `).run(path, agentId, expiresAt, Date.now(), Date.now(), agentId);
  }

  release(path: string, agentId: string): void {
    this.db.prepare(`DELETE FROM locks WHERE path = ? AND agent_id = ?`).run(path, agentId);
  }

  get(path: string): LockRecord | undefined {
    const lock = this.db.prepare(`SELECT * FROM locks WHERE path = ?`).get(path) as LockRecord | undefined;
    if (lock && lock.expires_at < Date.now()) {
      this.db.prepare(`DELETE FROM locks WHERE path = ?`).run(path);
      return undefined;
    }
    return lock;
  }
}
```

- [ ] **Step 3: Create access module**

Create `packages/core/src/database/access.ts`:

```typescript
import type { RawDB, AccessLogEntry } from './types.js';

export class AccessRepository {
  constructor(private db: RawDB) {}

  log(path: string, action: 'read' | 'write' | 'focus'): void {
    this.db.prepare(`INSERT INTO access_log (path, action) VALUES (?, ?)`).run(path, action);
  }

  getPathHeat(path: string, windowMs: number = 3600000): number {
    const cutoff = Date.now() - windowMs;
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM access_log WHERE path = ? AND timestamp > ?`).get(path, cutoff) as { count: number };
    return row.count;
  }

  prune(maxAgeMs: number = 86400000): void {
    const cutoff = Date.now() - maxAgeMs;
    this.db.prepare(`DELETE FROM access_log WHERE timestamp < ?`).run(cutoff);
  }

  getLog(limit: number = 50, pathFilter?: string): AccessLogEntry[] {
    if (pathFilter) {
      return this.db.prepare(`SELECT * FROM access_log WHERE path LIKE ? ORDER BY timestamp DESC LIMIT ?`).all('%' + pathFilter + '%', limit) as AccessLogEntry[];
    }
    return this.db.prepare(`SELECT * FROM access_log ORDER BY timestamp DESC LIMIT ?`).all(limit) as AccessLogEntry[];
  }
}
```

- [ ] **Step 4: Create missions module**

Create `packages/core/src/database/missions.ts`:

```typescript
import type { RawDB, MissionRecord } from './types.js';

export class MissionsRepository {
  constructor(private db: RawDB) {}

  create(title: string, path: string, priority: number = 1, dueAt?: number, metadata?: string): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO missions (title, path, priority, due_at, metadata)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `);
    return stmt.get(title, path, priority, dueAt ?? null, metadata ?? '{}') as { id: number };
  }

  list(status?: string): MissionRecord[] {
    if (status) {
      return this.db.prepare(`SELECT * FROM missions WHERE status = ? ORDER BY priority DESC`).all(status) as MissionRecord[];
    }
    return this.db.prepare(`SELECT * FROM missions ORDER BY priority DESC`).all() as MissionRecord[];
  }

  updateStatus(path: string, status: string): void {
    this.db.prepare(`UPDATE missions SET status = ? WHERE path = ?`).run(status, path);
  }

  getAll(): MissionRecord[] {
    return this.db.prepare(`SELECT * FROM missions`).all() as MissionRecord[];
  }
}
```

- [ ] **Step 5: Create config module**

Create `packages/core/src/database/config.ts`:

```typescript
import type { RawDB } from './types.js';

export class ConfigRepository {
  constructor(private db: RawDB) {}

  get(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM workspace_config WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO workspace_config (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  getNumber(key: string, defaultValue: number): number {
    const val = this.get(key);
    return val ? parseInt(val, 10) : defaultValue;
  }
}
```

- [ ] **Step 6: Create symbols module**

Create `packages/core/src/database/symbols.ts`:

```typescript
import type { RawDB } from './types.js';

export class SymbolsRepository {
  constructor(private db: RawDB) {}

  upsert(name: string, filePath: string, line: number, type: string, signature: string, hash: string): void {
    this.db.prepare(`
      INSERT INTO symbols (name, path, line, type, signature, hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name, path) DO UPDATE SET
        line = excluded.line,
        type = excluded.type,
        signature = excluded.signature,
        hash = excluded.hash
    `).run(name, filePath, line, type, signature, hash);
  }

  removeForPath(filePath: string): void {
    this.db.prepare(`DELETE FROM symbols WHERE path = ?`).run(filePath);
  }

  getByName(name: string): any | undefined {
    return this.db.prepare(`SELECT * FROM symbols WHERE name = ?`).get(name);
  }

  getAll(): any[] {
    return this.db.prepare(`SELECT * FROM symbols`).all();
  }
}
```

- [ ] **Step 7: Build and verify all compile**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/database/queue.ts packages/core/src/database/locks.ts packages/core/src/database/access.ts packages/core/src/database/missions.ts packages/core/src/database/config.ts packages/core/src/database/symbols.ts
git commit -m "feat(core): extract queue, locks, access, missions, config, symbols repositories"
```

---

## Task 9: Create DatabaseService Facade

**Files:**
- Create: `packages/core/src/database/index.ts`

- [ ] **Step 1: Create the backward-compatible facade**

Create `packages/core/src/database/index.ts`:

```typescript
import Database from 'better-sqlite3';
import { createConnection } from './connection.js';
import { initializeSchema, migrateSchema } from './schema.js';
import { DocumentsRepository } from './documents.js';
import { VectorsRepository } from './vectors.js';
import { GraphRepository } from './graph.js';
import { QueueRepository } from './queue.js';
import { LocksRepository } from './locks.js';
import { AccessRepository } from './access.js';
import { MissionsRepository } from './missions.js';
import { ConfigRepository } from './config.js';
import { SymbolsRepository } from './symbols.js';
import { createChildLogger } from '../logger.js';
import path from 'path';

import type { DBRecord } from './types.js';

export type { DBRecord, EdgeRecord, LockRecord, MissionRecord, QueueItem, AccessLogEntry, RawDB } from './types.js';
export { createConnection } from './connection.js';
export { initializeSchema, migrateSchema } from './schema.js';
export { DocumentsRepository } from './documents.js';
export { VectorsRepository } from './vectors.js';
export { GraphRepository } from './graph.js';
export { QueueRepository } from './queue.js';
export { LocksRepository } from './locks.js';
export { AccessRepository } from './access.js';
export { MissionsRepository } from './missions.js';
export { ConfigRepository } from './config.js';
export { SymbolsRepository } from './symbols.js';

const log = createChildLogger('database');

export class DatabaseService {
  private db: Database.Database;
  public readonly documents: DocumentsRepository;
  public readonly vectors: VectorsRepository;
  public readonly graph: GraphRepository;
  public readonly queue: QueueRepository;
  public readonly locks: LocksRepository;
  public readonly access: AccessRepository;
  public readonly missions: MissionsRepository;
  public readonly config: ConfigRepository;
  public readonly symbols: SymbolsRepository;

  constructor(workspaceRoot: string) {
    const dbPath = path.join(workspaceRoot, '.context-db', 'context.db');
    this.db = createConnection(dbPath);
    initializeSchema(this.db);
    migrateSchema(this.db);

    this.documents = new DocumentsRepository(this.db);
    this.vectors = new VectorsRepository(this.db);
    this.graph = new GraphRepository(this.db);
    this.queue = new QueueRepository(this.db);
    this.locks = new LocksRepository(this.db);
    this.access = new AccessRepository(this.db);
    this.missions = new MissionsRepository(this.db);
    this.config = new ConfigRepository(this.db);
    this.symbols = new SymbolsRepository(this.db);

    log.info({ dbPath }, 'DatabaseService initialized');
  }

  // Backward-compatible delegating methods
  getGraphVersion() { return this.graph.getVersion(); }
  upsertEdge(source: string, target: string, type: string, weight: number) { this.graph.upsertEdge(source, target, type, weight); }
  removeEdgesForSource(source: string) { this.graph.removeEdgesForSource(source); }
  removeEdgesForSourceByType(source: string, type: string) { this.graph.removeEdgesForSourceByType(source, type); }
  removeEdge(source: string, target: string, type: string) { this.graph.removeEdge(source, target, type); }
  getAllEdges() { return this.graph.getAll(); }
  getAffinities(nodePath: string, maxHops?: number, minWeight?: number) { return this.graph.getAffinities(nodePath, maxHops, minWeight); }

  upsertDocument(record: Omit<DBRecord, 'id'>) { return this.documents.upsert(record); }
  updateDocumentStatus(p: string, status: string) { this.documents.updateStatus(p, status); }
  getDocumentById(id: number) { return this.documents.getById(id); }
  getDocumentByPath(filePath: string) { return this.documents.getByPath(filePath); }
  removeDocument(filePath: string) { this.documents.remove(filePath); }
  getAllDocuments() { return this.documents.getAll(); }

  upsertVector(docId: number, embedding: Float32Array, provider: string) { this.vectors.upsert(docId, embedding, provider); }
  getVectorForDocument(docId: number) { return this.vectors.getForDocument(docId); }
  searchSemantic(queryEmbedding: Float32Array, limit?: number) { return this.vectors.searchSemantic(queryEmbedding, limit); }
  getTopKNeighbors(docId: number, k?: number) { return this.vectors.getTopKNeighbors(docId, k); }
  searchHybrid(queryEmbedding: Float32Array, queryText: string, limit?: number, includePrivate?: boolean, offset?: number) {
    return this.vectors.searchHybrid(queryEmbedding, queryText, limit, includePrivate, offset);
  }

  addToQueue(docId: number, priority?: number) { this.queue.add(docId, priority); }
  getNextFromQueue() { return this.queue.getNext(); }
  getBatchFromQueue(n: number) { return this.queue.getBatch(n); }
  removeFromQueue(id: number) { this.queue.remove(id); }
  incrementQueueRetry(id: number, errorMsg: string) { this.queue.incrementRetry(id, errorMsg); }
  getQueueItemRetryCount(id: number) { return this.queue.getRetryCount(id); }
  setIntelligenceStatus(docId: number, status: 'pending' | 'processing' | 'ready' | 'failed') { this.documents.setIntelligenceStatus(docId, status); }

  upsertSymbol(name: string, p: string, line: number, type: string, sig: string, hash: string) { this.symbols.upsert(name, p, line, type, sig, hash); }
  removeSymbolsForPath(filePath: string) { this.symbols.removeForPath(filePath); }
  getSymbolByName(name: string) { return this.symbols.getByName(name); }
  getAllSymbols() { return this.symbols.getAll(); }

  acquireLock(p: string, agentId: string, durationMs?: number) { this.locks.acquire(p, agentId, durationMs); }
  releaseLock(p: string, agentId: string) { this.locks.release(p, agentId); }
  getLock(p: string) { return this.locks.get(p); }

  logAccess(p: string, action: 'read' | 'write' | 'focus') { this.access.log(p, action); }
  getPathHeat(p: string, windowMs?: number) { return this.access.getPathHeat(p, windowMs); }
  pruneAccessLog(maxAgeMs?: number) { this.access.prune(maxAgeMs); }
  getAccessLog(limit?: number, pathFilter?: string) { return this.access.getLog(limit, pathFilter); }

  createMission(title: string, p: string, priority?: number, dueAt?: number, metadata?: string) { return this.missions.create(title, p, priority, dueAt, metadata); }
  listMissions(status?: string) { return this.missions.list(status); }
  updateMissionStatus(p: string, status: string) { this.missions.updateStatus(p, status); }
  getAllMissions() { return this.missions.getAll(); }

  getConfig(key: string) { return this.config.get(key); }
  setConfig(key: string, value: string) { this.config.set(key, value); }

  close() {
    this.db.close();
    log.debug('Database connection closed');
  }
}

// Singleton (backward compat - will be removed in Phase 1)
import { getWorkspaceRoot } from '../context.js';

let _sharedInstance: DatabaseService | null = null;

export function getSharedDatabase(): DatabaseService {
  if (!_sharedInstance) {
    _sharedInstance = new DatabaseService(getWorkspaceRoot());
  }
  return _sharedInstance;
}
```

- [ ] **Step 2: Build and verify**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/database/index.ts
git commit -m "feat(core): create DatabaseService facade with backward-compatible API"
```

---

## Task 10: Wire Up New Modules and Remove Old File

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: all files importing from `./services/database.js` or `../services/database.js`
- Delete: `packages/core/src/services/database.ts`

- [ ] **Step 1: Update main index.ts exports**

In `packages/core/src/index.ts`, replace the database re-export line:

Change `from './services/database.js'` to `from './database/index.js'`

- [ ] **Step 2: Update service imports**

In each file under `packages/core/src/services/`, change:
- `from './database.js'` to `from '../database/index.js'`

Files to update (find with grep):
```bash
grep -rn "from './database.js'\|from '../services/database.js'" packages/core/src/services/
```

Update each match.

- [ ] **Step 3: Delete old file**

```bash
rm packages/core/src/services/database.ts
```

- [ ] **Step 4: Full monorepo build**

```bash
cd /Users/sairamugge/Desktop/ContextOS && npm run build
```

Expected: All 4 workspaces build successfully

- [ ] **Step 5: Run full test suite**

```bash
npm run test
```

Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(core): replace monolithic database.ts with decomposed modules

The 639-line god-object is now 13 focused files averaging ~60 lines each.
All existing consumers use backward-compatible facade methods.
New code can import domain repositories directly."
```

---

## Task 11: Fix Bug B5 — Dead-Letter Visibility

**Files:**
- Modify: `packages/core/src/services/sampling.ts`
- Modify: `packages/core/src/services/intelligence-queue.ts`
- Create: `packages/core/src/tests/dead-letter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/tests/dead-letter.test.ts`:

```typescript
import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { DocumentsRepository } from '../database/documents.js';
import { SamplingService } from '../services/sampling.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-deadletter');

describe('Dead-Letter Visibility (Bug B5)', function () {
  this.timeout(10000);

  after(() => {
    fs.removeSync(TEST_DIR);
  });

  it('pulse includes failed count in intelligenceStatus', async () => {
    fs.ensureDirSync(TEST_DIR);
    const dbPath = path.join(TEST_DIR, 'deadletter.db');
    const db = createConnection(dbPath);
    initializeSchema(db);
    migrateSchema(db);

    const docs = new DocumentsRepository(db);

    docs.upsert({ path: 'ok.md', title: 'OK', content: 'c', excerpt: 'e', mtime: 1, metadata: '["tag"]' });
    docs.upsert({ path: 'fail.md', title: 'Fail', content: 'c', excerpt: 'e', mtime: 1, metadata: '["tag"]' });

    db.prepare("UPDATE documents SET intelligence_status = 'ready' WHERE path = 'ok.md'").run();
    db.prepare("UPDATE documents SET intelligence_status = 'failed' WHERE path = 'fail.md'").run();

    const mockDbService = { getAllDocuments: () => docs.getAll() } as any;
    const sampling = new SamplingService(mockDbService);
    const pulse = await sampling.getPulse();

    assert.strictEqual(pulse.intelligenceStatus.failed, 1, 'Should report 1 failed');
    assert.strictEqual(pulse.intelligenceStatus.ready, 1, 'Should report 1 ready');

    db.close();
  });
});
```

- [ ] **Step 2: Update WorkspacePulse interface to include failed**

In `packages/core/src/services/sampling.ts`, update the interface:

```typescript
export interface WorkspacePulse {
    timestamp: number;
    healthScore: number;
    topTags: string[];
    activeEntities: string[];
    recentChanges: string[];
    intelligenceStatus: {
        pending: number;
        processing: number;
        ready: number;
        failed: number;
    };
}
```

And update the initialization in `getPulse()`:

```typescript
const intelligenceStatus = {
    pending: 0,
    processing: 0,
    ready: 0,
    failed: 0
};
```

- [ ] **Step 3: Update intelligence-queue.ts with structured logging**

In `packages/core/src/services/intelligence-queue.ts`, add at top:

```typescript
import { createChildLogger } from '../logger.js';
const log = createChildLogger('intelligence-queue');
```

Replace `console.log/error/warn` calls:
- `console.log(...)` becomes `log.info({ path: doc.path }, 'Intelligence ready')`
- `console.error(...)` becomes `log.error({ docId: item.doc_id, retries }, 'Max retries reached')`
- `console.warn(...)` becomes `log.warn({ docId: item.doc_id, retries, error: errMsg }, 'Retry scheduled')`

- [ ] **Step 4: Build and run test**

```bash
cd packages/core && npm run build && npx mocha dist/tests/dead-letter.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/sampling.ts packages/core/src/services/intelligence-queue.ts packages/core/src/tests/dead-letter.test.ts
git commit -m "fix(core): surface failed embedding count in workspace pulse (B5)"
```

---

## Task 12: Replace console Calls in Remaining Services

**Files:**
- Modify: `packages/core/src/services/intelligence.ts`
- Modify: `packages/core/src/services/knowledge-graph.ts`
- Modify: `packages/core/src/services/watch.ts`
- Modify: `packages/core/src/services/repair.ts`
- Modify: `packages/core/src/services/federation.ts`
- Modify: `packages/core/src/indexer.ts`

- [ ] **Step 1: Add structured logger to each service**

For each file, add near the top:

```typescript
import { createChildLogger } from '../logger.js';
const log = createChildLogger('<module-name>');
```

Module names: `intelligence`, `knowledge-graph`, `watch`, `repair`, `federation`, `indexer`

Replace all `console.log/warn/error` with structured `log.info/warn/error` calls using object-first format:
- `console.log('[Module] Message: ' + var)` becomes `log.info({ var }, 'Message')`
- `console.error('[Module] Error:', err)` becomes `log.error({ err }, 'Error description')`

- [ ] **Step 2: Build full project**

```bash
cd /Users/sairamugge/Desktop/ContextOS && npm run build
```

Expected: Builds successfully

- [ ] **Step 3: Run all tests**

```bash
npm run test
```

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/ packages/core/src/indexer.ts
git commit -m "refactor(core): replace console calls with pino structured logging"
```

---

## Task 13: Final Validation

**Files:** None (verification only)

- [ ] **Step 1: Clean build from scratch**

```bash
cd /Users/sairamugge/Desktop/ContextOS && rm -rf packages/core/dist && npm run build
```

Expected: Clean build, no errors

- [ ] **Step 2: Run full test suite**

```bash
npm run test
```

Expected: All tests pass (existing + 3 new test files)

- [ ] **Step 3: Run validate (pre-commit hook equivalent)**

```bash
npm run validate
```

Expected: Full validation passes

- [ ] **Step 4: Verify downstream packages compile**

```bash
cd workspace-mcp && npx tsc --noEmit && cd ../workspace-cli && npx tsc --noEmit
```

Expected: No type errors in consumers of @context-os/core

- [ ] **Step 5: Verify file count and sizes**

```bash
wc -l packages/core/src/database/*.ts
```

Expected: No file exceeds 200 lines; total should be ~600-700 lines (same functionality, better organized)

- [ ] **Step 6: Tag phase completion**

```bash
git tag phase0-complete
```

---

## Summary

| Task | What | Bug Fixed | Lines |
|------|------|-----------|-------|
| 1 | pino logger | — | ~15 |
| 2 | Database types | — | ~60 |
| 3 | Connection module | — | ~20 |
| 4 | Schema module | — | ~130 |
| 5 | Documents repository | — | ~45 |
| 6 | Vectors repository | B1 (dimensions) | ~100 |
| 7 | Graph repository | — | ~55 |
| 8 | Queue/locks/access/missions/config/symbols | — | ~180 |
| 9 | Facade (backward compat) | — | ~120 |
| 10 | Wire up + delete old | — | — |
| 11 | Dead-letter in pulse | B5 (visibility) | ~15 |
| 12 | Structured logging | — | — |
| 13 | Final validation | — | — |

**Bug B3 status:** Already fixed in current codebase (`daily/` is in ALLOWED_BUCKETS). No action needed.

**Phase 0 exit criteria:**
- [ ] All 4 documented bugs addressed (B1, B3 verified, B5, B6 deferred to dashboard phase)
- [ ] database.ts decomposed into 13 focused modules
- [ ] pino structured logging in all core services
- [ ] All existing + new tests pass
- [ ] Full monorepo build + validate clean
