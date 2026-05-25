import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleToolError } from '../utils.js';

export function registerGraphQueryTool(server: McpServer): void {
  server.tool(
    'graph_query',
    {
      startNode: z.string().describe('Node ID or path to start traversal from'),
      direction: z.enum(['outbound', 'inbound', 'both']).default('both'),
      maxDepth: z.number().min(1).max(5).default(2),
      minWeight: z.number().min(0).max(1).default(0.1),
      limit: z.number().min(1).max(100).default(20),
    },
    async ({ startNode, direction, maxDepth, minWeight, limit }) => {
      try {
        const result = {
          startNode,
          direction,
          maxDepth,
          minWeight,
          limit,
          results: [],
          metadata: {
            queryTime: new Date().toISOString(),
            nodesTraversed: 0,
            edgesFound: 0,
          },
        };
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    }
  );
}
