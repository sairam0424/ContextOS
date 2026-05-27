import { DatabaseService, getSharedDatabase } from '../database/index.js';
import { EmbeddingService, getSharedEmbeddingService } from './embedding.js';
import { WorkspaceEventBus } from '../events/index.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('intelligence-queue');

export class IntelligenceQueueService {
    private dbService: DatabaseService;
    private embeddingService: EmbeddingService;
    private eventBus: WorkspaceEventBus | null;
    private isRunning: boolean = false;
    private interval: NodeJS.Timeout | null = null;
    private batchSize: number = 5;

    constructor(db?: DatabaseService, embeddingService?: EmbeddingService, eventBus?: WorkspaceEventBus) {
        this.dbService = db || getSharedDatabase();
        this.embeddingService = embeddingService || getSharedEmbeddingService();
        this.eventBus = eventBus ?? null;
    }

    public start(options: { intervalMs?: number; batchSize?: number } = {}) {
        if (this.isRunning) return;
        this.isRunning = true;
        const { intervalMs = 2000, batchSize = 5 } = options;
        this.batchSize = batchSize;
        this.interval = setInterval(() => this.processBatch(), intervalMs);
    }

    public stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
    }

    private async processBatch() {
        const items = this.dbService.getBatchFromQueue(this.batchSize);
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
