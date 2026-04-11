import path from 'node:path';
import fs from 'fs-extra';
import { workspaceRoot, ALLOWED_BUCKETS } from './context.js';
import { validationService } from './services/validation.js';
import { DatabaseService, DBRecord } from './services/database.js';
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

export class ContextIndexer {
    private dbService: DatabaseService;
    private embeddingService: EmbeddingService;

    constructor() {
        this.dbService = new DatabaseService(workspaceRoot);
        // Load API key if present for Elite mode
        const geminiKey = process.env.GEMINI_API_KEY;
        this.embeddingService = new EmbeddingService(geminiKey);
    }

    /**
     * Recursively indexes the workspace metadata.
     * Implements Incremental logic: only parses files changed since last index.
     */
    async reindex(options: { force?: boolean } = {}): Promise<{ records: IndexRecord[] }> {
        const existingDocuments = this.dbService.getAllDocuments();
        const existingRecordMap = new Map<string, DBRecord>();
        existingDocuments.forEach(doc => existingRecordMap.set(doc.path, doc));

        // 2. Scan buckets incrementally
        for (const bucket of ALLOWED_BUCKETS) {
            const bucketPath = path.join(workspaceRoot, bucket);
            if (await fs.pathExists(bucketPath)) {
                await this.scanDirectory(bucketPath, existingRecordMap);
            }
        }

        return { records: await this.search("") };
    }

    private async scanDirectory(dir: string, existingRecordMap: Map<string, DBRecord>) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.scanDirectory(fullPath, existingRecordMap);
                continue;
            }

            const relativePath = path.relative(workspaceRoot, fullPath);
            const stats = await fs.stat(fullPath);
            const existing = existingRecordMap.get(relativePath);

            if (entry.name.endsWith('.md')) {
                if (existing && existing.mtime === stats.mtimeMs) {
                    continue;
                }

                await this.indexFile(fullPath, stats.mtimeMs);
            } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.py')) {
                if (existing && existing.mtime === stats.mtimeMs) {
                    continue;
                }
                await this.indexCodeFile(fullPath, stats.mtimeMs);
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
                metadata: JSON.stringify(record.tags),
                intelligence_status: 'pending'
            });

            // 1b. Graph Edge Extraction (Incremental)
            this.dbService.removeEdgesForSource(record.path);
            
            // Explicit Links: Tags
            record.tags.forEach(tag => {
                this.dbService.upsertEdge(record.path, `tag:${tag}`, 'tag', 1.0);
            });

            // Explicit Links: Mentions (with Symbol Resolution)
            for (const mention of record.mentions) {
                this.dbService.upsertEdge(record.path, mention, 'mention', 1.0);
                
                // Source-Doc Interop: Link to implementation if symbol exists
                const symbol = this.dbService.getSymbolByName(mention);
                if (symbol) {
                    this.dbService.upsertEdge(record.path, `symbol:${symbol.name}`, 'code-ref', 1.0);
                }
            }

            // Phase 2: Intelligence Queue
            this.dbService.addToQueue(id);
        }
        return record;
    }

    /**
     * Extracts exported symbols from source code files.
     */
    public async indexCodeFile(filePath: string, mtimeMs?: number): Promise<void> {
        if (!mtimeMs) {
            const stats = await fs.stat(filePath);
            mtimeMs = stats.mtimeMs;
        }

        const relativePath = path.relative(workspaceRoot, filePath);
        
        // Cleanup old symbols for this file
        this.dbService.removeSymbolsForPath(relativePath);

        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        
        if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
            const tsRegex = /export\s+(function|class|const|async\s+function|interface|type)\s+([a-zA-Z0-9_]+)/g;
            let match;
            while ((match = tsRegex.exec(content)) !== null) {
                const name = match[2];
                const type = match[1];
                const offset = match.index;
                const lineNo = content.slice(0, offset).split('\n').length;
                const signature = lines[lineNo - 1].trim();
                
                this.dbService.upsertSymbol(name, relativePath, lineNo, type, signature);
                // Also add a graph node for the symbol
                this.dbService.upsertEdge(relativePath, `symbol:${name}`, 'contains', 0.5);
            }
        } else if (filePath.endsWith('.py')) {
            const pyRegex = /^(def|class)\s+([a-zA-Z0-9_]+)/gm;
            let match;
            while ((match = pyRegex.exec(content)) !== null) {
                const name = match[2];
                const type = match[1];
                const offset = match.index;
                const lineNo = content.slice(0, offset).split('\n').length;
                const signature = lines[lineNo - 1].trim();
                
                this.dbService.upsertSymbol(name, relativePath, lineNo, type, signature);
                this.dbService.upsertEdge(relativePath, `symbol:${name}`, 'contains', 0.5);
            }
        }
    }

    /**
     * Public method to remove a file from all index layers.
     */
    public async removeFile(relativePath: string): Promise<void> {
        // SQLite Cleanup
        this.dbService.removeDocument(relativePath);
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
     * Searches the local index using SQLite FTS5.
     */
    async search(query: string): Promise<IndexRecord[]> {
        const records = this.dbService.searchHybrid(new Float32Array(0), query, 20);
        // Map hybrid results back to IndexRecord
        return records.keywordResults.map((r: any) => ({
            path: r.path,
            title: r.title,
            excerpt: r.excerpt,
            tags: JSON.parse(r.metadata || '[]'),
            status: r.status || 'active',
            lastModified: r.mtime,
            content: r.content,
            mentions: [] // Not stored in main column yet
        }));
    }
}

export const globalIndexer = new ContextIndexer();
