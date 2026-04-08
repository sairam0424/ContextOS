import path from 'node:path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { workspaceRoot, ALLOWED_BUCKETS } from './context.js';

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

    constructor() {
        this.indexPath = path.join(workspaceRoot, '.context-index.json');
    }

    /**
     * Recursively indexes the workspace metadata.
     */
    async reindex(): Promise<ContextIndex> {
        const index: ContextIndex = {
            version: '1.1.0',
            lastUpdated: Date.now(),
            records: []
        };

        for (const bucket of ALLOWED_BUCKETS) {
            const bucketPath = path.join(workspaceRoot, bucket);
            if (await fs.pathExists(bucketPath)) {
                await this.scanDirectory(bucketPath, index.records);
            }
        }

        await fs.writeJSON(this.indexPath, index, { spaces: 2 });
        return index;
    }

    private async scanDirectory(dir: string, records: IndexRecord[]) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.scanDirectory(fullPath, records);
                continue;
            }

            if (entry.name.endsWith('.md')) {
                const record = await this.parseMarkdownFile(fullPath);
                if (record) records.push(record);
            }
        }
    }

    private async parseMarkdownFile(filePath: string): Promise<IndexRecord | null> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const stats = await fs.stat(filePath);
            const relativePath = path.relative(workspaceRoot, filePath);

            // Simple frontmatter extraction
            const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            let metadata: any = {};
            let body = content;

            if (fmMatch) {
                metadata = yaml.load(fmMatch[1]) || {};
                body = content.slice(fmMatch[0].length).trim();
            }

            // Extract title (either from FM or first H1)
            let title = metadata.title || '';
            if (!title) {
                const h1Match = body.match(/^#\s+(.*)/m);
                title = h1Match ? h1Match[1] : path.basename(filePath, '.md');
            }

            // Excerpt (first 200 chars or first paragraph)
            const excerpt = body.split(/\n\s*\n/)[0].slice(0, 200).replace(/\r?\n/g, ' ').trim();

            return {
                path: relativePath,
                title,
                tags: Array.isArray(metadata.tags) ? metadata.tags : [],
                status: metadata.status || 'active',
                lastModified: stats.mtimeMs,
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
