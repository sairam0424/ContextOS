import path from 'node:path';
import fs from 'fs-extra';
import { workspaceRoot, ALLOWED_BUCKETS } from './context.js';
import { validationService } from './services/validation.js';
import { DatabaseService } from './services/database.js';
import { EmbeddingService } from './services/embedding.js';

export interface IndexRecord {
    path: string;
    title: string;
    tags: string[];
    status: string;
    lastModified: number;
    excerpt: string;
    content: string;
    mentions: string[];
}

export interface ContextIndex {
    version: string;
    lastUpdated: number;
    records: IndexRecord[];
    provider?: string; // Metadata for which embedding provider was used
}

export class ContextIndexer {
    private indexPath: string;
    private previousIndex: ContextIndex | null = null;
    private dbService: DatabaseService;
    private embeddingService: EmbeddingService;

    constructor() {
        this.indexPath = path.join(workspaceRoot, '.context-index.json');
        this.dbService = new DatabaseService(workspaceRoot);
        // Load API key if present for Elite mode
        const geminiKey = process.env.GEMINI_API_KEY;
        this.embeddingService = new EmbeddingService(geminiKey);
    }

    /**
     * Recursively indexes the workspace metadata.
     * Implements Incremental logic: only parses files changed since last index.
     */
    async reindex(options: { force?: boolean } = {}): Promise<ContextIndex> {
        // 1. Load previous index for incremental comparison
        if (!options.force && await fs.pathExists(this.indexPath)) {
            try {
                this.previousIndex = await fs.readJSON(this.indexPath);
                // Upgrade from v1.2.x to v1.3.0 forces a semantic re-index
                if (this.previousIndex && this.previousIndex.version !== '1.3.0') {
                    this.previousIndex = null;
                }
            } catch (e) {
                this.previousIndex = null;
            }
        }

        const index: ContextIndex = {
            version: '1.3.0',
            lastUpdated: Date.now(),
            records: [],
            provider: await this.embeddingService.getProviderName()
        };

        const existingRecordMap = new Map<string, IndexRecord>();
        if (this.previousIndex) {
            this.previousIndex.records.forEach(r => existingRecordMap.set(r.path, r));
        }

        // 2. Scan buckets incrementally
        for (const bucket of ALLOWED_BUCKETS) {
            const bucketPath = path.join(workspaceRoot, bucket);
            if (await fs.pathExists(bucketPath)) {
                await this.scanDirectory(bucketPath, index.records, existingRecordMap);
            }
        }

        // 3. Atomic persistence
        const tempPath = `${this.indexPath}.tmp`;
        await fs.writeJSON(tempPath, index, { spaces: 2 });
        await fs.move(tempPath, this.indexPath, { overwrite: true });

        return index;
    }

