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

import type { DBRecord, RawDB } from './types.js';

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

  constructor(workspaceRoot: string, dbPath?: string) {
    const finalPath = dbPath ?? path.join(workspaceRoot, '.context-db', 'context.db');
    this.db = createConnection(finalPath);
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

  // --- Graph (backward-compatible delegating methods) ---

  getGraphVersion() { return this.graph.getVersion(); }
  upsertEdge(source: string, target: string, type: string, weight: number) { this.graph.upsertEdge(source, target, type, weight); }
  removeEdgesForSource(source: string) { this.graph.removeEdgesForSource(source); }
  removeEdgesForSourceByType(source: string, type: string) { this.graph.removeEdgesForSourceByType(source, type); }
  removeEdge(source: string, target: string, type: string) { this.graph.removeEdge(source, target, type); }
  getAllEdges() { return this.graph.getAll(); }
  getAffinities(nodePath: string, maxHops?: number, minWeight?: number) { return this.graph.getAffinities(nodePath, maxHops, minWeight); }

  // --- Documents ---

  upsertDocument(record: Omit<DBRecord, 'id'>) { return this.documents.upsert(record); }
  updateDocumentStatus(p: string, status: string) { this.documents.updateStatus(p, status); }
  getDocumentById(id: number) { return this.documents.getById(id); }
  getDocumentByPath(filePath: string) { return this.documents.getByPath(filePath); }
  removeDocument(filePath: string) { this.documents.remove(filePath); }
  getAllDocuments() { return this.documents.getAll(); }

  // --- Vectors ---

  upsertVector(docId: number, embedding: Float32Array, provider: string) { this.vectors.upsert(docId, embedding, provider); }
  getVectorForDocument(docId: number) { return this.vectors.getForDocument(docId); }
  searchSemantic(queryEmbedding: Float32Array, limit?: number) { return this.vectors.searchSemantic(queryEmbedding, limit); }
  getTopKNeighbors(docId: number, k?: number) { return this.vectors.getTopKNeighbors(docId, k); }
  searchHybrid(queryEmbedding: Float32Array, queryText: string, limit?: number, includePrivate?: boolean, offset?: number) {
    return this.vectors.searchHybrid(queryEmbedding, queryText, limit, includePrivate, offset);
  }

  // --- Queue ---

  addToQueue(docId: number, priority?: number) { this.queue.add(docId, priority); }
  getNextFromQueue() { return this.queue.getNext(); }
  getBatchFromQueue(n: number) { return this.queue.getBatch(n); }
  removeFromQueue(id: number) { this.queue.remove(id); }
  incrementQueueRetry(id: number, errorMsg: string) { this.queue.incrementRetry(id, errorMsg); }
  getQueueItemRetryCount(id: number) { return this.queue.getRetryCount(id); }
  setIntelligenceStatus(docId: number, status: 'pending' | 'processing' | 'ready' | 'failed') { this.documents.setIntelligenceStatus(docId, status); }

  // --- Symbols ---

  upsertSymbol(name: string, p: string, line: number, type: string, sig: string, hash: string) { this.symbols.upsert(name, p, line, type, sig, hash); }
  removeSymbolsForPath(filePath: string) { this.symbols.removeForPath(filePath); }
  getSymbolByName(name: string) { return this.symbols.getByName(name); }
  getAllSymbols() { return this.symbols.getAll(); }

  // --- Locks ---

  acquireLock(p: string, agentId: string, durationMs?: number) { return this.locks.acquire(p, agentId, durationMs); }
  releaseLock(p: string, agentId: string) { this.locks.release(p, agentId); }
  getLock(p: string) { return this.locks.get(p); }

  // --- Access Log ---

  logAccess(p: string, action: 'read' | 'write' | 'focus') { this.access.log(p, action); }
  getPathHeat(p: string, windowMs?: number) { return this.access.getPathHeat(p, windowMs); }
  pruneAccessLog(maxAgeMs?: number) { this.access.prune(maxAgeMs); }
  getAccessLog(limit?: number, pathFilter?: string) { return this.access.getLog(limit, pathFilter); }

  // --- Missions ---

  createMission(title: string, p: string, priority?: number, dueAt?: number, metadata?: string) { return this.missions.create(title, p, priority, dueAt, metadata); }
  listMissions(status?: string) { return this.missions.list(status); }
  updateMissionStatus(p: string, status: string) { this.missions.updateStatus(p, status); }
  getAllMissions() { return this.missions.getAll(); }

  // --- Config ---

  getConfig(key: string) { return this.config.get(key); }
  setConfig(key: string, value: string) { this.config.set(key, value); }

  // --- Lifecycle ---

  getRawDb(): RawDB { return this.db; }

  close() {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.close();
    log.debug('Database connection closed');
  }
}

// --- Singleton (backward compat) ---

import { getWorkspaceRoot } from '../context.js';

let _sharedInstance: DatabaseService | null = null;

/**
 * Returns a lazily-initialized shared DatabaseService singleton.
 * Prefer `createContextOS()` factory for new code — this exists for backward compatibility.
 * @deprecated Use container.resolve(TOKENS.Database) from createContextOS() instead.
 */
export function getSharedDatabase(): DatabaseService {
  if (!_sharedInstance) {
    _sharedInstance = new DatabaseService(getWorkspaceRoot());
  }
  return _sharedInstance;
}
