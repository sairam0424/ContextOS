import fs from 'node:fs';
import path from 'node:path';
import { workspaceRoot, ALLOWED_BUCKETS } from '../context.js';
import { globalIndexer } from '../indexer.js';
import { samplingService } from './sampling.js';

export class WatchService {
    private watchers: fs.FSWatcher[] = [];
    private debouncers: Map<string, NodeJS.Timeout> = new Map();
    private DEBOUNCE_MS = 300;

    /**
     * Starts watching the allowed buckets for changes.
     */
    public start() {
        console.log('📡 Starting ContextOS Watch Service...');

        for (const bucket of ALLOWED_BUCKETS) {
            const bucketPath = path.join(workspaceRoot, bucket);
            if (!fs.existsSync(bucketPath)) continue;

            try {
                // On macOS, recursive: true is supported and very efficient
                const watcher = fs.watch(bucketPath, { recursive: true }, (eventType, filename) => {
                    if (!filename || !filename.endsWith('.md')) return;

                    const fullPath = path.join(bucketPath, filename);
                    this.debounceChange(fullPath);
                });

                this.watchers.push(watcher);
                console.log(`  - Watching [${bucket}]`);
            } catch (error) {
                console.error(`  - Failed to watch [${bucket}]:`, error);
            }
        }
    }

    /**
     * Stops all active watchers.
     */
    public stop() {
        for (const watcher of this.watchers) {
            watcher.close();
        }
        this.watchers = [];
        console.log('🛑 Watch Service stopped.');
    }

    private debounceChange(filePath: string) {
        if (this.debouncers.has(filePath)) {
            clearTimeout(this.debouncers.get(filePath));
        }

        const timeout = setTimeout(async () => {
            this.debouncers.delete(filePath);
            await this.handleEvent(filePath);
        }, this.DEBOUNCE_MS);

        this.debouncers.set(filePath, timeout);
    }

    private async handleEvent(filePath: string) {
        const relativePath = path.relative(workspaceRoot, filePath);
        
        try {
            if (fs.existsSync(filePath)) {
                console.log(`📝 Change detected: ${relativePath}`);
                await globalIndexer.indexFile(filePath);
            } else {
                console.log(`🗑️ Deletion detected: ${relativePath}`);
                await globalIndexer.removeFile(relativePath);
            }

            // Invalidate Sampling cache to ensure pulse is fresh
            samplingService.flushCache();
        } catch (error) {
            console.error(`❌ Watch error for ${relativePath}:`, error);
        }
    }
}

export const watchService = new WatchService();
