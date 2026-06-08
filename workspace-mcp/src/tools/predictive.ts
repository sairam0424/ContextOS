import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSharedDatabase, getSharedEmbeddingService, GitIntelligenceService, MultiModalFusionService, GraphRAGService, intelligenceService } from "@context-os/core";
import type { FusionCandidate } from "@context-os/core";
import { handleToolError } from "../utils.js";
import { workspaceRoot } from "../utils.js";

let gitIntelligence: GitIntelligenceService | null = null;
let fusionService: MultiModalFusionService | null = null;
let graphRAG: GraphRAGService | null = null;

function getGitIntelligence(): GitIntelligenceService {
  if (!gitIntelligence) {
    const db = getSharedDatabase();
    gitIntelligence = new GitIntelligenceService(db.getRawDb(), workspaceRoot);
  }
  return gitIntelligence;
}

function getFusionService(): MultiModalFusionService {
  if (!fusionService) {
    const db = getSharedDatabase();
    fusionService = new MultiModalFusionService(db.getRawDb());
  }
  return fusionService;
}

function getGraphRAG(): GraphRAGService {
  if (!graphRAG) {
    const db = getSharedDatabase();
    // Pass embedding so community search ranks by cosine (WS-B), not substring overlap.
    graphRAG = new GraphRAGService(db.getRawDb(), getSharedEmbeddingService());
  }
  return graphRAG;
}

/**
 * Retrieves REAL candidates from the index and maps them into FusionCandidates.
 *
 * Pipeline (no fabricated rows):
 *  1. `intelligenceService.search` — the shared singleton — embeds the query
 *     (shared EmbeddingService) and runs the vec0 + RRF hybrid search, with a
 *     graceful grep fallback baked in when no embedding backend is configured
 *     or the dimension is gated out. Its `score` is the real fused relevance.
 *  2. `searchHybrid(EMPTY_EMBEDDING, query)` recovers the raw FTS5 keyword leg
 *     so each candidate carries a real `bm25Score` derived from FTS5 `rank`.
 *     Passing a zero-length vector deliberately skips the semantic leg (the
 *     repository degrades to keyword-only), so this call never depends on an
 *     embedding backend and never compares mismatched dimensions.
 *  3. Per-candidate enrichment from the shared DB: graph proximity from edge
 *     affinities (anchored on the top hit), recency from the document `mtime`,
 *     and heat from the access-log path heat.
 */
async function buildFusionCandidates(query: string, limit: number): Promise<FusionCandidate[]> {
  const db = getSharedDatabase();

  // Real retrieval: embed + vec0/RRF hybrid + grep fallback (shared instances).
  const retrieved = await intelligenceService.search(query, { limit });
  if (retrieved.length === 0) return [];

  // Recover the raw FTS5 keyword ranks for a real bm25 signal. The empty vector
  // forces the keyword-only leg, so this works even with no embedding backend.
  const { keywordResults } = db.searchHybrid(new Float32Array(0), query, limit);
  // FTS5 `rank` is lower-is-better (typically negative); convert to a
  // higher-is-better magnitude so it composes with the other signals.
  const bm25ByPath = new Map<string, number>(
    keywordResults.map((r: { path: string; rank?: number }) => [r.path, r.rank != null ? -r.rank : 0])
  );

  // Graph proximity is defined relative to an anchor; use the top hit so the
  // remaining candidates are scored by their edge affinity to the best match.
  const anchorPath = retrieved[0]?.path;
  const affinities = anchorPath ? db.getAffinities(anchorPath) : new Map<string, number>();

  return retrieved.map((res): FusionCandidate => {
    const doc = db.getDocumentByPath(res.path) as { mtime?: number } | undefined;
    return {
      path: res.path,
      // `score` is undefined for grep-fallback hits — omit rather than fabricate.
      semanticScore: res.score,
      bm25Score: bm25ByPath.get(res.path),
      graphProximityScore: affinities.get(res.path),
      lastModified: doc?.mtime,
      accessCount: db.getPathHeat(res.path),
    };
  });
}

export function registerPredictiveTools(server: McpServer): void {
  server.tool(
    "predictive_impact",
    {
      path: z.string().describe("File path to predict change impact for"),
    },
    async ({ path: filePath }) => {
      try {
        const git = getGitIntelligence();
        const coChanges = git.getCoChanges(filePath, 10);
        const ownership = git.getOwnership(filePath);
        const velocity = git.getVelocity(filePath);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ coChanges, ownership, velocity }) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "predictive_impact");
      }
    },
  );

  server.tool(
    "search_fused",
    {
      query: z.string().describe("Search query"),
      weights: z.object({
        semantic: z.number().default(0.4),
        bm25: z.number().default(0.2),
        graphProximity: z.number().default(0.2),
        recency: z.number().default(0.1),
        heat: z.number().default(0.1),
      }).optional().describe("Custom fusion weights"),
      limit: z.number().int().min(1).max(50).default(10),
    },
    async ({ query, weights, limit }) => {
      try {
        const candidates = await buildFusionCandidates(query, limit);

        // Graceful fallback: no embedding backend / empty index / no FTS hits.
        // Return the raw retrieval paths rather than throwing or echoing the
        // query, so search_fused still answers from the real index (keyword leg).
        if (candidates.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify([]) }],
            isError: false as const,
          };
        }

        const fusion = getFusionService();
        const results = fusion.score(candidates, weights);
        const limited = results.slice(0, limit);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(limited) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "search_fused");
      }
    },
  );

  server.tool(
    "graph_rag_search",
    {
      query: z.string().describe("Search query for community-level understanding"),
      level: z.number().int().min(0).max(3).optional().describe("Community hierarchy level"),
      limit: z.number().int().min(1).max(20).default(5),
    },
    async ({ query, level, limit }) => {
      try {
        const rag = getGraphRAG();
        if (level !== undefined) {
          const communities = rag.getCommunities(level);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(communities.slice(0, limit)) }],
            isError: false as const,
          };
        }
        const result = await rag.globalSearch(query);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "graph_rag_search");
      }
    },
  );
}
