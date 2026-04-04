import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { validatePath, handleToolError } from "../utils.js";

export function registerContextTool(server: McpServer) {
  server.tool(
    "workspace_context",
    {
      project: z.string().describe("The project name (e.g., ContextOS)")
    },
    async ({ project }) => {
      try {
        const { fullPath: projectDir } = validatePath(`projects/${project}`);
        const filesToLoad = ["CONTEXT.md", "memory.md", "decisions.md", "tasks/active.md"];
        let content = `# Context for Project: ${project}\n\n`;

        for (const file of filesToLoad) {
          const filePath = path.join(projectDir, file);
          try {
            const data = await fs.readFile(filePath, "utf-8");
            content += `## ${file}\n\n${data}\n---\n\n`;
          } catch (fileError) {
            content += `## ${file}\n\n(File not found)\n---\n\n`;
          }
        }

        return {
          content: [{ type: "text" as const, text: content }]
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
