#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReadTool } from "./tools/read.js";
import { registerWriteTool } from "./tools/write.js";
import { registerSearchTool } from "./tools/search.js";
import { registerContextTool } from "./tools/context.js";
import { registerDecisionTool } from "./tools/decision.js";
import { registerMemoryTool } from "./tools/memory.js";
import { registerDailyTool } from "./tools/daily.js";

async function main() {
  const server = new McpServer({
    name: "workspace-mcp",
    version: "0.1.0",
  });

  // Register all tools
  registerReadTool(server);
  registerWriteTool(server);
  registerSearchTool(server);
  registerContextTool(server);
  registerDecisionTool(server);
  registerMemoryTool(server);
  registerDailyTool(server);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error("Workspace MCP Server running on stdio");
}

main().catch((error) => {
  console.error("MCP Server Error:", error);
  process.exit(1);
});