    private async scanDirectory(dir: string, records: IndexRecord[], existingRecordMap: Map<string, IndexRecord>) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.scanDirectory(fullPath, records, existingRecordMap);
                continue;
            }

            if (entry.name.endsWith('.md')) {
                const relativePath = path.relative(workspaceRoot, fullPath);
                const stats = await fs.stat(fullPath);
                const existing = existingRecordMap.get(relativePath);

                // Incremental Check: Skip parsing if mtime matches
                if (existing && existing.lastModified === stats.mtimeMs) {
                    records.push(existing);
                    continue;
                }

                const record = await this.indexFile(fullPath, stats.mtimeMs);
                if (record) {
                    records.push(record);
                }
            }
        }
    }

    /**
     * Public method to index or update a single file.
     * Synchronizes both SQLite and the JSON index.
     */
    public async indexFile(filePath: string, mtimeMs?: number): Promise<IndexRecord | null> {
        if (!mtimeMs) {
            const stats = await fs.stat(filePath);
            mtimeMs = stats.mtimeMs;
        }

        const record = await this.parseMarkdownFile(filePath, mtimeMs);
        if (record) {
            // 1. SQLite Upsert + Semantic Generation
            const { id } = this.dbService.upsertDocument({
                path: record.path,
                title: record.title,
                content: record.content,
                excerpt: record.excerpt,
                mtime: record.lastModified,
                metadata: JSON.stringify(record.tags)
            });

            // Generate Vector for Semantic Layer
            const embedding = await this.embeddingService.generate(`${record.title}\n${record.excerpt}\n${record.content}`);
            this.dbService.upsertVector(id, embedding, await this.embeddingService.getProviderName());

            // 2. Update JSON Index (if it exists)
            await this.updateJsonIndex(record);
        }
        return record;
    }

    /**
     * Public method to remove a file from all index layers.
     */
    public async removeFile(relativePath: string): Promise<void> {
        // 1. SQLite Cleanup
        this.dbService.removeDocument(relativePath);

        // 2. JSON Cleanup
        if (await fs.pathExists(this.indexPath)) {
            try {
                const index: ContextIndex = await fs.readJSON(this.indexPath);
                index.records = index.records.filter(r => r.path !== relativePath);
                index.lastUpdated = Date.now();
                await fs.writeJSON(this.indexPath, index, { spaces: 2 });
            } catch (e) {
                // Ignore parsing errors
            }
        }
    }

    private async updateJsonIndex(record: IndexRecord) {
        if (!(await fs.pathExists(this.indexPath))) return;

        try {
            const index: ContextIndex = await fs.readJSON(this.indexPath);
            const existingIndex = index.records.findIndex(r => r.path === record.path);
            
            if (existingIndex >= 0) {
                index.records[existingIndex] = record;
            } else {
                index.records.push(record);
            }
            
            index.lastUpdated = Date.now();
            await fs.writeJSON(this.indexPath, index, { spaces: 2 });
        } catch (e) {
            // If JSON is corrupt, it'll be fixed on next full reindex
        }
    }

    private async parseMarkdownFile(filePath: string, mtimeMs: number): Promise<IndexRecord | null> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const relativePath = path.relative(workspaceRoot, filePath);

            // Use Unified Validation Service for parsing
            const metadata = validationService.extractMetadata(content);

            // Extract title (First H1 or filename)
            let title = metadata.title || '';
            if (!title) {
                const h1Match = content.match(/^#\s+(.*)/m);
                title = h1Match ? h1Match[1] : path.basename(filePath, '.md');
            }

            // Generate Excerpt
            const body = content.replace(/^---[\s\S]*?---/, '').trim();
            const excerpt = body.split(/\n\s*\n/)[0]
                .slice(0, 200)
                .replace(/\r?\n/g, ' ')
                .trim();

            // Entity Extraction
            const mentions = Array.from(body.matchAll(/@(\w+)/g)).map(m => m[1]);
            const bodyTags = Array.from(body.matchAll(/#(\w+)/g)).map(m => m[1]);
            const tags = Array.from(new Set([
                ...(Array.isArray(metadata.Tags) ? metadata.Tags : (Array.isArray(metadata.tags) ? metadata.tags : [])),
                ...bodyTags
            ]));

            return {
                path: relativePath,
                title,
                tags,
                status: metadata.status || 'active',
                lastModified: mtimeMs,
                excerpt,
                content: body,
                mentions
            };
        } catch (error) {
            console.error(`Failed to index ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Searches the local index.
     */
    async search(query: string): Promise<IndexRecord[]> {
        if (!(await fs.pathExists(this.indexPath))) {
            return [];
        }

        const index: ContextIndex = await fs.readJSON(this.indexPath);
        const lowerQuery = query.toLowerCase();

        return index.records.filter(record => 
            record.title.toLowerCase().includes(lowerQuery) ||
            record.tags.some(t => t.toLowerCase().includes(lowerQuery)) ||
            record.excerpt.toLowerCase().includes(lowerQuery) ||
            record.path.toLowerCase().includes(lowerQuery)
        );
    }
}

export const globalIndexer = new ContextIndexer();
