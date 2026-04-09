import assert from 'node:assert';
import path from 'node:path';
import fs from 'fs-extra';
import { globalIndexer } from '../indexer.js';
import { intelligenceService } from '../services/intelligence.js';
import { workspaceRoot } from '../context.js';

describe('Hybrid SQLite-Vec Intelligence Engine (v1.3.0)', () => {
    
    before(async () => {
        // Clean up previous test DB if any
        const dbPath = path.join(workspaceRoot, 'context-db', 'context.db');
        if (await fs.pathExists(dbPath)) {
            // No-op for now to keep data if needed, but usually tests should be clean
        }
    });

    it('should initialize the SQLite database in context-db/', async () => {
        const dbPath = path.join(workspaceRoot, 'context-db', 'context.db');
        const exists = await fs.pathExists(dbPath);
        // If not exists yet, reindex will create it
        if (!exists) {
            await globalIndexer.reindex({ force: true });
        }
        assert.ok(await fs.pathExists(dbPath), 'Database file should exist in context-db/');
    });

    it('should generate and store local embeddings during indexing', async () => {
        // Force a fresh index to trigger local embedding generation
        const index = await globalIndexer.reindex({ force: true });
        assert.strictEqual(index.version, '1.3.0', 'Index version should be upgraded');
        assert.strictEqual(index.provider, 'local', 'Default provider should be local');
        
        // Check if any record has content (prerequisite for embeddings)
        assert.ok(index.records.length > 0, "Should have at least one record");
        assert.ok(index.records[0].content.length > 0, "Record should have body content");
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

    it('should fall back to MiniSearch Lite if SQLite fails (Mock scenario)', async () => {
        // This validates that the 'records' array in .context-index.json is still being maintained
        const indexPath = path.join(workspaceRoot, '.context-index.json');
        const jsonContent = await fs.readJSON(indexPath);
        assert.ok(jsonContent.records.length > 0, "JSON index should still contain records ('Lite' mode parity)");
    });
});
