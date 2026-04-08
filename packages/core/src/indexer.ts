import path from 'node:path';
import fs from 'fs-extra';
import { workspaceRoot, ALLOWED_BUCKETS } from './context.js';
import { validationService } from './services/validation.js';

export interface IndexRecord {
    path: string;
    title: string;
    tags: string[];
    status: string;
    lastModified: number;
    excerpt: string;
}

export interface ContextIndex {
    version: string;
    lastUpdated: number;
    records: IndexRecord[];
}

export class ContextIndexer {
    private indexPath: string;
    private previousIndex: ContextIndex | null = null;

    constructor() {
        this.indexPath = path.join(workspaceRoot, '.context-index.json');
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
            } catch (e) {
                this.previousIndex = null;
            }
        }

        const index: ContextIndex = {
            version: '1.2.0',
            lastUpdated: Date.now(),
            records: []
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

                const record = await this.parseMarkdownFile(fullPath, stats.mtimeMs);
                if (record) records.push(record);
            }
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

            return {
                path: relativePath,
                title,
                tags: Array.isArray(metadata.Tags) ? metadata.Tags : 
                      (Array.isArray(metadata.tags) ? metadata.tags : []),
                status: metadata.status || 'active',
                lastModified: mtimeMs,
                excerpt
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
