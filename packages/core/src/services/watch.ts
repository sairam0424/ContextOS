import path from 'node:path';
import { EventEmitter } from 'node:events';
import chokidar, { FSWatcher } from 'chokidar';
import { workspaceRoot, ALLOWED_BUCKETS } from '../context.js';
import { globalIndexer } from '../indexer.js';
import { getSharedDatabase } from '../database/index.js';
import { samplingService } from './sampling.js';
import { validationService } from './validation.js';
import { repairService } from './repair.js';
import { WorkspaceEventBus } from '../events/index.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('watch');

export class WatchService extends EventEmitter {
    private watcher: FSWatcher | null = null;
    private repairCount: Map<string, number> = new Map();
    private repairing = new Set<string>();
    private pruneInterval: NodeJS.Timeout | null = null;
    private eventBus: WorkspaceEventBus | null;

    constructor(eventBus?: WorkspaceEventBus) {
        super();
        this.eventBus = eventBus ?? null;
    }

    /**
     * Starts watching the allowed buckets for changes.
     */
    public start() {
        log.info('Starting ContextOS Sentinel');

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
            .on('error', (error: any) => log.error({ err: error }, 'Watch error'));

        log.info({ buckets: ALLOWED_BUCKETS }, 'Monitoring buckets');

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
        log.info('Sentinel stopped');
    }

    private async handleEvent(filePath: string) {
        const ext = path.extname(filePath);
        if (!['.md', '.ts', '.tsx', '.py'].includes(ext)) return;

        const relativePath = path.relative(workspaceRoot, filePath);
        if (this.repairing.has(relativePath)) return;
        
        try {
            log.info({ path: relativePath }, 'Change detected');
            this.eventBus?.emit({ type: 'file.changed', path: relativePath, kind: 'change' });
            if (ext === '.md') {
                // Aether 2.0: Self-Healing Loop (Validation + Repair)
                const { valid, issues } = await validationService.validateFile(filePath);
                if (!valid) {
                    const attempts = this.repairCount.get(relativePath) || 0;
                    if (attempts < 3) {
                        log.warn({ path: relativePath, issues }, 'Validation failed');
                        this.repairCount.set(relativePath, attempts + 1);
                        
                        // Aether 2.1: Visual state tracking
                        this.updateFileStatus(filePath, 'repairing');
                        this.repairing.add(relativePath);

                        const fixed = await repairService.attemptRepair(filePath, issues);
                        this.repairing.delete(relativePath);
                        if (fixed) {
                            log.info({ path: relativePath, attempt: attempts + 1 }, 'Self-healing successful');
                            this.updateFileStatus(filePath, 'pending');
                        } else {
                            this.updateFileStatus(filePath, 'error');
                        }
                    } else {
                        log.error({ path: relativePath }, 'Max repair attempts reached, manual intervention required');
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
            log.error({ path: relativePath, err: error }, 'Watch handler error');
        }
    }

    private async handleDeletion(filePath: string) {
        const relativePath = path.relative(workspaceRoot, filePath);
        try {
            log.info({ path: relativePath }, 'Deletion detected');
            this.eventBus?.emit({ type: 'file.deleted', path: relativePath });
            await globalIndexer.removeFile(relativePath);
            samplingService.flushCache();
            this.emit('sync', { type: 'delete', path: relativePath });
        } catch (error) {
            log.error({ path: relativePath, err: error }, 'Deletion handler error');
        }
    }

    private updateFileStatus(filePath: string, status: string) {
        const relativePath = path.relative(workspaceRoot, filePath);
        globalIndexer.getDatabase().updateDocumentStatus(relativePath, status);
        this.emit('sync', { type: 'update', path: relativePath });
    }
}

export const watchService = new WatchService();
