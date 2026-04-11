import { exec } from "child_process";
import { promisify } from "util";
import MiniSearch from "minisearch";
import { globalIndexer, IndexRecord } from "../indexer.js";
import { getWorkspaceRoot } from "../context.js";
import { DatabaseService } from "./database.js";
import { EmbeddingService } from "./embedding.js";

const execAsync = promisify(exec);

export interface SearchResult {
  path: string;
  title: string;
  tags: string[];
  excerpt: string;
  score?: number;
  type: 'index' | 'deep' | 'semantic' | 'hybrid';
}

export class IntelligenceService {
  private miniSearch: MiniSearch<IndexRecord> | null = null;
  private dbService: DatabaseService | null = null;
  private embeddingService: EmbeddingService | null = null;

  private async getIndex() {
    if (this.miniSearch) return this.miniSearch;

    const indexData = await globalIndexer.reindex();
    this.miniSearch = new MiniSearch({
      fields: ['title', 'tags', 'excerpt', 'content', 'path'],
      storeFields: ['path', 'title', 'tags', 'excerpt'],
      searchOptions: {
        boost: { title: 2, tags: 1.5 },
        fuzzy: 0.2,
        prefix: true
      }
    });

    this.miniSearch.addAll(indexData.records.map((r: IndexRecord, i: number) => ({ ...r, id: i })));
    return this.miniSearch;
  }

  /**
   * Hybrid Search: Semantic (sqlite-vec) + Keyword (FTS5) -> Lite Index (MiniSearch) -> Grep Fallback
   */
  async search(query: string, options: { deep?: boolean } = {}): Promise<SearchResult[]> {
    // 1. Try Elite Hybrid Search First (SQLite-Vec + FTS5)
    if (!options.deep) {
      if (!this.dbService) this.dbService = new DatabaseService(getWorkspaceRoot());
      if (!this.embeddingService) this.embeddingService = new EmbeddingService(process.env.GEMINI_API_KEY);

      try {
        const queryEmbedding = await this.embeddingService.generate(query);
        const { semanticResults, keywordResults } = this.dbService.searchHybrid(queryEmbedding, query);

        const results: SearchResult[] = [];
        const seenPaths = new Set<string>();

        // Add Semantic Results
        semanticResults.forEach((res: any) => {
          results.push({
            path: res.path,
            title: res.title,
            tags: [],
            excerpt: res.excerpt,
            score: 1 - res.distance,
            type: 'semantic'
          });
          seenPaths.add(res.path);
        });

        // Add Keyword Results (if not already seen)
        keywordResults.forEach((res: any) => {
          if (!seenPaths.has(res.path)) {
            results.push({
              path: res.path,
              title: res.title,
              tags: [],
              excerpt: res.excerpt,
              score: res.fts_score,
              type: 'index'
            });
          }
        });

        if (results.length > 0) return results;
      } catch (err) {
        console.error("[IntelligenceService] Hybrid search failed, falling back to Lite:", err);
      }

      // 2. Fallback to Lite Index (MiniSearch)
      const ms = await this.getIndex();
      const msResults = ms.search(query);
      
      if (msResults.length > 0) {
        return msResults.map(res => ({
          path: res.path,
          title: res.title,
          tags: res.tags,
          excerpt: res.excerpt,
          score: res.score,
          type: 'index'
        }));
      }
    }

    // 3. Fallback to Deep Scan (Grep)
    const workspaceRoot = getWorkspaceRoot();
    const command = `grep -rnIE "${query}" . | head -n 20`;
    
    try {
      const { stdout } = await execAsync(command, { 
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024 
      });
      if (!stdout) return [];

      return stdout.split('\n')
        .filter((line: string) => line.trim())
        .map((line: string) => {
          const [filePath, ...rest] = line.split(':');
          const content = rest.join(':').trim();
          return {
            path: filePath,
            title: 'Deep Scan Result',
            tags: [],
            excerpt: content,
            type: 'deep'
          };
        });
    } catch (error: any) {
      if (error.code === 1) return []; 
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
