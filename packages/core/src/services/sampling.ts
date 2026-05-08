import { DatabaseService, getSharedDatabase } from "../database/index.js";

export interface WorkspacePulse {
    timestamp: number;
    healthScore: number; // 0-100 based on metadata completeness
    topTags: string[];
    activeEntities: string[];
    recentChanges: string[];
    intelligenceStatus: {
        pending: number;
        processing: number;
        ready: number;
        failed: number;
    };
}

export class SamplingService {
    private dbService: DatabaseService;
    private cache: { data: WorkspacePulse; expiry: number } | null = null;
    private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    constructor(dbService?: DatabaseService) {
        this.dbService = dbService || getSharedDatabase();
    }

    /**
     * Generates a high-level summary of the entire workspace.
     * Cached for 5 minutes to prevent expensive re-scans.
     */
    async getPulse(): Promise<WorkspacePulse> {
        const now = Date.now();
        // Check if cache is still valid
        if (this.cache && this.cache.expiry > now && this.cache.data) {
            return this.cache.data;
        }

        const docs = this.dbService.getAllDocuments();
        
        // 1. Calculate Health Score (Basic: % of docs with title and tags)
        let completeDocs = 0;
        const tagCounts: Record<string, number> = {};
        const entityCounts: Record<string, number> = {};
        const recent: string[] = [];

        const intelligenceStatus = {
            pending: 0,
            processing: 0,
            ready: 0,
            failed: 0
        };

        docs.forEach((doc: any) => {
            const tags = JSON.parse(doc.metadata || '[]');
            if (doc.title && tags.length > 0) completeDocs++;

            tags.forEach((t: string) => {
                tagCounts[t] = (tagCounts[t] || 0) + 1;
            });

            // Intelligence Status Tracking
            const status = (doc.intelligence_status || 'pending') as keyof typeof intelligenceStatus;
            if (intelligenceStatus[status] !== undefined) {
                intelligenceStatus[status]++;
            }

            // Tracking recent changes (last 5)
            recent.push(doc.path);
        });

        const healthScore = docs.length > 0 ? (completeDocs / docs.length) * 100 : 0;

        // 2. Extract Top 5 Tags
        const topTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(e => e[0]);

        const pulse: WorkspacePulse = {
            timestamp: now,
            healthScore: Math.round(healthScore),
            topTags,
            activeEntities: [], 
            recentChanges: recent.slice(-5).reverse(),
            intelligenceStatus
        };

        this.cache = {
            data: pulse,
            expiry: now + this.CACHE_TTL
        };

        return pulse;
    }

    /**
     * Public method to invalidate cache manually (used by WatchService)
     */
    public flushCache() {
        this.cache = null;
    }
}

export const samplingService = new SamplingService();
