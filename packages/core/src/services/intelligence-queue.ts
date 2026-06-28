import { DatabaseService, getSharedDatabase } from '../database/index.js';
import { EmbeddingService, getSharedEmbeddingService } from './embedding.js';
import { WorkspaceEventBus } from '../events/index.js';
import { MetricsCollector } from '../metrics/index.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('intelligence-queue');

/** Default per-tick batch ceiling. Raised from 5 to lift embedding throughput (v4 WS-E #18). */
const DEFAULT_BATCH_SIZE = 25;
/** Default delay between successive batches once the current one resolves. */
const DEFAULT_INTERVAL_MS = 2000;

export class IntelligenceQueueService {
    private dbService: DatabaseService;
    private embeddingService: EmbeddingService;
    private eventBus: WorkspaceEventBus | null;
    private metrics: MetricsCollector | null;
    private isRunning: boolean = false;
    private stopped: boolean = true;
    private timeout: NodeJS.Timeout | null = null;
    private intervalMs: number = DEFAULT_INTERVAL_MS;
    private batchSize: number = DEFAULT_BATCH_SIZE;

    constructor(
        db?: DatabaseService,
        embeddingService?: EmbeddingService,
        eventBus?: WorkspaceEventBus,
        metrics?: MetricsCollector,
    ) {
        this.dbService = db || getSharedDatabase();
        this.embeddingService = embeddingService || getSharedEmbeddingService();
        this.eventBus = eventBus ?? null;
        this.metrics = metrics ?? null;
    }

    public start(options: { intervalMs?: number; batchSize?: number } = {}) {
        if (this.isRunning) return;
        this.isRunning = true;
        this.stopped = false;
        const { intervalMs = DEFAULT_INTERVAL_MS, batchSize = DEFAULT_BATCH_SIZE } = options;
        this.intervalMs = intervalMs;
        this.batchSize = batchSize;
        // Recursive setTimeout (NOT setInterval): the next tick is scheduled only
        // after the current processBatch fully resolves, so batches never overlap.
        this.scheduleNext(0);
    }

    public stop() {
        this.stopped = true;
        this.isRunning = false;
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }

    /** Schedules the next batch unless stop() has been called in the meantime. */
    private scheduleNext(delayMs: number) {
        if (this.stopped) return;
        this.timeout = setTimeout(() => {
            this.timeout = null;
            void this.runTick();
        }, delayMs);
    }

    /** Runs one batch to completion, then reschedules the next tick (no overlap). */
    private async runTick() {
        try {
            await this.processBatch();
        } finally {
            // An in-flight batch must not reschedule once stop() flipped the flag.
            this.scheduleNext(this.intervalMs);
        }
    }

    private async processBatch() {
        const items = this.dbService.getBatchFromQueue(this.batchSize);
        this.metrics?.gauge('intelligence_queue_depth', items.length);
        if (items.length === 0) return;

        await Promise.allSettled(items.map(item => this.processItem(item)));
    }

    private async processItem(item: { id: number; doc_id: number }) {
        let doc: ReturnType<DatabaseService['getDocumentById']> = undefined;
        try {
            this.dbService.setIntelligenceStatus(item.doc_id, 'processing');

            doc = this.dbService.getDocumentById(item.doc_id);
            if (!doc) {
                this.dbService.removeFromQueue(item.id);
                return;
            }

            const textToEmbed = `${doc.title}\n${doc.excerpt}\n${doc.content}`;
            const embedding = await this.embeddingService.generate(textToEmbed);

            this.dbService.upsertVector(item.doc_id, embedding, await this.embeddingService.getProviderName());
            this.dbService.removeFromQueue(item.id);

            log.info({ path: doc.path }, 'Intelligence ready');
            this.eventBus?.emit({ type: 'embedding.ready', path: doc.path, docId: item.doc_id });
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            this.dbService.incrementQueueRetry(item.id, errMsg);
            const retries = this.dbService.getQueueItemRetryCount(item.id);

            if (retries >= 3) {
                log.error({ docId: item.doc_id, retries }, 'Max retries reached, marking failed');
                this.eventBus?.emit({ type: 'embedding.failed', path: doc?.path ?? 'unknown', docId: item.doc_id, error: errMsg });
                this.dbService.removeFromQueue(item.id);
                this.dbService.setIntelligenceStatus(item.doc_id, 'failed');
            } else {
                log.warn({ docId: item.doc_id, retries, error: errMsg }, 'Retry scheduled');
                this.dbService.setIntelligenceStatus(item.doc_id, 'pending');
            }
        }
    }
}

/** @deprecated Use container.resolve(TOKENS.IntelligenceQueue) from createContextOS() instead. */
export const intelligenceQueue = new IntelligenceQueueService();
