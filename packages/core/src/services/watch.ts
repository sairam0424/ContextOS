import path from 'node:path';
import { EventEmitter } from 'node:events';
import chokidar, { FSWatcher } from 'chokidar';
import { workspaceRoot, ALLOWED_BUCKETS } from '../context.js';
import { globalIndexer } from '../indexer.js';
import { samplingService } from './sampling.js';

export class WatchService extends EventEmitter {
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
        const ext = path.extname(filePath);
        if (!['.md', '.ts', '.tsx', '.py'].includes(ext)) return;
        
        const relativePath = path.relative(workspaceRoot, filePath);
        
        try {
            console.log(`📝 Change detected: ${relativePath}`);
            if (ext === '.md') {
                await globalIndexer.indexFile(filePath);
            } else {
                await globalIndexer.indexCodeFile(filePath);
            }
            samplingService.flushCache();
            this.emit('sync', { type: 'update', path: relativePath });
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
            this.emit('sync', { type: 'delete', path: relativePath });
        } catch (error) {
            console.error(`❌ Deletion error for ${relativePath}:`, error);
        }
    }
}

export const watchService = new WatchService();
