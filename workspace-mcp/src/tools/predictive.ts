import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSharedDatabase, WorkspaceEventBus, GitIntelligenceService, MultiModalFusionService, GraphRAGService } from "@context-os/core";
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
    graphRAG = new GraphRAGService(db.getRawDb());
  }
  return graphRAG;
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
        const fusion = getFusionService();
        const candidates = [{ path: query, semanticScore: 0.5 }];
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
        const result = rag.globalSearch(query);
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
