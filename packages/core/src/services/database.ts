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
        metadata TEXT
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
  }

  public upsertDocument(record: DBRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO documents (path, title, content, excerpt, mtime, metadata)
      VALUES (@path, @title, @content, @excerpt, @mtime, @metadata)
      ON CONFLICT(path) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        excerpt = excluded.excerpt,
        mtime = excluded.mtime,
        metadata = excluded.metadata
      RETURNING id
    `);
    
    return stmt.get(record) as { id: number };
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
    return stmt.run(docId, Buffer.from(embedding.buffer), provider);
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

  public close() {
    this.db.close();
  }
}
