import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import fs from 'fs-extra';

export interface DBRecord {
  id?: number;
  path: string;
  title: string;
  content: string;
  excerpt: string;
  mtime: number;
  metadata: string; // JSON string
  intelligence_status?: string;
}

export class DatabaseService {
  private db: Database.Database;
  private dbPath: string;

  constructor(workspaceRoot: string) {
    const dbDir = path.join(workspaceRoot, '.context-db');
    fs.ensureDirSync(dbDir);
    this.dbPath = path.join(dbDir, 'context.db');
    
    this.db = new Database(this.dbPath);
    
    // Load sqlite-vec extension
    sqliteVec.load(this.db);
    
    this.initializeSchema();
  }

  private initializeSchema() {
    // 1. Documents Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE,
        title TEXT,
        content TEXT,
        excerpt TEXT,
        mtime INTEGER,
        metadata TEXT,
        status TEXT DEFAULT 'active',
        is_private INTEGER DEFAULT 0,
        intelligence_status TEXT DEFAULT 'pending'
      );
    `);

    // 2. FTS5 Virtual Table for Keyword Search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_documents USING fts5(
        title, 
        content,
        content='documents',
        content_rowid='id'
      );
    `);

    // 3. Triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO fts_documents(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        INSERT INTO fts_documents(fts_documents, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        INSERT INTO fts_documents(fts_documents, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
        INSERT INTO fts_documents(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;
    `);

    // 4. Vector Table (sqlite-vec)
    // We use a fixed 384 dimensions for the local model 'all-MiniLM-L6-v2'
    // But Gemini uses 768. To remain hybrid, we support multiple vector tables or variable columns.
    // For simplicity, we'll use 'vec_documents' with 768 dimensions (Gemini compat)
    // and pad local vectors if needed, or better: just detect which one we have.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vec_documents (
        id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        embedding BLOB, -- Float32Array
        provider TEXT -- 'local' or 'gemini'
      );
    `);
    
    // 5. Edges Table (Persistent Graph)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT,
        target TEXT,
        type TEXT,
        weight REAL,
        UNIQUE(source, target, type)
      );
    `);

    // 6. Graph Metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // 7. Symbols Table (Source Code)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        path TEXT,
        line INTEGER,
        type TEXT,
        signature TEXT,
        hash TEXT,
        UNIQUE(name, path)
      );
    `);

    // 8. Intelligence Queue
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intelligence_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
        priority INTEGER DEFAULT 1,
        created_at INTEGER
      );
    `);

    // 9. Locks Table (Nexus Concurrency)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS locks (
        path TEXT PRIMARY KEY,
        agent_id TEXT,
        expires_at INTEGER,
        created_at INTEGER
      );
    `);

    // 10. Access Log (Pulse Weighting)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT,
        action TEXT, -- 'read', 'write', 'focus'
        timestamp INTEGER
      );
    `);

    // 11. Workspace Config (v2.0 — dynamic settings)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_config (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // 12. Missions (v2.0 — structured objectives)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        priority INTEGER DEFAULT 1,
        created_at INTEGER,
        due_at INTEGER,
        metadata TEXT
      );
    `);

    this.migrateSchema();
  }

  private migrateSchema() {
    const docCols = new Set((this.db.pragma('table_info(documents)') as any[]).map((c: any) => c.name));
    if (!docCols.has('status')) this.db.exec(`ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'active'`);
    if (!docCols.has('is_private')) this.db.exec(`ALTER TABLE documents ADD COLUMN is_private INTEGER DEFAULT 0`);
    if (!docCols.has('intelligence_status')) this.db.exec(`ALTER TABLE documents ADD COLUMN intelligence_status TEXT DEFAULT 'pending'`);

    const symCols = new Set((this.db.pragma('table_info(symbols)') as any[]).map((c: any) => c.name));
    if (!symCols.has('hash')) this.db.exec(`ALTER TABLE symbols ADD COLUMN hash TEXT DEFAULT ''`);

    // v1.13: vector dimension tracking (bug B1)
    const vecCols = new Set((this.db.pragma('table_info(vec_documents)') as any[]).map((c: any) => c.name));
    if (!vecCols.has('dimension')) this.db.exec(`ALTER TABLE vec_documents ADD COLUMN dimension INTEGER NOT NULL DEFAULT 0`);

    // v1.13: intelligence queue retry / dead-letter (bug B5)
    const qCols = new Set((this.db.pragma('table_info(intelligence_queue)') as any[]).map((c: any) => c.name));
    if (!qCols.has('retry_count')) this.db.exec(`ALTER TABLE intelligence_queue ADD COLUMN retry_count INTEGER DEFAULT 0`);
    if (!qCols.has('last_error')) this.db.exec(`ALTER TABLE intelligence_queue ADD COLUMN last_error TEXT`);
  }

  public getGraphVersion(): number {
    const row = this.db.prepare(`SELECT value FROM graph_metadata WHERE key = 'graph_version'`).get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  private bumpGraphVersion() {
    this.db.prepare(`
      INSERT INTO graph_metadata (key, value) VALUES ('graph_version', '1')
      ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    `).run();
  }

  public upsertEdge(source: string, target: string, type: string, weight: number) {
    const stmt = this.db.prepare(`
      INSERT INTO edges (source, target, type, weight)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source, target, type) DO UPDATE SET weight = excluded.weight
    `);
    const result = stmt.run(source, target, type, weight);
    this.bumpGraphVersion();
    return result;
  }

  public removeEdgesForSource(source: string) {
    const stmt = this.db.prepare('DELETE FROM edges WHERE source = ?');
    return stmt.run(source);
  }

  public removeEdgesForSourceByType(source: string, type: string) {
    const stmt = this.db.prepare('DELETE FROM edges WHERE source = ? AND type = ?');
    return stmt.run(source, type);
  }

  public removeEdge(source: string, target: string, type: string) {
    const stmt = this.db.prepare('DELETE FROM edges WHERE source = ? AND target = ? AND type = ?');
    return stmt.run(source, target, type);
  }

  public getAllEdges() {
    return this.db.prepare('SELECT * FROM edges').all() as any[];
  }

  /**
   * Fetches graph affinity scores for nodes connected to the given path.
   * Uses a recursive CTE for configurable multi-hop BFS with exponential decay.
   * Single DB round-trip; cycles are pruned by the minWeight termination condition.
   */
  public getAffinities(nodePath: string, maxHops = 3, minWeight = 0.05): Map<string, number> {
    const rows = this.db.prepare(`
      WITH RECURSIVE traversal(id, weight, depth) AS (
        SELECT target, weight, 1 FROM edges WHERE source = ?
        UNION ALL
        SELECT source, weight, 1 FROM edges WHERE target = ?
        UNION ALL
        SELECT e.target, t.weight * 0.4, t.depth + 1
        FROM edges e
        JOIN traversal t ON e.source = t.id
        WHERE t.depth < ? AND t.weight * 0.4 > ?
      )
      SELECT id, MAX(weight) AS affinity FROM traversal WHERE id != ? GROUP BY id
    `).all(nodePath, nodePath, maxHops, minWeight, nodePath) as Array<{ id: string; affinity: number }>;

    const affinities = new Map<string, number>();
    for (const row of rows) {
      affinities.set(row.id, row.affinity);
    }
    return affinities;
  }

  public upsertDocument(record: DBRecord & { status?: string, intelligence_status?: string, is_private?: number }) {
    const stmt = this.db.prepare(`
      INSERT INTO documents (path, title, content, excerpt, mtime, metadata, status, is_private, intelligence_status)
      VALUES (@path, @title, @content, @excerpt, @mtime, @metadata, @status, @is_private, @intelligence_status)
      ON CONFLICT(path) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        excerpt = excluded.excerpt,
        mtime = excluded.mtime,
        metadata = excluded.metadata,
        status = excluded.status,
        is_private = excluded.is_private,
        intelligence_status = excluded.intelligence_status
      RETURNING id
    `);
    
    const row = stmt.get({
      status: 'active',
      is_private: 0,
      intelligence_status: 'pending',
      ...record
    }) as { id: number };
    this.bumpGraphVersion();
    return row;
  }

  public updateDocumentStatus(path: string, status: string) {
    const stmt = this.db.prepare('UPDATE documents SET intelligence_status = ? WHERE path = ?');
    return stmt.run(status, path);
  }

  public upsertVector(docId: number, embedding: Float32Array, provider: string) {
    const stmt = this.db.prepare(`
      INSERT INTO vec_documents (id, embedding, provider, dimension)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        embedding = excluded.embedding,
        provider = excluded.provider,
        dimension = excluded.dimension
    `);

    // sqlite-vec expects raw buffer
    this.db.prepare('UPDATE documents SET intelligence_status = "ready" WHERE id = ?').run(docId);
    return stmt.run(docId, Buffer.from(embedding.buffer), provider, embedding.length);
  }

  // --- Queue Methods ---

  public addToQueue(docId: number, priority: number = 1) {
    const stmt = this.db.prepare(`
      INSERT INTO intelligence_queue (doc_id, priority, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET priority = excluded.priority
    `);
    return stmt.run(docId, priority, Date.now());
  }

  public getNextFromQueue(): { id: number, doc_id: number } | undefined {
    return this.db.prepare(`
      SELECT id, doc_id FROM intelligence_queue
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get() as any;
  }

  public getBatchFromQueue(n: number): Array<{ id: number; doc_id: number }> {
    return this.db.prepare(`
      SELECT id, doc_id FROM intelligence_queue
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `).all(n) as any[];
  }

  public removeFromQueue(id: number) {
    return this.db.prepare('DELETE FROM intelligence_queue WHERE id = ?').run(id);
  }

  public incrementQueueRetry(id: number, errorMsg: string) {
    return this.db.prepare(`
      UPDATE intelligence_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?
    `).run(errorMsg, id);
  }

  public getQueueItemRetryCount(id: number): number {
    const row = this.db.prepare('SELECT retry_count FROM intelligence_queue WHERE id = ?').get(id) as any;
    return row?.retry_count ?? 0;
  }

  public setIntelligenceStatus(docId: number, status: 'pending' | 'processing' | 'ready' | 'failed') {
    return this.db.prepare('UPDATE documents SET intelligence_status = ? WHERE id = ?').run(status, docId);
  }

  public searchHybrid(queryEmbedding: Float32Array, queryText: string, limit: number = 10, includePrivate: boolean = false, offset: number = 0) {
    const privateFilter = includePrivate ? "" : "AND d.is_private = 0";

    // 1. Semantic Search — skip if no valid query embedding
    let semanticResults: any[] = [];
    if (queryEmbedding.length > 0) {
      try {
        // Only compare vectors with matching dimensions to prevent garbage cosine scores (bug B1)
        const semanticStmt = this.db.prepare(`
          SELECT
            d.id, d.path, d.title, d.excerpt, d.metadata, d.is_private,
            vec_distance_cosine(v.embedding, ?) as distance
          FROM vec_documents v
          JOIN documents d ON v.id = d.id
          WHERE d.status = 'active' AND v.dimension = ? ${privateFilter}
          ORDER BY distance ASC
          LIMIT ?
        `);

        semanticResults = semanticStmt.all(Buffer.from(queryEmbedding.buffer), queryEmbedding.length, limit * 2) as any[];
      } catch {
        semanticResults = [];
      }
    }

    // 2. Keyword Search (FTS5) — quote input to prevent operator injection
    let keywordResults: any[] = [];
    const sanitizedFts = queryText.replace(/"/g, '""').trim();
    if (sanitizedFts) {
      try {
        const keywordStmt = this.db.prepare(`
          SELECT
            d.id, d.path, d.title, d.excerpt, d.metadata, d.is_private,
            rank as fts_score
          FROM fts_documents f
          JOIN documents d ON f.rowid = d.id
          WHERE fts_documents MATCH ? AND d.status = 'active' ${privateFilter}
          ORDER BY rank
          LIMIT ?
        `);

        keywordResults = keywordStmt.all(`"${sanitizedFts}"`, limit * 2) as any[];
      } catch {
        keywordResults = [];
      }
    }

    // 3. Aether 2.0: Distance-Weighted Fusion
    const seen = new Map<string, any>();
    
    semanticResults.forEach((r, i) => {
      seen.set(r.path, {
        ...r,
        score: (1 - r.distance) * 0.7 + (1 / (i + 1)) * 0.3 // weighted semantic
      });
    });

    keywordResults.forEach((r, i) => {
      const existing = seen.get(r.path);
      const kScore = (1 / (i + 1)) * 0.5; // fts relative position weighting
      if (existing) {
        existing.score += kScore;
      } else {
        seen.set(r.path, {
          ...r,
          score: kScore
        });
      }
    });

    const combined = Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit);

    return { semanticResults, keywordResults, combined };
  }

  public getDocumentById(id: number) {
    return this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DBRecord | undefined;
  }

  public getDocumentByPath(filePath: string) {
    return this.db.prepare('SELECT * FROM documents WHERE path = ?').get(filePath) as DBRecord | undefined;
  }

  public removeDocument(filePath: string) {
    const stmt = this.db.prepare('DELETE FROM documents WHERE path = ?');
    return stmt.run(filePath);
  }

  public getAllDocuments() {
    return this.db.prepare('SELECT * FROM documents').all() as DBRecord[];
  }

  public upsertSymbol(name: string, path: string, line: number, type: string, signature: string, hash: string = '') {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (name, path, line, type, signature, hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name, path) DO UPDATE SET
        line = excluded.line,
        type = excluded.type,
        signature = excluded.signature,
        hash = excluded.hash
    `);
    const result = stmt.run(name, path, line, type, signature, hash);
    this.bumpGraphVersion();
    return result;
  }

  public removeSymbolsForPath(filePath: string) {
    return this.db.prepare('DELETE FROM symbols WHERE path = ?').run(filePath);
  }

  public getSymbolByName(name: string) {
    return this.db.prepare('SELECT * FROM symbols WHERE name = ?').get(name) as any | undefined;
  }

  public getAllSymbols() {
    return this.db.prepare('SELECT * FROM symbols').all() as any[];
  }

  public getVectorForDocument(docId: number) {
    const row = this.db.prepare('SELECT embedding FROM vec_documents WHERE id = ?').get(docId) as { embedding: Buffer } | undefined;
    return row ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4) : undefined;
  }

  public searchSemantic(queryEmbedding: Float32Array, limit: number = 10) {
    const stmt = this.db.prepare(`
      SELECT 
        d.id, d.path, d.title, d.excerpt,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      ORDER BY distance ASC
      LIMIT ?
    `);
    return stmt.all(Buffer.from(queryEmbedding.buffer), limit) as any[];
  }

  public getTopKNeighbors(docId: number, k: number = 3) {
    const embedding = this.getVectorForDocument(docId);
    if (!embedding) return [];

    const stmt = this.db.prepare(`
      SELECT 
        d.path, d.title,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE d.id != ?
      ORDER BY distance ASC
      LIMIT ?
    `);

    return stmt.all(Buffer.from(embedding.buffer), docId, k) as any[];
  }

  // --- Lock Methods ---

  public acquireLock(path: string, agentId: string, durationMs: number = 300000) {
    const expiresAt = Date.now() + durationMs;
    const stmt = this.db.prepare(`
      INSERT INTO locks (path, agent_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        agent_id = CASE 
          WHEN expires_at < ? THEN excluded.agent_id 
          WHEN agent_id = excluded.agent_id THEN excluded.agent_id
          ELSE agent_id 
        END,
        expires_at = CASE 
          WHEN expires_at < ? THEN excluded.expires_at 
          WHEN agent_id = excluded.agent_id THEN excluded.expires_at
          ELSE expires_at 
        END
    `);
    const now = Date.now();
    return stmt.run(path, agentId, expiresAt, now, now, now);
  }

  public releaseLock(path: string, agentId: string) {
    const stmt = this.db.prepare('DELETE FROM locks WHERE path = ? AND agent_id = ?');
    return stmt.run(path, agentId);
  }

  public getLock(path: string) {
    const row = this.db.prepare('SELECT * FROM locks WHERE path = ?').get(path) as any;
    if (row && row.expires_at < Date.now()) {
      this.db.prepare('DELETE FROM locks WHERE path = ?').run(path);
      return undefined;
    }
    return row;
  }

  // --- Access Log Methods ---

  public logAccess(path: string, action: 'read' | 'write' | 'focus') {
    const stmt = this.db.prepare('INSERT INTO access_log (path, action, timestamp) VALUES (?, ?, ?)');
    return stmt.run(path, action, Date.now());
  }

  public getPathHeat(path: string, windowMs: number = 3600000) {
    const since = Date.now() - windowMs;
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM access_log WHERE path = ? AND timestamp > ?');
    return (stmt.get(path, since) as any).count;
  }

  public pruneAccessLog(maxAgeMs: number = 86400000) {
    const cutoff = Date.now() - maxAgeMs;
    return this.db.prepare('DELETE FROM access_log WHERE timestamp < ?').run(cutoff);
  }

  // --- Mission Methods ---

  public createMission(title: string, path: string, priority = 1, dueAt?: number, metadata?: string): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO missions (title, path, status, priority, created_at, due_at, metadata)
      VALUES (?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET title = excluded.title, status = excluded.status, priority = excluded.priority
      RETURNING id
    `);
    this.bumpGraphVersion();
    return stmt.get(title, path, priority, Date.now(), dueAt ?? null, metadata ?? null) as { id: number };
  }

  public listMissions(status?: string): any[] {
    if (status) {
      return this.db.prepare('SELECT * FROM missions WHERE status = ? ORDER BY priority DESC, created_at DESC').all(status) as any[];
    }
    return this.db.prepare('SELECT * FROM missions ORDER BY priority DESC, created_at DESC').all() as any[];
  }

  public updateMissionStatus(path: string, status: string): void {
    this.db.prepare('UPDATE missions SET status = ? WHERE path = ?').run(status, path);
    this.bumpGraphVersion();
  }

  public getAllMissions(): any[] {
    return this.db.prepare('SELECT * FROM missions').all() as any[];
  }

  // --- Workspace Config Methods ---

  public getConfig(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM workspace_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  public setConfig(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO workspace_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  public close() {
    this.db.close();
  }
}

import { getWorkspaceRoot } from '../context.js';

let _sharedInstance: DatabaseService | null = null;

export function getSharedDatabase(): DatabaseService {
  if (!_sharedInstance) {
    _sharedInstance = new DatabaseService(getWorkspaceRoot());
  }
  return _sharedInstance;
}

export const databaseService = getSharedDatabase();
