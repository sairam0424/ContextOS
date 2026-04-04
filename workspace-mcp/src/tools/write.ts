import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import { validatePath, gitCommit, handleToolError } from "../utils.js";

export function registerWriteTool(server: McpServer) {
  server.tool(
    "workspace_write",
    {
      path: z.string().describe("Relative path to the file"),
      content: z.string().describe("Content to write"),
      mode: z.enum(["append", "replace"]).describe("Write mode")
    },
    async ({ path: filePath, content, mode }) => {
      try {
        const { fullPath, relativePath } = validatePath(filePath);

        // Prevent root file overwrites unless specified
        if (filePath.startsWith("root/") && mode === "replace") {
          throw new Error(`Root files are read-only for replacement. Use append or update project-level files instead.`);
        }

        if (mode === "append") {
          await fs.appendFile(fullPath, "\n" + content, "utf-8");
        } else {
          await fs.writeFile(fullPath, content, "utf-8");
        }

        // Secure auto-commit via GitQueue
        await gitCommit(fullPath, `chore(mcp): update ${relativePath}`);

        return {
          content: [{ type: "text" as const, text: `Successfully ${mode}d to ${filePath}` }]
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
