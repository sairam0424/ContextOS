import { DatabaseService, getSharedDatabase } from './database.js';
import { EmbeddingService, getSharedEmbeddingService } from './embedding.js';

export class IntelligenceQueueService {
    private dbService: DatabaseService;
    private embeddingService: EmbeddingService;
    private isRunning: boolean = false;
    private interval: NodeJS.Timeout | null = null;
    private batchSize: number = 5;

    constructor(db?: DatabaseService, embeddingService?: EmbeddingService) {
        this.dbService = db || getSharedDatabase();
        this.embeddingService = embeddingService || getSharedEmbeddingService();
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
        try {
            this.dbService.setIntelligenceStatus(item.doc_id, 'processing');

            const doc = this.dbService.getDocumentById(item.doc_id);
            if (!doc) {
                this.dbService.removeFromQueue(item.id);
                return;
            }

            const textToEmbed = `${doc.title}\n${doc.excerpt}\n${doc.content}`;
            const embedding = await this.embeddingService.generate(textToEmbed);

            this.dbService.upsertVector(item.doc_id, embedding, await this.embeddingService.getProviderName());
            this.dbService.removeFromQueue(item.id);

            console.log(`[Backbone] Intelligence Ready: ${doc.path}`);
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            this.dbService.incrementQueueRetry(item.id, errMsg);
            const retries = this.dbService.getQueueItemRetryCount(item.id);

            if (retries >= 3) {
                console.error(`[Backbone] Max retries reached for doc ${item.doc_id}. Marking failed.`);
                this.dbService.removeFromQueue(item.id);
                this.dbService.setIntelligenceStatus(item.doc_id, 'failed');
            } else {
                console.warn(`[Backbone] Retry ${retries}/3 for doc ${item.doc_id}: ${errMsg}`);
                this.dbService.setIntelligenceStatus(item.doc_id, 'pending');
            }
        }
    }
}

export const intelligenceQueue = new IntelligenceQueueService();
