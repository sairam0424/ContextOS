import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { samplingService, knowledgeGraphService } from "@context-os/core";

export function registerResources(server: McpServer) {
  // 1. Static Resource: Workspace Health Pulse
  server.resource(
    "workspace_health",
    "context://workspace/health",
    async (uri) => {
      const pulse = await samplingService.getPulse();
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(pulse, null, 2),
          mimeType: "application/json"
        }]
      };
    }
  );

  // 2. Resource Template: Project Relationship Graph
  server.resource(
    "project_graph",
    new ResourceTemplate("context://projects/{path}/graph", { list: undefined }),
    async (uri, { path }) => {
      const graph = await knowledgeGraphService.getGraph();
      // Filter graph for specific project context (simplified for now)
      const projectNodes = graph.nodes.filter((n: any) => n.id.includes(path as string));
      const projectEdges = graph.edges.filter((e: any) => e.source.includes(path as string) || e.target.includes(path as string));

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({ nodes: projectNodes, edges: projectEdges }, null, 2),
          mimeType: "application/json"
        }]
      };
    }
  );
}
