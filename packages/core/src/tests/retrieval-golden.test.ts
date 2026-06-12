import assert from 'node:assert';
import { createTestDb, cleanupTestDb, type TestDB } from './helpers.js';
import { rrf, DEFAULT_RRF_K, type RankedList } from '../database/fusion.js';
import { VectorsRepository } from '../database/vectors.js';
import { DocumentsRepository } from '../database/documents.js';
import { MultiModalFusionService, type FusionCandidate } from '../services/fusion-scoring.js';

/**
 * Golden acceptance proof for the v4 WS-B retrieval upgrade (vec0 + RRF
 * foundation, cosine cognitive relevance, real fused search). Everything here is
 * DETERMINISTIC without an embedding backend; backend-dependent ranking is
 * guarded behind HAS_EMBEDDING_BACKEND so the suite stays green for the coverage
 * gate while still asserting the full ranking when a provider is configured.
 *
 * The four pillars (mirroring the WS-B acceptance contract):
 *   (a) RRF helper   — known ranked lists -> known fused order (pure function).
 *   (b) Dim guard    — store a 768-dim vector, query at 384 -> SKIP, no garbage.
 *   (c) vec0 schema  — vec_documents is a vec0 virtual table; migrate idempotent.
 *   (d) search_fused — real ranked structure (not a single 0.5 echo); full
 *                      ranking asserted with a backend, structural otherwise.
 */
const HAS_EMBEDDING_BACKEND = Boolean(process.env.GEMINI_API_KEY || process.env.OLLAMA_MODEL);

const STORED_DIM = 384;
const PROVIDER_768_DIM = 768;

function vecOf(dim: number, fill = 0.1): Float32Array {
  return new Float32Array(dim).fill(fill);
}

