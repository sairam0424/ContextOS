import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleToolError, sanitizeUntrustedContent } from '../utils.js';
import { knowledgeGraphService, GraphNode, GraphEdge } from '@context-os/core';

interface TraversalResult {
  node: GraphNode;
  depth: number;
  path: string[];
}

function traverseGraph(
  startNode: string,
  direction: 'outbound' | 'inbound' | 'both',
  maxDepth: number,
  minWeight: number,
  limit: number,
  nodes: GraphNode[],
  edges: GraphEdge[]
): { results: TraversalResult[]; nodesTraversed: number; edgesFound: number } {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set<string>();
  const results: TraversalResult[] = [];
  const queue: Array<{ id: string; depth: number; path: string[] }> = [
    { id: startNode, depth: 0, path: [startNode] }
  ];

  let nodesTraversed = 0;
  let edgesFound = 0;

  while (queue.length > 0 && results.length < limit) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    nodesTraversed++;

    const node = nodeMap.get(current.id);
    if (node && current.depth > 0) {
      results.push({ node, depth: current.depth, path: current.path });
    }

    if (current.depth >= maxDepth) continue;

    for (const edge of edges) {
      if (edge.weight < minWeight) continue;

      let neighborId: string | null = null;
      if ((direction === 'outbound' || direction === 'both') && edge.source === current.id) {
        neighborId = edge.target;
      } else if ((direction === 'inbound' || direction === 'both') && edge.target === current.id) {
        neighborId = edge.source;
      }

      if (neighborId && !visited.has(neighborId)) {
        edgesFound++;
        queue.push({
          id: neighborId,
          depth: current.depth + 1,
          path: [...current.path, neighborId]
        });
      }
    }
  }

  return { results, nodesTraversed, edgesFound };
}

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
        const graph = await knowledgeGraphService.getGraph();

        if (graph.nodes.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                startNode,
                direction,
                maxDepth,
                minWeight,
                limit,
                results: [],
                note: 'Graph query requires indexed workspace. Run context-os sync first.',
              }, null, 2),
            }],
          };
        }

        const { results, nodesTraversed, edgesFound } = traverseGraph(
          startNode, direction, maxDepth, minWeight, limit,
          graph.nodes, graph.edges
        );

        const result = {
          startNode,
          direction,
          maxDepth,
          minWeight,
          limit,
          results: results.map(r => ({
            id: r.node.id,
            label: r.node.label,
            type: r.node.type,
            depth: r.depth,
            path: r.path,
            metadata: r.node.metadata,
          })),
          metadata: {
            queryTime: new Date().toISOString(),
            nodesTraversed,
            edgesFound,
            totalGraphNodes: graph.nodes.length,
            totalGraphEdges: graph.edges.length,
          },
        };

        // Node labels/metadata derive from indexed workspace content — quarantine.
        return {
          content: [{
            type: 'text' as const,
            text: sanitizeUntrustedContent(JSON.stringify(result, null, 2), `graph:${startNode}`),
          }],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    }
  );
}
