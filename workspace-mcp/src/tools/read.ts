import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import { validatePath, handleToolError, sanitizeUntrustedContent } from "../utils.js";

export function registerReadTool(server: McpServer) {
  server.tool(
    "workspace_read",
    {
      path: z.string().describe("Relative path to the file"),
      scope: z.enum(["root", "org", "project"]).describe("Access scope for protection")
    },
    async ({ path: filePath, scope }) => {
      try {
        const { fullPath } = validatePath(`${scope}/${filePath}`);
        const data = await fs.readFile(fullPath, "utf-8");
        // Quarantine: raw file bytes are untrusted input (OWASP LLM01).
        const safe = sanitizeUntrustedContent(data, `${scope}/${filePath}`);
        return {
          content: [{ type: "text" as const, text: safe }],
          isError: false as const
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
