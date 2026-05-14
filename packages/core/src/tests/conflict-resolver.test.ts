import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { ConflictResolver } from '../orchestration/conflict-resolver.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-conflicts');

describe('ConflictResolver', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let resolver: ConflictResolver;

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'conflicts.db'));
    initializeSchema(db);
    migrateSchema(db);
    resolver = new ConflictResolver(db);
  });

  after(() => {
    db.close();
    fs.removeSync(TEST_DIR);
  });

  it('allows multiple readers on same path', () => {
    assert.strictEqual(resolver.acquireRead('file.md', 'agent-a'), true);
    assert.strictEqual(resolver.acquireRead('file.md', 'agent-b'), true);
  });

  it('blocks writer when readers exist', () => {
    assert.strictEqual(resolver.acquireWrite('file.md', 'agent-c'), false);
  });

  it('allows writer when only self is reading', () => {
    resolver.release('file.md', 'agent-a');
    resolver.release('file.md', 'agent-b');
    assert.strictEqual(resolver.acquireWrite('file.md', 'agent-c'), true);
  });

  it('blocks second writer', () => {
    assert.strictEqual(resolver.acquireWrite('file.md', 'agent-d'), false);
  });

  it('blocks reader when writer holds lock', () => {
    assert.strictEqual(resolver.acquireRead('file.md', 'agent-e'), false);
  });

  it('upgrade succeeds when sole reader', () => {
    resolver.release('file.md', 'agent-c');
    resolver.acquireRead('other.md', 'agent-f');
    assert.strictEqual(resolver.upgradeToWrite('other.md', 'agent-f'), true);
    resolver.release('other.md', 'agent-f');
  });

  it('upgrade fails when other readers present', () => {
    resolver.acquireRead('shared.md', 'agent-g');
    resolver.acquireRead('shared.md', 'agent-h');
    assert.strictEqual(resolver.upgradeToWrite('shared.md', 'agent-g'), false);
    resolver.release('shared.md', 'agent-g');
    resolver.release('shared.md', 'agent-h');
  });
});
