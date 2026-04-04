import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { validatePath, handleToolError } from "../utils.js";

const execFileAsync = promisify(execFile);

export function registerSearchTool(server: McpServer) {
  server.tool(
    "workspace_search",
    {
      query: z.string().describe("Search query string"),
      scope: z.string().optional().describe("Search scope (e.g., projects, knowledge, or specific project name)")
    },
    async ({ query, scope }) => {
      try {
        const target = scope === "root" ? "." : scope || "projects";
        const { fullPath: baseDir } = validatePath(target);

        // Use grep -rnI via execFile (no shell interpolation)
        const { stdout } = await execFileAsync("grep", ["-rnIE", query, "."], { cwd: baseDir });

        const results = stdout.split("\n").slice(0, 50).join("\n");
        return {
          content: [{ type: "text" as const, text: results || "No results found." }]
        };
      } catch (error: any) {
        // If grep fails (no results), return a friendly message
        if (error.code === 1) {
            return {
                content: [{ type: "text" as const, text: "No results found." }]
            };
        }
        return handleToolError(error);
      }
    }
  );
}
