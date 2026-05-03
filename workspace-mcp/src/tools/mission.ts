import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { missionService } from "@context-os/core";
import { handleToolError } from "../utils.js";

export function registerMissionTool(server: McpServer) {
  server.tool(
    "workspace_mission",
    {
      action: z.enum(["create", "list", "complete", "archive", "activate"]).describe("Mission action"),
      title: z.string().optional().describe("Mission title (required for create)"),
      path: z.string().optional().describe("Mission path (required for complete/archive/activate)"),
      priority: z.number().min(1).max(5).optional().describe("Priority 1-5 (for create)"),
      status: z.enum(["active", "completed", "paused", "archived"]).optional().describe("Filter by status (for list)")
    },
    async ({ action, title, path, priority, status }) => {
      try {
        switch (action) {
          case "create": {
            if (!title) return { content: [{ type: "text" as const, text: "Error: title is required for create" }] };
            const m = missionService.create(title, { priority });
            return { content: [{ type: "text" as const, text: `Mission created:\n  Title: ${m.title}\n  Path: ${m.path}\n  Priority: ${m.priority}` }] };
          }
          case "list": {
            const missions = missionService.list(status);
            if (missions.length === 0) return { content: [{ type: "text" as const, text: "No missions found." }] };
            const formatted = missions.map(m => `[${m.status}] ${m.title} (priority: ${m.priority})\n  ${m.path}`).join('\n');
            return { content: [{ type: "text" as const, text: formatted }] };
          }
          case "complete":
          case "archive":
          case "activate": {
            if (!path) return { content: [{ type: "text" as const, text: `Error: path is required for ${action}` }] };
            missionService[action](path);
            return { content: [{ type: "text" as const, text: `Mission ${action}d: ${path}` }] };
          }
        }
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
