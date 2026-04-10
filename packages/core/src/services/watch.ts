import path from 'node:path';
import chokidar, { FSWatcher } from 'chokidar';
import { workspaceRoot, ALLOWED_BUCKETS } from '../context.js';
import { globalIndexer } from '../indexer.js';
import { samplingService } from './sampling.js';

export class WatchService {
    private watcher: FSWatcher | null = null;

    /**
     * Starts watching the allowed buckets for changes.
     */
    public start() {
        console.log('📡 Starting ContextOS Sentinel (Chokidar)...');

        const pathsToWatch = ALLOWED_BUCKETS.map(bucket => path.join(workspaceRoot, bucket));
        
        this.watcher = chokidar.watch(pathsToWatch, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 100
            }
        });

        this.watcher
            .on('add', (filePath: string) => this.handleEvent(filePath))
            .on('change', (filePath: string) => this.handleEvent(filePath))
            .on('unlink', (filePath: string) => this.handleDeletion(filePath))
            .on('error', (error: any) => console.error(`[Sentinel] Watch Error: ${error}`));

        console.log(`  - Monitoring buckets: ${ALLOWED_BUCKETS.join(', ')}`);
    }

    /**
     * Stops the watcher.
     */
    public stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        console.log('🛑 Sentinel stopped.');
    }

    private async handleEvent(filePath: string) {
        if (!filePath.endsWith('.md')) return;
        const relativePath = path.relative(workspaceRoot, filePath);
        
        try {
            console.log(`📝 Change detected: ${relativePath}`);
            await globalIndexer.indexFile(filePath);
            samplingService.flushCache();
        } catch (error) {
            console.error(`❌ Watch error for ${relativePath}:`, error);
        }
    }

    private async handleDeletion(filePath: string) {
        const relativePath = path.relative(workspaceRoot, filePath);
        try {
            console.log(`🗑️ Deletion detected: ${relativePath}`);
            await globalIndexer.removeFile(relativePath);
            samplingService.flushCache();
        } catch (error) {
            console.error(`❌ Deletion error for ${relativePath}:`, error);
        }
    }
}

export const watchService = new WatchService();
