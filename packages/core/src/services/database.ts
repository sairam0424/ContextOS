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
  }

  public upsertEdge(source: string, target: string, type: string, weight: number) {
    const stmt = this.db.prepare(`
      INSERT INTO edges (source, target, type, weight)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source, target, type) DO UPDATE SET weight = excluded.weight
    `);
    return stmt.run(source, target, type, weight);
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
   * Phase 4: Multi-degree connection weighting.
   */
  public getAffinities(nodePath: string): Map<string, number> {
    const affinities = new Map<string, number>();
    
    // 1st Degree: Direct Links (Weight: 1.0x)
    const direct = this.db.prepare(`
      SELECT target as id, weight FROM edges WHERE source = ?
      UNION ALL
      SELECT source as id, weight FROM edges WHERE target = ?
    `).all(nodePath, nodePath) as any[];

    for (const d of direct) {
      affinities.set(d.id, (affinities.get(d.id) || 0) + d.weight);
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
    
    return stmt.get({
      status: 'active',
      is_private: 0,
      intelligence_status: 'pending',
      ...record
    }) as { id: number };
  }

  public updateDocumentStatus(path: string, status: string) {
    const stmt = this.db.prepare('UPDATE documents SET intelligence_status = ? WHERE path = ?');
    return stmt.run(status, path);
  }

  public upsertVector(docId: number, embedding: Float32Array, provider: string) {
    const stmt = this.db.prepare(`
      INSERT INTO vec_documents (id, embedding, provider)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        embedding = excluded.embedding,
        provider = excluded.provider
    `);
    
    // sqlite-vec expects raw buffer
    this.db.prepare('UPDATE documents SET intelligence_status = "ready" WHERE id = ?').run(docId);
    return stmt.run(docId, Buffer.from(embedding.buffer), provider);
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

  public removeFromQueue(id: number) {
    return this.db.prepare('DELETE FROM intelligence_queue WHERE id = ?').run(id);
  }

  public setIntelligenceStatus(docId: number, status: 'pending' | 'processing' | 'ready') {
    return this.db.prepare('UPDATE documents SET intelligence_status = ? WHERE id = ?').run(status, docId);
  }

  public searchHybrid(queryEmbedding: Float32Array, queryText: string, limit: number = 10, includePrivate: boolean = false) {
    const privateFilter = includePrivate ? "" : "AND d.is_private = 0";
    
    // 1. Semantic Search
    const semanticStmt = this.db.prepare(`
      SELECT 
        d.id, d.path, d.title, d.excerpt, d.metadata, d.is_private,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE d.status = 'active' ${privateFilter}
      ORDER BY distance ASC
      LIMIT ?
    `);
    
    const semanticResults = semanticStmt.all(Buffer.from(queryEmbedding.buffer), limit * 2) as any[];

    // 2. Keyword Search (FTS5)
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
    
    const keywordResults = keywordStmt.all(queryText, limit * 2) as any[];

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
      .slice(0, limit);

    return { semanticResults, keywordResults, combined };
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
    return stmt.run(name, path, line, type, signature, hash);
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

  public close() {
    this.db.close();
  }
}

import { getWorkspaceRoot } from '../context.js';
export const databaseService = new DatabaseService(getWorkspaceRoot());
