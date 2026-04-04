import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { validatePath, gitCommit, handleToolError } from "../utils.js";

export function registerDailyTool(server: McpServer) {
  server.tool(
    "workspace_daily_update",
    {
      content: z.string().describe("Content to append to today's daily log")
    },
    async ({ content }) => {
      try {
        const { fullPath: dailyDir } = validatePath("daily", "root");
        const date = new Date().toISOString().split("T")[0];
        const dailyLogPath = path.join(dailyDir, `${date}.md`);
        
        // Ensure daily directory exists
        await fs.mkdir(dailyDir, { recursive: true });

        const timestamp = new Date().toLocaleTimeString();
        const entry = `\n### [${timestamp}]\n\n${content}\n`;
        
        await fs.appendFile(dailyLogPath, entry, "utf-8");
        await gitCommit(dailyLogPath, `feat(mcp): daily log entry for ${date}`);

        return {
          content: [{ type: "text" as const, text: `Updated today's daily log: ${date}.md` }]
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
