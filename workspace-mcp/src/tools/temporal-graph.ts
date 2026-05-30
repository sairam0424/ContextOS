import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSharedDatabase, WorkspaceEventBus, TemporalGraphService } from "@context-os/core";
import { handleToolError } from "../utils.js";

let temporalGraph: TemporalGraphService | null = null;

function getTemporalGraph(): TemporalGraphService {
  if (!temporalGraph) {
    const db = getSharedDatabase();
    const eventBus = new WorkspaceEventBus();
    temporalGraph = new TemporalGraphService(db.getRawDb(), eventBus);
  }
  return temporalGraph;
}

export function registerTemporalGraphTools(server: McpServer): void {
  server.tool(
    "graph_temporal_query",
    {
      nodeId: z.string().optional().describe("Filter to edges touching this node"),
      pointInTime: z.number().optional().describe("Unix ms timestamp for snapshot"),
      rangeStart: z.number().optional().describe("Interval start (unix ms)"),
      rangeEnd: z.number().optional().describe("Interval end (unix ms)"),
      minConfidence: z.number().min(0).max(1).default(0.1),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async ({ nodeId, pointInTime, rangeStart, rangeEnd, minConfidence, limit }) => {
      try {
        const graph = getTemporalGraph();
        let edges;

        if (pointInTime !== undefined) {
          edges = await graph.getEdgesAtTime(pointInTime, { nodeId, minConfidence, limit });
        } else if (rangeStart !== undefined && rangeEnd !== undefined) {
          edges = await graph.getEdgesInRange(rangeStart, rangeEnd, { nodeId });
        } else {
          edges = await graph.getEdgesAtTime(Date.now(), { nodeId, minConfidence, limit });
        }

        const result = edges.map((edge) => ({
          ...edge,
          effectiveWeight: graph.getEffectiveWeight(edge),
        }));

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "graph_temporal_query");
      }
    },
  );

  server.tool(
    "graph_time_travel",
    {
      timestamp: z.number().describe("Unix ms timestamp to view graph state"),
      limit: z.number().int().default(100),
    },
    async ({ timestamp, limit }) => {
      try {
        const graph = getTemporalGraph();
        const edges = await graph.getEdgesAtTime(timestamp, { limit });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(edges) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "graph_time_travel");
      }
    },
  );

  server.tool(
    "graph_impact_predict",
    {
      nodeId: z.string().describe("Node to predict impact for"),
      depth: z.number().int().min(1).max(5).default(2),
    },
    async ({ nodeId, depth }) => {
      try {
        const graph = getTemporalGraph();
        const impact = await graph.predictImpact(nodeId, depth);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(impact) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "graph_impact_predict");
      }
    },
  );
}