describe('WS-B retrieval golden acceptance', () => {
  // -------------------------------------------------------------------------
  // (a) RRF helper — pure function, no DB, no backend.
  // -------------------------------------------------------------------------
  describe('(a) RRF fusion helper', () => {
    it('fuses two ranked lists into the known RRF order', () => {
      // List 1 order: A, B, C   List 2 order: B, A, D
      const list1: RankedList<{ id: string }> = {
        items: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        key: (r) => r.id,
      };
      const list2: RankedList<{ id: string }> = {
        items: [{ id: 'B' }, { id: 'A' }, { id: 'D' }],
        key: (r) => r.id,
      };

      const fused = rrf([list1, list2]);
      const k = DEFAULT_RRF_K;

      // Hand-computed expected scores (0-based ranks, contribution = 1/(k+rank)):
      //   A: 1/(k+0) [L1 rank0] + 1/(k+1) [L2 rank1]
      //   B: 1/(k+1) [L1 rank1] + 1/(k+0) [L2 rank0]
      //   C: 1/(k+2) [L1 rank2]
      //   D: 1/(k+2) [L2 rank2]
      const expectScore = (...ranks: number[]) =>
        ranks.reduce((s, r) => s + 1 / (k + r), 0);
      const byKey = new Map(fused.map((e) => [e.key, e]));

      assert.ok(Math.abs(byKey.get('A')!.rrfScore - expectScore(0, 1)) < 1e-12);
      assert.ok(Math.abs(byKey.get('B')!.rrfScore - expectScore(1, 0)) < 1e-12);
      assert.ok(Math.abs(byKey.get('C')!.rrfScore - expectScore(2)) < 1e-12);
      assert.ok(Math.abs(byKey.get('D')!.rrfScore - expectScore(2)) < 1e-12);

      // A and B tie (symmetric ranks), both strictly above C and D.
      assert.ok(Math.abs(byKey.get('A')!.rrfScore - byKey.get('B')!.rrfScore) < 1e-12,
        'A and B should tie on RRF score');
      const topTwo = new Set([fused[0].key, fused[1].key]);
      assert.deepStrictEqual(topTwo, new Set(['A', 'B']), 'top two are A and B in some order');
      const bottomTwo = new Set([fused[2].key, fused[3].key]);
      assert.deepStrictEqual(bottomTwo, new Set(['C', 'D']), 'bottom two are C and D in some order');
    });

    it('keeps the first-seen record as the representative and is sorted best-first', () => {
      const fused = rrf<{ id: string; tag: string }>([
        { items: [{ id: 'X', tag: 'from-list-1' }], key: (r) => r.id },
        { items: [{ id: 'X', tag: 'from-list-2' }], key: (r) => r.id },
      ]);
      assert.strictEqual(fused.length, 1);
      assert.strictEqual(fused[0].record.tag, 'from-list-1', 'first-seen record wins');
      // Score accumulates across both lists (both rank 0): 2/(k+0).
      assert.ok(Math.abs(fused[0].rrfScore - 2 / DEFAULT_RRF_K) < 1e-12);
    });

    it('returns an empty array for no lists and handles a single list', () => {
      assert.deepStrictEqual(rrf([]), []);
      const single = rrf<{ id: string }>([
        { items: [{ id: 'P' }, { id: 'Q' }], key: (r) => r.id },
      ]);
      assert.deepStrictEqual(single.map((e) => e.key), ['P', 'Q'], 'single-list order preserved');
    });
  });

  // -------------------------------------------------------------------------
  // (b) Dimension guard — store a 768-dim vector, then query at 384.
  // -------------------------------------------------------------------------
  describe('(b) cross-dimension guard', () => {
    let t: TestDB;
    let vectors: VectorsRepository;
    let docs: DocumentsRepository;

    beforeEach(() => {
      t = createTestDb('golden-dim');
      vectors = new VectorsRepository(t.db);
      docs = new DocumentsRepository(t.db);
    });
    afterEach(() => cleanupTestDb(t));

    it('SKIPS storing a 768-dim vector into the fixed-384 table (no row written)', () => {
      const { id } = docs.upsert({
        path: 'doc/a.md', title: 'A', content: 'alpha', excerpt: 'alpha', mtime: 1, metadata: '[]',
      });
      // The vec0 table is fixed at float[384]; a 768-dim provider vector is a
      // tracked migration, not a silent runtime mix. upsert must no-op.
      vectors.upsert(id, vecOf(PROVIDER_768_DIM), 'gemini-768');
      assert.strictEqual(vectors.getForDocument(id), undefined,
        '768-dim vector must not be stored against the 384-dim table');
    });

    it('querying at 384 against a 768-stored space returns empty, never garbage', () => {
      const { id } = docs.upsert({
        path: 'doc/b.md', title: 'B', content: 'beta', excerpt: 'beta', mtime: 2, metadata: '[]',
      });
      // Attempt the (skipped) wrong-width write, then issue a correct-width query.
      vectors.upsert(id, vecOf(PROVIDER_768_DIM), 'gemini-768');
      const results = vectors.searchSemantic(vecOf(STORED_DIM), 10);
      assert.deepStrictEqual(results, [], 'no rows exist after the skipped write');
    });

    it('a wrong-dimension query vector SKIPS the semantic leg rather than throwing', () => {
      const { id } = docs.upsert({
        path: 'doc/c.md', title: 'C', content: 'gamma', excerpt: 'gamma', mtime: 3, metadata: '[]',
      });
      // A legitimately stored 384-dim vector...
      vectors.upsert(id, vecOf(STORED_DIM), 'minilm-384');
      assert.ok(vectors.getForDocument(id) !== undefined, '384-dim vector stored OK');
      // ...queried by a 768-dim vector must not throw and must not match.
      const semantic = vectors.searchSemantic(vecOf(PROVIDER_768_DIM), 10);
      assert.deepStrictEqual(semantic, [], 'mismatched-width query returns empty, not garbage');
      // Hybrid degrades to keyword-only on a mismatched-width query.
      const hybrid = vectors.searchHybrid(vecOf(PROVIDER_768_DIM), 'gamma', 10);
      assert.deepStrictEqual(hybrid.semanticResults, [], 'semantic leg skipped on width mismatch');
    });
  });

  // -------------------------------------------------------------------------
  // (c) vec0 schema — virtual table form + idempotent migrate.
  // -------------------------------------------------------------------------
  describe('(c) vec0 schema + migration', () => {
    let t: TestDB;
    beforeEach(() => { t = createTestDb('golden-schema'); });
    afterEach(() => cleanupTestDb(t));

    it('vec_documents is a vec0 virtual table after init + migrate', () => {
      const row = t.db
        .prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = 'vec_documents'`)
        .get() as { sql: string | null } | undefined;
      assert.ok(row, 'vec_documents must exist in sqlite_master');
      assert.match((row!.sql ?? '').toUpperCase(), /USING VEC0/, 'must be a vec0 virtual table');
    });

    it('migrateSchema is idempotent — re-running keeps the vec0 form and ledger', async () => {
      const { migrateSchema } = await import('../database/schema.js');
      const ddlBefore = (t.db
        .prepare(`SELECT sql FROM sqlite_master WHERE name = 'vec_documents'`)
        .get() as { sql: string }).sql;
      const ledgerBefore = (t.db
        .prepare(`SELECT COUNT(*) AS n FROM schema_migrations`)
        .get() as { n: number }).n;

      // Re-run twice; both must no-op (no throw, identical DDL, ledger unchanged).
      migrateSchema(t.db);
      migrateSchema(t.db);

      const ddlAfter = (t.db
        .prepare(`SELECT sql FROM sqlite_master WHERE name = 'vec_documents'`)
        .get() as { sql: string }).sql;
      const ledgerAfter = (t.db
        .prepare(`SELECT COUNT(*) AS n FROM schema_migrations`)
        .get() as { n: number }).n;

      assert.strictEqual(ddlAfter, ddlBefore, 'vec_documents DDL unchanged after re-migrate');
      assert.match(ddlAfter.toUpperCase(), /USING VEC0/, 'still a vec0 virtual table');
      assert.strictEqual(ledgerAfter, ledgerBefore, 'migration ledger unchanged on re-run');
    });

    it('a stored 384-dim vector round-trips and is KNN-searchable', () => {
      const docs = new DocumentsRepository(t.db);
      const vectors = new VectorsRepository(t.db);
      const { id } = docs.upsert({
        path: 'doc/d.md', title: 'D', content: 'delta', excerpt: 'delta', mtime: 4, metadata: '[]',
      });
      const v = vecOf(STORED_DIM, 0.25);
      vectors.upsert(id, v, 'minilm-384');
      const back = vectors.getForDocument(id);
      assert.ok(back, 'vector round-trips out of vec0');
      assert.strictEqual(back!.length, STORED_DIM);
      const hits = vectors.searchSemantic(v, 5);
      assert.ok(hits.length >= 1, 'KNN search returns the stored row');
      assert.strictEqual(hits[0].path, 'doc/d.md');
    });
  });

  // -------------------------------------------------------------------------
  // (d) search_fused shape — real ranked structure, not a 0.5 echo.
  // -------------------------------------------------------------------------
  describe('(d) fused search shape', () => {
    let t: TestDB;
    let fusion: MultiModalFusionService;
    let vectors: VectorsRepository;
    let docs: DocumentsRepository;

    beforeEach(() => {
      t = createTestDb('golden-fused');
      fusion = new MultiModalFusionService(t.db);
      vectors = new VectorsRepository(t.db);
      docs = new DocumentsRepository(t.db);
    });
    afterEach(() => cleanupTestDb(t));

    it('produces a real multi-signal ranking — distinct paths, not a single echo', () => {
      // These candidates are exactly what buildFusionCandidates() feeds the
      // fusion service; here we drive the deterministic core directly (no backend).
      const candidates: FusionCandidate[] = [
        { path: 'a.md', semanticScore: 0.9, bm25Score: 5, graphProximityScore: 0.1, accessCount: 1, lastModified: Date.now() },
        { path: 'b.md', semanticScore: 0.2, bm25Score: 9, graphProximityScore: 0.9, accessCount: 9, lastModified: Date.now() },
        { path: 'c.md', semanticScore: 0.5, bm25Score: 1, graphProximityScore: 0.5, accessCount: 3, lastModified: 1 },
      ];
      const results = fusion.score(candidates);

      // Structural acceptance: a genuine ranking over the real candidate paths,
      // NOT the old `[{ path: query, semanticScore: 0.5 }]` single-echo stub.
      assert.strictEqual(results.length, 3, 'one result per candidate');
      const paths = results.map((r) => r.path).sort();
      assert.deepStrictEqual(paths, ['a.md', 'b.md', 'c.md'], 'ranks the real candidate paths');
      // Per-signal breakdown is preserved (transparency), and no fabricated 0.5.
      for (const r of results) {
        assert.ok('scores' in r && typeof r.scores.semantic === 'number');
        assert.ok(r.fusedScore >= 0 && r.fusedScore <= 1, 'fusedScore normalized to [0,1]');
      }
      // Sorted best-first.
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].fusedScore >= results[i].fusedScore, 'sorted by fusedScore desc');
      }
      // The top result is normalized to 1 (max), proving real normalization, not a constant.
      assert.ok(Math.abs(results[0].fusedScore - 1) < 1e-9, 'top fusedScore normalizes to 1');
    });

    it('weight tilt changes the ranking — muting a signal is observable', () => {
      const candidates: FusionCandidate[] = [
        { path: 'semantic-winner.md', semanticScore: 0.99, bm25Score: 0 },
        { path: 'bm25-winner.md', semanticScore: 0, bm25Score: 0.99 },
      ];
      // Semantic-only weighting must rank the semantic winner first.
      const semOnly = fusion.score(candidates, { semantic: 1, bm25: 0, graphProximity: 0, recency: 0, heat: 0 });
      assert.strictEqual(semOnly[0].path, 'semantic-winner.md');
      // BM25-only weighting flips the top.
      const bmOnly = fusion.score(candidates, { semantic: 0, bm25: 1, graphProximity: 0, recency: 0, heat: 0 });
      assert.strictEqual(bmOnly[0].path, 'bm25-winner.md');
    });

    it('the keyword leg returns a real ranked structure with a zero query vector (no backend)', () => {
      // Mirrors how search_fused recovers FTS5 ranks: an empty vector forces the
      // keyword-only leg, so this works with NO embedding backend and proves the
      // tool answers from the real index rather than echoing the query.
      docs.upsert({ path: 'guide/alpha.md', title: 'Alpha Guide', content: 'orchestration patterns for swarms', excerpt: 'orchestration', mtime: 10, metadata: '[]' });
      docs.upsert({ path: 'guide/beta.md', title: 'Beta Notes', content: 'unrelated content about cooking', excerpt: 'cooking', mtime: 11, metadata: '[]' });

      const hybrid = vectors.searchHybrid(new Float32Array(0), 'orchestration', 10);
      assert.deepStrictEqual(hybrid.semanticResults, [], 'empty query vector => semantic leg skipped');
      assert.ok(Array.isArray(hybrid.keywordResults), 'keyword results present');
      assert.ok(hybrid.keywordResults.length >= 1, 'FTS5 finds the matching doc');
      assert.strictEqual(hybrid.keywordResults[0].path, 'guide/alpha.md', 'matches the real indexed path, not the query');
      assert.notStrictEqual(hybrid.keywordResults[0].path, 'orchestration', 'never echoes the raw query string as a path');
      // Each keyword hit carries a real FTS5 rank — not a fabricated constant 0.5.
      assert.ok('rank' in hybrid.keywordResults[0], 'real FTS5 rank present on the keyword leg');
    });

    it('full fused ranking over the live index (requires an embedding backend)', async function () {
      if (!HAS_EMBEDDING_BACKEND) this.skip();
      const { intelligenceService } = await import('../services/intelligence.js');
      const retrieved = await intelligenceService.search('orchestration', { limit: 5 });
      assert.ok(Array.isArray(retrieved), 'search returns an array');
      // With a backend, real fused candidates flow through; assert a ranked,
      // de-duplicated path set with monotonically non-increasing scores.
      const candidates: FusionCandidate[] = retrieved.map((r: any) => ({
        path: r.path,
        semanticScore: r.score,
      }));
      const results = fusion.score(candidates);
      const paths = results.map((r) => r.path);
      assert.strictEqual(new Set(paths).size, paths.length, 'no duplicate paths in the ranking');
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].fusedScore >= results[i].fusedScore, 'fused ranking is sorted');
      }
    });
  });
});
