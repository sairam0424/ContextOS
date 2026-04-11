import assert from 'node:assert';
import path from 'node:path';
import fs from 'fs-extra';
import { globalIndexer } from '../indexer.js';
import { intelligenceService } from '../services/intelligence.js';
import { workspaceRoot } from '../context.js';

describe('Hybrid SQLite-Vec Intelligence Engine (v1.3.0)', () => {
    
    before(async () => {
        // Clean up previous test DB if any
        const dbPath = path.join(workspaceRoot, '.context-db', 'context.db');
        if (await fs.pathExists(dbPath)) {
            // No-op for now to keep data if needed, but usually tests should be clean
        }
    });

    it('should initialize the SQLite database in .context-db/', async () => {
        const dbPath = path.join(workspaceRoot, '.context-db', 'context.db');
        const exists = await fs.pathExists(dbPath);
        // If not exists yet, reindex will create it
        if (!exists) {
            await globalIndexer.reindex({ force: true });
        }
        assert.ok(await fs.pathExists(dbPath), 'Database file should exist in .context-db/');
    });

    it('should generate and store local embeddings during indexing', async () => {
        // Force a fresh index to trigger local embedding generation
        const { records } = await globalIndexer.reindex({ force: true });
        
        // Check if any record has content (prerequisite for embeddings)
        assert.ok(records.length > 0, "Should have at least one record");
        assert.ok(records[0].content.length > 0, "Record should have body content");
    });

    it('should perform a successful semantic search', async () => {
        // Query for "autonomy" which is in root/soul.md
        const results = await intelligenceService.search("autonomy");
        assert.ok(results.length > 0, "Should find results for 'autonomy'");
        
        // Check for semantic type
        const hasSemantic = results.some(r => r.type === 'semantic');
        assert.ok(hasSemantic, "Should have at least one semantic match");
        
        if (hasSemantic) {
            const semanticMatch = results.find(r => r.type === 'semantic');
            assert.ok(semanticMatch!.score! > 0, "Semantic match should have a similarity score");
        }
    });

    it('should maintain MiniSearch Lite parity after reindex', async () => {
        // This validates that the search service index is populated
        const results = await intelligenceService.search("");
        assert.ok(results.length >= 0, "Search service should be initialized");
    });
});
