import { DatabaseService } from './database.js';
import { EmbeddingService } from './embedding.js';
import { workspaceRoot } from '../context.js';

export class IntelligenceQueueService {
    private dbService: DatabaseService;
    private embeddingService: EmbeddingService;
    private isRunning: boolean = false;
    private interval: NodeJS.Timeout | null = null;

    constructor() {
        this.dbService = new DatabaseService(workspaceRoot);
        const geminiKey = process.env.GEMINI_API_KEY;
        this.embeddingService = new EmbeddingService(geminiKey);
    }

    public start(intervalMs: number = 2000) {
        if (this.isRunning) return;
        this.isRunning = true;
        this.interval = setInterval(() => this.processNext(), intervalMs);
    }

    public stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
    }

    private async processNext() {
        const item = this.dbService.getNextFromQueue();
        if (!item) return;

        try {
            // Set status to processing
            this.dbService.setIntelligenceStatus(item.doc_id, 'processing');
            
            const doc = this.dbService.getAllDocuments().find(d => d.id === item.doc_id);
            if (!doc) {
                this.dbService.removeFromQueue(item.id);
                return;
            }

            // Generate Embedding
            const textToEmbed = `${doc.title}\n${doc.excerpt}\n${doc.content}`;
            const embedding = await this.embeddingService.generate(textToEmbed);
            
            // Sync SQLite
            this.dbService.upsertVector(item.doc_id, embedding, await this.embeddingService.getProviderName());
            
            // Remove from queue
            this.dbService.removeFromQueue(item.id);
            
            console.log(`[Backbone] Intelligence Ready: ${doc.path}`);
        } catch (error) {
            console.error(`[Backbone] Intelligence Failed for doc ${item.doc_id}:`, error);
            // Re-queue with lower priority or just skip for now to avoid infinite loops
            this.dbService.removeFromQueue(item.id);
        }
    }
}

export const intelligenceQueue = new IntelligenceQueueService();
