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

  public upsertDocument(record: DBRecord & { status?: string, intelligence_status?: string }) {
    const stmt = this.db.prepare(`
      INSERT INTO documents (path, title, content, excerpt, mtime, metadata, status, intelligence_status)
      VALUES (@path, @title, @content, @excerpt, @mtime, @metadata, @status, @intelligence_status)
      ON CONFLICT(path) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        excerpt = excluded.excerpt,
        mtime = excluded.mtime,
        metadata = excluded.metadata,
        status = excluded.status,
        intelligence_status = excluded.intelligence_status
      RETURNING id
    `);
    
    return stmt.get({
      status: 'active',
      intelligence_status: 'pending',
      ...record
    }) as { id: number };
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

  public searchHybrid(queryEmbedding: Float32Array, queryText: string, limit: number = 10) {
    // This is a simplified hybrid search. 
    // It finds top semantic matches and top keyword matches.
    
    // 1. Semantic Search
    const semanticStmt = this.db.prepare(`
      SELECT 
        d.path, d.title, d.excerpt,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      ORDER BY distance ASC
      LIMIT ?
    `);
    
    const semanticResults = semanticStmt.all(Buffer.from(queryEmbedding.buffer), limit);

    // 2. Keyword Search (FTS5)
    const keywordStmt = this.db.prepare(`
      SELECT 
        d.path, d.title, d.excerpt,
        rank as fts_score
      FROM fts_documents f
      JOIN documents d ON f.rowid = d.id
      WHERE fts_documents MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    
    const keywordResults = keywordStmt.all(queryText, limit);

    return { semanticResults, keywordResults };
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

  public upsertSymbol(name: string, path: string, line: number, type: string, signature: string) {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (name, path, line, type, signature)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name, path) DO UPDATE SET
        line = excluded.line,
        type = excluded.type,
        signature = excluded.signature
    `);
    return stmt.run(name, path, line, type, signature);
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

  public close() {
    this.db.close();
  }
}
