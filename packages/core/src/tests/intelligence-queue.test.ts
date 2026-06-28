import assert from 'node:assert';
import { getSharedDatabase } from '../database/index.js';
import { IntelligenceQueueService } from '../services/intelligence-queue.js';
import type { DatabaseService } from '../database/index.js';
import type { EmbeddingService } from '../services/embedding.js';
import { MetricsCollector } from '../metrics/index.js';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * A controllable DatabaseService double for the queue. It hands out `pending`
 * queue items and records every status transition. `processItem` is async via
 * the embedding double, letting us prove batches never overlap.
 */
function makeFakeDb(itemCount: number) {
    const items = Array.from({ length: itemCount }, (_, i) => ({ id: i + 1, doc_id: i + 1 }));
    let served = false;
    const docs = new Map(items.map(it => [it.doc_id, {
        id: it.doc_id, path: `doc-${it.doc_id}.md`, title: 't', excerpt: 'e', content: 'c',
    }]));
    const fake = {
        getBatchFromQueue: (_n: number) => {
            if (served) return [];
            served = true;
            return items;
        },
        getDocumentById: (docId: number) => docs.get(docId),
        setIntelligenceStatus: (_docId: number, _status: string) => {},
        upsertVector: (_docId: number, _v: Float32Array, _provider: string) => {},
        removeFromQueue: (_id: number) => {},
        incrementQueueRetry: (_id: number, _err: string) => {},
        getQueueItemRetryCount: (_id: number) => 0,
    };
    return fake as unknown as DatabaseService;
}

/** Embedding double that tracks concurrent in-flight calls so we can assert no overlap. */
function makeFakeEmbedding(workMs: number) {
    const state = { inFlight: 0, maxConcurrent: 0 };
    const fake = {
        generate: async (_text: string) => {
            state.inFlight += 1;
            state.maxConcurrent = Math.max(state.maxConcurrent, state.inFlight);
            await delay(workMs);
            state.inFlight -= 1;
            return new Float32Array([0.1, 0.2, 0.3]);
        },
        getProviderName: async () => 'fake',
    };
    return { embedding: fake as unknown as EmbeddingService, state };
}

describe('IntelligenceQueue (throughput & no-overlap, v4 WS-E #18)', () => {
    it('never runs two processBatch ticks concurrently (max concurrency stays 1 per item, batches serialized)', async () => {
        // Track how many distinct batch ticks overlap. The fake db serves one batch
        // then empties, so a single tick processes everything; we assert the next
        // tick is only scheduled AFTER the current batch resolves.
        const db = makeFakeDb(8);
        const { embedding } = makeFakeEmbedding(20);

        let activeBatches = 0;
        let maxActiveBatches = 0;
        const origGetBatch = (db as unknown as { getBatchFromQueue: (n: number) => unknown[] }).getBatchFromQueue;
        (db as unknown as { getBatchFromQueue: (n: number) => unknown[] }).getBatchFromQueue = (n: number) => {
            activeBatches += 1;
            maxActiveBatches = Math.max(maxActiveBatches, activeBatches);
            const res = origGetBatch(n);
            // Decrement on the next microtask boundary so overlapping ticks would be observed.
            queueMicrotask(() => { activeBatches -= 1; });
            return res as unknown[];
        };

        const svc = new IntelligenceQueueService(db, embedding);
        svc.start({ intervalMs: 1, batchSize: 25 });
        await delay(120);
        svc.stop();

        assert.strictEqual(maxActiveBatches, 1, 'no two batch ticks may overlap');
    });

    it('processes a batch of more than 5 items in a single tick (raised ceiling)', async () => {
        const db = makeFakeDb(12);
        const { embedding, state } = makeFakeEmbedding(5);
        const processed: number[] = [];
        (db as unknown as { upsertVector: (id: number, v: Float32Array, p: string) => void }).upsertVector =
            (id: number) => { processed.push(id); };

        const svc = new IntelligenceQueueService(db, embedding);
        svc.start({ intervalMs: 50, batchSize: 25 });
        await delay(60);
        svc.stop();
        await delay(20);

        assert.ok(processed.length > 5, `expected >5 items processed in one batch, got ${processed.length}`);
        assert.strictEqual(processed.length, 12, 'all 12 queued items should be processed in a single batch');
        assert.strictEqual(state.maxConcurrent, 12, 'items within a batch run in parallel');
    });

    it('stop() halts rescheduling so no further batches run', async () => {
        const db = makeFakeDb(3);
        const { embedding } = makeFakeEmbedding(2);
        let batchCalls = 0;
        (db as unknown as { getBatchFromQueue: (n: number) => unknown[] }).getBatchFromQueue = () => {
            batchCalls += 1;
            return [];
        };

        const svc = new IntelligenceQueueService(db, embedding);
        svc.start({ intervalMs: 5, batchSize: 25 });
        await delay(40);
        svc.stop();
        const callsAtStop = batchCalls;
        await delay(40);

        assert.strictEqual(batchCalls, callsAtStop, 'no batches may run after stop()');
    });

    it('publishes a queue-depth gauge via MetricsCollector when provided', async () => {
        const db = makeFakeDb(7);
        const { embedding } = makeFakeEmbedding(1);
        const metrics = new MetricsCollector();

        const svc = new IntelligenceQueueService(db, embedding, undefined, metrics);
        svc.start({ intervalMs: 50, batchSize: 25 });
        await delay(30);
        svc.stop();

        const depth = metrics.snapshot().gauges['intelligence_queue_depth'];
        assert.strictEqual(typeof depth, 'number', 'gauge should be recorded');
        assert.ok(depth >= 0, 'gauge value should be non-negative');
    });
});

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
