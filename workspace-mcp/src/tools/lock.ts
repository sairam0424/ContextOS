import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lockingService } from "@context-os/core";
import { handleToolError } from "../utils.js";

export function registerLockTools(server: McpServer) {
  server.tool(
    "workspace_lock_acquire",
    {
      filePath: z.string().describe("Relative path of the file to lock"),
      agentId: z.string().describe("Identifier of the requesting agent")
    },
    async ({ filePath, agentId }) => {
      try {
        const acquired = await lockingService.acquire(filePath, agentId);
        if (acquired) {
          return { content: [{ type: "text" as const, text: `Lock acquired: ${filePath} (agent: ${agentId})` }] };
        }
        const { agentId: holder } = lockingService.isLocked(filePath);
        return { content: [{ type: "text" as const, text: `Lock denied: ${filePath} is held by agent '${holder}'` }] };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );

  server.tool(
    "workspace_lock_release",
    {
      filePath: z.string().describe("Relative path of the file to unlock"),
      agentId: z.string().describe("Identifier of the releasing agent")
    },
    async ({ filePath, agentId }) => {
      try {
        const lockStatus = lockingService.isLocked(filePath);
        if (!lockStatus.locked) {
          return {
            content: [{ type: "text" as const, text: `Cannot release lock: ${filePath} is not locked` }],
            isError: true
          };
        }
        if (lockStatus.agentId !== agentId) {
          return {
            content: [{ type: "text" as const, text: `Cannot release lock: ${filePath} is held by agent '${lockStatus.agentId}', not '${agentId}'` }],
            isError: true
          };
        }
        await lockingService.release(filePath, agentId);
        return { content: [{ type: "text" as const, text: `Lock released: ${filePath}` }] };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );

  server.tool(
    "workspace_lock_status",
    {
      filePath: z.string().describe("Relative path to check lock status")
    },
    async ({ filePath }) => {
      try {
        const { locked, agentId } = lockingService.isLocked(filePath);
        const text = locked
          ? `Locked: ${filePath} (held by '${agentId}')`
          : `Unlocked: ${filePath}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
