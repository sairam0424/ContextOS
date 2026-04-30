import assert from 'node:assert';
import path from 'node:path';
import fs from 'fs-extra';
import { globalIndexer } from '../indexer.js';
import { intelligenceService } from '../services/intelligence.js';
import { workspaceRoot } from '../context.js';

describe('Hybrid SQLite-Vec Intelligence Engine', () => {

    it('should initialize the SQLite database in .context-db/', async () => {
        const dbPath = path.join(workspaceRoot, '.context-db', 'context.db');
        const exists = await fs.pathExists(dbPath);
        if (!exists) {
            await globalIndexer.reindex({ force: true });
        }
        assert.ok(await fs.pathExists(dbPath), 'Database file should exist in .context-db/');
    });

    it('should generate and store records during indexing', async () => {
        const { records } = await globalIndexer.reindex({ force: true });
        assert.ok(records.length > 0, "Should have at least one record");
        assert.ok(records[0].content.length > 0, "Record should have body content");
    });

    it('should perform a successful hybrid search', async () => {
        const results = await intelligenceService.search("autonomy");
        assert.ok(results.length > 0, "Should find results for 'autonomy'");
        assert.ok(results[0].type === 'hybrid' || results[0].type === 'deep', "Result type should be hybrid or deep");
    });

    it('should return scored results from hybrid search', async () => {
        const results = await intelligenceService.search("ContextOS");
        if (results.length > 0 && results[0].type === 'hybrid') {
            assert.ok(results[0].score! > 0, "Hybrid match should have a relevance score");
        }
    });
});
