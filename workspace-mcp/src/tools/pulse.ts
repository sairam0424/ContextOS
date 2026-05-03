import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { samplingService } from "@context-os/core";
import { handleToolError } from "../utils.js";

export function registerPulseTool(server: McpServer) {
  server.tool(
    "workspace_pulse",
    {},
    async () => {
      try {
        const pulse = await samplingService.getPulse();
        const lines = [
          `Workspace Health: ${pulse.healthScore}%`,
          `Top Tags: ${pulse.topTags.length > 0 ? pulse.topTags.map(t => `#${t}`).join(', ') : 'none'}`,
          `Intelligence Queue — Pending: ${pulse.intelligenceStatus.pending} | Processing: ${pulse.intelligenceStatus.processing} | Ready: ${pulse.intelligenceStatus.ready}`,
          `Recent Changes: ${pulse.recentChanges.length > 0 ? '\n' + pulse.recentChanges.map(c => `  - ${c}`).join('\n') : 'none'}`,
        ];
        return { content: [{ type: "text" as const, text: lines.join('\n') }] };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
