import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTool } from "./tools/read.js";
import { registerWriteTool } from "./tools/write.js";
import { registerSearchTool } from "./tools/search.js";
import { registerContextTool } from "./tools/context.js";
import { registerDecisionTool } from "./tools/decision.js";
import { registerMemoryTool } from "./tools/memory.js";
import { registerDailyTool } from "./tools/daily.js";
import { registerSamplingTool } from "./tools/sampling.js";
import { registerValidateTool } from "./tools/validate.js";
import { registerLockTools } from "./tools/lock.js";
import { registerPruneTool } from "./tools/prune.js";
import { registerPulseTool } from "./tools/pulse.js";
import { registerMissionTool } from "./tools/mission.js";
import { registerResources } from "./resources.js";

export async function createMcpServer(version: string): Promise<McpServer> {
  const server = new McpServer({
    name: "workspace-mcp",
    version,
  });

  registerReadTool(server);
  registerWriteTool(server);
  registerSearchTool(server);
  registerContextTool(server);
  registerDecisionTool(server);
  registerMemoryTool(server);
  registerDailyTool(server);
  registerSamplingTool(server);
  registerValidateTool(server);
  registerLockTools(server);
  registerPruneTool(server);
  registerPulseTool(server);
  registerMissionTool(server);
  registerResources(server);

  return server;
}
