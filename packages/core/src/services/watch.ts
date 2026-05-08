import path from 'node:path';
import { EventEmitter } from 'node:events';
import chokidar, { FSWatcher } from 'chokidar';
import { workspaceRoot, ALLOWED_BUCKETS } from '../context.js';
import { globalIndexer } from '../indexer.js';
import { getSharedDatabase } from '../database/index.js';
import { samplingService } from './sampling.js';
import { validationService } from './validation.js';
import { repairService } from './repair.js';

export class WatchService extends EventEmitter {
    private watcher: FSWatcher | null = null;
    private repairCount: Map<string, number> = new Map();
    private repairing = new Set<string>();
    private pruneInterval: NodeJS.Timeout | null = null;

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

        // Prune stale access log entries on startup and hourly
        getSharedDatabase().pruneAccessLog();
        this.pruneInterval = setInterval(() => {
            getSharedDatabase().pruneAccessLog();
        }, 3600000);
    }

    /**
     * Stops the watcher.
     */
    public stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.pruneInterval) {
            clearInterval(this.pruneInterval);
            this.pruneInterval = null;
        }
        console.log('🛑 Sentinel stopped.');
    }

    private async handleEvent(filePath: string) {
        const ext = path.extname(filePath);
        if (!['.md', '.ts', '.tsx', '.py'].includes(ext)) return;

        const relativePath = path.relative(workspaceRoot, filePath);
        if (this.repairing.has(relativePath)) return;
        
        try {
            console.log(`📝 Change detected: ${relativePath}`);
            if (ext === '.md') {
                // Aether 2.0: Self-Healing Loop (Validation + Repair)
                const { valid, issues } = await validationService.validateFile(filePath);
                if (!valid) {
                    const attempts = this.repairCount.get(relativePath) || 0;
                    if (attempts < 3) {
                        console.log(`⚠️ Validation failed for ${relativePath}: ${issues.join('; ')}`);
                        this.repairCount.set(relativePath, attempts + 1);
                        
                        // Aether 2.1: Visual state tracking
                        this.updateFileStatus(filePath, 'repairing');
                        this.repairing.add(relativePath);

                        const fixed = await repairService.attemptRepair(filePath, issues);
                        this.repairing.delete(relativePath);
                        if (fixed) {
                            console.log(`✨ Self-healing iteration ${attempts + 1} successful for ${relativePath}`);
                            this.updateFileStatus(filePath, 'pending');
                        } else {
                            this.updateFileStatus(filePath, 'error');
                        }
                    } else {
                        console.error(`🛑 Max repair attempts reached for ${relativePath}. Manual intervention required.`);
                    }
                } else {
                    this.repairCount.delete(relativePath); // Reset on success
                }
                
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

    private updateFileStatus(filePath: string, status: string) {
        const relativePath = path.relative(workspaceRoot, filePath);
        globalIndexer.getDatabase().updateDocumentStatus(relativePath, status);
        this.emit('sync', { type: 'update', path: relativePath });
    }
}

export const watchService = new WatchService();
