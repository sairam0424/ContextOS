import { execFile } from "child_process";
import { promisify } from "util";
import { getWorkspaceRoot } from "../context.js";
import { DatabaseService, getSharedDatabase } from "../database/index.js";
import { EmbeddingService, getSharedEmbeddingService } from "./embedding.js";
import { capabilityService } from "./capability.js";
import { createChildLogger } from '../logger.js';

const log = createChildLogger('intelligence');

const execFileAsync = promisify(execFile);

export interface SearchResult {
  path: string;
  title: string;
  tags: string[];
  excerpt: string;
  score?: number;
  type: 'hybrid' | 'deep';
}

export class IntelligenceService {
  private dbService: DatabaseService | null = null;
  private embeddingService: EmbeddingService | null = null;

  /**
   * Hybrid Search: Semantic (sqlite-vec) + Keyword (FTS5) -> Grep Fallback
   */
  async search(query: string, options: { deep?: boolean, includePrivate?: boolean, anchorNode?: string, limit?: number, offset?: number } = {}): Promise<SearchResult[]> {
    if (!options.deep) {
      if (!this.dbService) this.dbService = getSharedDatabase();
      if (!this.embeddingService) this.embeddingService = getSharedEmbeddingService();

      try {
        let queryEmbedding: Float32Array;
        try {
          queryEmbedding = await this.embeddingService.generate(query);
        } catch {
          queryEmbedding = new Float32Array(0);
        }

        const { combined } = this.dbService.searchHybrid(queryEmbedding, query, options.limit ?? 10, options.includePrivate, options.offset ?? 0);

        const capability = capabilityService.match(query);
        log.info({ role: capability.role, query }, 'Matched capability');

        if (combined.length > 0) {
          const affinities = options.anchorNode ? this.dbService.getAffinities(options.anchorNode) : new Map<string, number>();

          return combined.map((res: any) => {
            let score = res.score;
            const affinity = affinities.get(res.path) || 0;
            if (affinity > 0) {
              score *= (1 + affinity);
            }

            return {
              path: res.path,
              title: res.title,
              tags: JSON.parse(res.metadata || '[]'),
              excerpt: res.excerpt,
              score,
              type: 'hybrid'
            } as SearchResult;
          }).sort((a, b) => (b.score || 0) - (a.score || 0));
        }
      } catch (err) {
        log.error({ err }, 'Hybrid search failed, falling back to grep');
      }
    }

    // Fallback: Grep (uses execFile to prevent shell injection)
    if (!this.dbService) this.dbService = getSharedDatabase();
    const workspaceRoot = getWorkspaceRoot();
    try {
      const { stdout } = await execFileAsync('grep', ['-rnIF', '--', query, '.'], {
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10000
      });
      if (!stdout) return [];

      return stdout.split('\n')
        .filter((line: string) => line.trim())
        .slice(0, 20)
        .map((line: string) => {
          const [filePath, ...rest] = line.split(':');
          const content = rest.join(':').trim();
          return {
            path: filePath,
            title: 'Deep Scan Result',
            tags: [],
            excerpt: content,
            type: 'deep' as const
          };
        })
        .filter((result) => {
          // Privacy filter: exclude private docs unless explicitly requested (bug B4)
          if (options.includePrivate) return true;
          const doc = this.dbService?.getDocumentByPath(result.path) as any;
          return !doc?.is_private;
        });
    } catch (error: any) {
      if (error.code === 1 || error.status === 1) return [];
      throw error;
    }
  }

  async extract(text: string): Promise<string[]> {
    const mentions = Array.from(text.matchAll(/@(\w+)/g)).map(m => m[1]);
    const tags = Array.from(text.matchAll(/#(\w+)/g)).map(m => m[1]);
    return Array.from(new Set([...mentions, ...tags]));
  }
}

export const intelligenceService = new IntelligenceService();
