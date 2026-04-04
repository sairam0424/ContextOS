import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import { validatePath, gitCommit, handleToolError } from "../utils.js";

export function registerMemoryTool(server: McpServer) {
  server.tool(
    "workspace_memory_update",
    {
      project: z.string().describe("Project name"),
      content: z.string().describe("Updated memory content (Markdown format)")
    },
    async ({ project, content }) => {
      try {
        const { fullPath: memoryPath } = validatePath(`projects/${project}/memory.md`);
        const date = new Date().toISOString().split("T")[0];
        
        const fullMemoryContent = `# Project Memory: ${project}\n\nLast Updated: ${date}\n\n${content}\n`;
        await fs.writeFile(memoryPath, fullMemoryContent, "utf-8");

        await gitCommit(memoryPath, `feat(mcp): update context memory for ${project}`);

        return {
          content: [{ type: "text" as const, text: `Updated memory for ${project}` }],
          isError: false as const
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
