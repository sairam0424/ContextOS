import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { intelligenceService } from "@context-os/core";
import { handleToolError } from "../utils.js";

export function registerSearchTool(server: McpServer) {
  server.tool(
    "workspace_search",
    {
      query: z.string().describe("Search query string"),
      deep: z.boolean().optional().describe("Force deep scan using grep")
    },
    async ({ query, deep }) => {
      try {
        const results = await intelligenceService.search(query, { deep });

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No results found." }],
          };
        }

        const formattedResults = results.map(res => {
          const typeTag = res.type === 'index' ? '[Index]' : '[Deep]';
          let output = `${typeTag} ${res.path}\n`;
          if (res.title && res.title !== 'Deep Scan Result') {
            output += `Title: ${res.title} ${res.tags.length ? `[${res.tags.join(', ')}]` : ''}\n`;
          }
          output += `Excerpt: ${res.excerpt}\n`;
          output += `---`;
          return output;
        }).join('\n');

        return {
          content: [{ type: "text" as const, text: formattedResults }],
          isError: false as const
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
