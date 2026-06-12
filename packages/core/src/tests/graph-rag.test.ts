import assert from 'node:assert';
import { GraphRAGService } from '../services/graph-rag.js';
import { createTestDb, cleanupTestDb, type TestDB } from './helpers.js';

// Pins the async contract of GraphRAGService. storeCommunity/updateSummary/
// searchCommunities/globalSearch were converted sync->async in WS-B; this suite
// exists because the absence of any GraphRAG test let an un-awaited globalSearch()
// caller (predictive.ts) ship a silent `{}` regression. Runs the lexical fallback
// path (no embedding backend injected), which is deterministic.
describe('GraphRAGService (async contract + lexical fallback)', function () {
  this.timeout(10000);

  let testDb: TestDB;
  let rag: GraphRAGService;

  beforeEach(() => {
    testDb = createTestDb('graph-rag');
    rag = new GraphRAGService(testDb.db); // no embedding => lexical token-overlap ranking
  });

  afterEach(() => cleanupTestDb(testDb));

  it('storeCommunity resolves to a persisted community with a real id', async () => {
    const community = await rag.storeCommunity({
      level: 1,
      nodeIds: ['projects/a.md', 'projects/b.md'],
      summary: 'authentication and session management for the API',
    });
    assert.ok(Number.isInteger(community.id) && community.id > 0, 'id should be a real rowid');
    assert.strictEqual(community.level, 1);
    assert.deepStrictEqual(community.nodeIds, ['projects/a.md', 'projects/b.md']);
  });

  it('getCommunities returns stored communities filtered by level', async () => {
    await rag.storeCommunity({ level: 1, nodeIds: ['x'], summary: 'alpha topic' });
    await rag.storeCommunity({ level: 2, nodeIds: ['y'], summary: 'beta topic' });
    assert.strictEqual(rag.getCommunities(1).length, 1, 'one level-1 community');
    assert.strictEqual(rag.getCommunities(2).length, 1, 'one level-2 community');
  });

  it('searchCommunities resolves to ranked results by lexical overlap', async () => {
    await rag.storeCommunity({ level: 1, nodeIds: ['a'], summary: 'database migration and schema design' });
    await rag.storeCommunity({ level: 1, nodeIds: ['b'], summary: 'frontend dashboard rendering' });

    const results = await rag.searchCommunities('database schema', 5);
    assert.ok(Array.isArray(results), 'returns an array (not a Promise/undefined)');
    assert.ok(results.length >= 1, 'the database community should match');
    // The database-topic summary must out-rank the frontend one for this query.
    assert.match(results[0].community.summary, /database/, 'top hit is the database community');
  });

  it('globalSearch RESOLVES to a structured result (regression: must be awaited, never {})', async () => {
    await rag.storeCommunity({ level: 1, nodeIds: ['a'], summary: 'autonomy and agent orchestration' });

    const result = await rag.globalSearch('autonomy');
    // The bug: an un-awaited globalSearch() serializes as `{}` via JSON.stringify(Promise).
    // Assert the resolved value has the real GraphRAGResult shape.
    assert.ok('globalAnswer' in result, 'result has globalAnswer');
    assert.ok(Array.isArray(result.communities), 'result has communities[]');
    assert.ok(Array.isArray(result.localDetails), 'result has localDetails[]');
    assert.match(result.globalAnswer, /autonomy/, 'global answer summarizes the matched community');
    // Round-trips through JSON as a populated object, not an empty one.
    assert.notStrictEqual(JSON.stringify(result), '{}', 'serialized result must not be empty');
  });

  it('globalSearch resolves to empty (not error) when no communities exist', async () => {
    const result = await rag.globalSearch('anything');
    assert.strictEqual(result.globalAnswer, '');
    assert.deepStrictEqual(result.communities, []);
    assert.deepStrictEqual(result.localDetails, []);
  });

  it('updateSummary resolves and changes what searchCommunities matches', async () => {
    const c = await rag.storeCommunity({ level: 1, nodeIds: ['a'], summary: 'original placeholder text' });
    await rag.updateSummary(c.id, 'kubernetes deployment and scaling');

    const results = await rag.searchCommunities('kubernetes scaling', 5);
    assert.ok(results.length >= 1, 'updated summary is now matchable');
    assert.match(results[0].community.summary, /kubernetes/, 'matches the updated text');
  });
});
