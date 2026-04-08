import { exec } from "child_process";
import { promisify } from "util";
import { globalIndexer } from "../indexer.js";
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
  /**
   * Hybrid Search: Metadata Index -> Grep Fallback
   */
  async search(query: string, options: { deep?: boolean } = {}): Promise<SearchResult[]> {
    // 1. Try Metadata Index First
    if (!options.deep) {
      const results = await globalIndexer.search(query);
      if (results.length > 0) {
        return results.map(res => ({
          ...res,
          type: 'index'
        }));
      }
    }

    // 2. Fallback to Deep Scan (Grep)
    const workspaceRoot = getWorkspaceRoot();
    const command = `grep -rnIE "${query}" . | head -n 20`;
    
    try {
      const { stdout } = await execAsync(command, { cwd: workspaceRoot });
      if (!stdout) return [];

      // Parse grep output: file:line:content
      return stdout.split('\n')
        .filter(line => line.trim())
        .map(line => {
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
    // Shared extraction logic could go here later (v2.0)
    return [];
  }
}

export const intelligenceService = new IntelligenceService();
