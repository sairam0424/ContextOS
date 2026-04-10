import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { samplingService } from "@context-os/core";
import { handleToolError } from "../utils.js";

export function registerSamplingTool(server: McpServer) {
  server.tool(
    "workspace_sample",
    {},
    async () => {
      try {
        const pulse = await samplingService.getPulse();
        
        const summary = [
          "### Workspace Pulse Snapshot ###",
          `Overall Health Score: ${pulse.healthScore}%`,
          `Top Trends: ${pulse.topTags.join(", ")}`,
          `Recent Activity:`,
          ...pulse.recentChanges.map((path: string) => `- ${path}`),
          "",
          "Use the `workspace_search` tool for deep context on these areas."
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: summary }],
          isError: false as const
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
