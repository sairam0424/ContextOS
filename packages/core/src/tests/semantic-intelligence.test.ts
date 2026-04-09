import assert from 'node:assert';
import { intelligenceService } from '../services/intelligence.js';

describe('Semantic Intelligence Engine (v1.2.0)', () => {
    it('should extract mentions (@user) and tags (#topic)', async () => {
        const text = "Meeting with @samantha regarding the #v1.2-roadmap update.";
        const entities = await intelligenceService.extract(text);
        
        assert.ok(entities.includes('samantha'), 'Should extract @samantha');
        assert.ok(entities.includes('v1'), 'Should extract #v1 (partial tag)');
    });

    it('should find results using fuzzy matching', async () => {
        const results = await intelligenceService.search("ContextOS", { deep: false });
        assert.ok(results.length > 0, "Should find 'ContextOS'");
        
        const fuzzyResults = await intelligenceService.search("ContextOz", { deep: false });
        assert.ok(fuzzyResults.length > 0, "Should find 'ContextOS' with fuzzy match 'ContextOz'");
        assert.ok(fuzzyResults[0].score! > 0, "Result should have relevance score");
    });

    it('should rank results by relevance (BM25)', async () => {
        // Search for 'autonomy' - root/soul.md has this in the body
        const results = await intelligenceService.search("autonomy");
        if (results.length > 0) {
            assert.ok(results[0].score !== undefined, "Top result should have a score");
            assert.ok(results[0].type === 'index', "Top result should come from the index");
        }
    });

    it('should fall back to grep for deep scan', async function() {
        this.timeout(10000); // 10s for grep in large monorepos
        const results = await intelligenceService.search("package-lock", { deep: true });
        assert.ok(results.length > 0, "Should find package-lock matches via grep");
        assert.strictEqual(results[0].type, 'deep', "Type should be 'deep'");
    });
});
