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
import { registerGraphQueryTool } from "./tools/graph-query.js";
import { registerWorkspaceNotifyTool } from "./tools/workspace-notify.js";
import { registerCognitiveTools } from "./tools/cognitive.js";
import { registerTemporalGraphTools } from "./tools/temporal-graph.js";
import { registerSwarmTools } from "./tools/swarm.js";
import { registerGovernanceTools } from "./tools/governance.js";
import { registerIntelligenceStreamTools } from "./tools/intelligence-stream.js";
import { registerPredictiveTools } from "./tools/predictive.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts/index.js";
import { setLoggingServer } from "./logging.js";
import { subscriptionManager } from "./subscriptions.js";
import { registerRoots } from "./roots.js";

export async function createMcpServer(version: string): Promise<McpServer> {
  const server = new McpServer({
    name: "workspace-mcp",
    version,
  });

  // Structured logging
  setLoggingServer(server);

  // Resource subscriptions
  subscriptionManager.setServer(server);

  // Tools
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
  registerGraphQueryTool(server);
  registerWorkspaceNotifyTool(server);
  registerCognitiveTools(server);
  registerTemporalGraphTools(server);
  registerSwarmTools(server);
  registerGovernanceTools(server);
  registerIntelligenceStreamTools(server);
  registerPredictiveTools(server);

  // Resources
  registerResources(server);

  // Prompts
  registerPrompts(server);

  // Roots
  registerRoots(server);

  return server;
}
