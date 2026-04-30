import assert from 'node:assert';
import { getSharedDatabase } from '../services/database.js';

describe('IntelligenceQueue (Database Layer)', () => {
    const db = getSharedDatabase();
    const prefix = 'test-queue-' + Date.now();

    after(() => {
        db.removeDocument(`${prefix}.md`);
    });

    it('should enqueue a document for embedding generation', () => {
        const { id } = db.upsertDocument({
            path: `${prefix}.md`, title: 'Queue Test', content: 'Test content',
            excerpt: 'Test', mtime: Date.now(), metadata: '[]',
            intelligence_status: 'pending'
        });
        db.addToQueue(id, 5);

        const next = db.getNextFromQueue();
        assert.ok(next, 'Should have an item in queue');
        assert.strictEqual(next!.doc_id, id);
    });

    it('should remove from queue after processing', () => {
        const { id } = db.upsertDocument({
            path: `${prefix}.md`, title: 'Queue Test', content: 'Test content',
            excerpt: 'Test', mtime: Date.now(), metadata: '[]',
            intelligence_status: 'pending'
        });
        db.addToQueue(id, 1);

        const item = db.getNextFromQueue();
        assert.ok(item, 'Queue should have an item');
        db.removeFromQueue(item!.id);

        // After removal, next item should be different or undefined
        const next = db.getNextFromQueue();
        if (next) {
            assert.notStrictEqual(next.id, item!.id, 'Removed item should not reappear');
        }
    });

    it('should track intelligence status transitions', () => {
        const { id } = db.upsertDocument({
            path: `${prefix}.md`, title: 'Queue Test', content: 'Test content',
            excerpt: 'Test', mtime: Date.now(), metadata: '[]',
            intelligence_status: 'pending'
        });

        db.setIntelligenceStatus(id, 'processing');
        let doc = db.getDocumentByPath(`${prefix}.md`);
        assert.strictEqual(doc?.intelligence_status, 'processing');

        db.setIntelligenceStatus(id, 'ready');
        doc = db.getDocumentByPath(`${prefix}.md`);
        assert.strictEqual(doc?.intelligence_status, 'ready');
    });
});
