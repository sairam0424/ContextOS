import { exec } from "child_process";
import { promisify } from "util";
import MiniSearch from "minisearch";
import { globalIndexer, IndexRecord } from "../indexer.js";
import { getWorkspaceRoot } from "../context.js";

const execAsync = promisify(exec);

export interface SearchResult {
  path: string;
  title: string;
  tags: string[];
  excerpt: string;
  score?: number;
  type: 'index' | 'deep';
}

export class IntelligenceService {
  private miniSearch: MiniSearch<IndexRecord> | null = null;

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

    this.miniSearch.addAll(indexData.records.map((r, i) => ({ ...r, id: i })));
    return this.miniSearch;
  }

  /**
   * Hybrid Search: Semantic-Lite Index (MiniSearch) -> Grep Fallback
   */
  async search(query: string, options: { deep?: boolean } = {}): Promise<SearchResult[]> {
    // 1. Try MiniSearch Index First (Semantic-Lite)
    if (!options.deep) {
      const ms = await this.getIndex();
      const results = ms.search(query);
      
      if (results.length > 0) {
        return results.map(res => ({
          path: res.path,
          title: res.title,
          tags: res.tags,
          excerpt: res.excerpt,
          score: res.score,
          type: 'index'
        }));
      }
    }

    // 2. Fallback to Deep Scan (Grep)
    const workspaceRoot = getWorkspaceRoot();
    // Use -I to skip binaries, and limit line length to avoid buffer overflow
    const command = `grep -rnIE "${query}" . | head -n 20`;
    
    try {
      const { stdout } = await execAsync(command, { 
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
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
      if (error.code === 1) return []; // No results
      throw error;
    }
  }

  async extract(text: string): Promise<string[]> {
    // Phase 2: Entity extraction from raw text for relationship mapping
    const mentions = Array.from(text.matchAll(/@(\w+)/g)).map(m => m[1]);
    const tags = Array.from(text.matchAll(/#(\w+)/g)).map(m => m[1]);
    return Array.from(new Set([...mentions, ...tags]));
  }
}

export const intelligenceService = new IntelligenceService();
