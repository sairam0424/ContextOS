#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main() {
  const { default: pkg } = await import("../package.json", { with: { type: "json" } });
  const server = await createMcpServer(pkg.version);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Workspace MCP Server running on stdio");
}

main().catch((error) => {
  console.error("MCP Server Error:", error);
  process.exit(1);
});
