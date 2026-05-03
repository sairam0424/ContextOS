#!/usr/bin/env node
/**
 * ContextOS MCP — HTTP/SSE Transport
 *
 * Starts an HTTP server that accepts MCP connections via Streamable HTTP.
 * Run alongside the stdio server for web-native agent clients.
 *
 * Port: MCP_HTTP_PORT env var, default 3001.
 * Auth: set MCP_AUTH_REQUIRED=true + MCP_AUTH_TOKEN=<secret> to enforce bearer token.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

const PORT = parseInt(process.env.MCP_HTTP_PORT ?? "3001", 10);
const AUTH_REQUIRED = process.env.MCP_AUTH_REQUIRED === "true";
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function checkAuth(req: http.IncomingMessage): boolean {
  if (!AUTH_REQUIRED) return true;
  if (!AUTH_TOKEN) {
    console.error("[MCP-HTTP] MCP_AUTH_REQUIRED=true but MCP_AUTH_TOKEN is not set — rejecting all requests.");
    return false;
  }
  const authHeader = req.headers["authorization"] ?? "";
  return authHeader === `Bearer ${AUTH_TOKEN}`;
}

async function main() {
  const { default: pkg } = await import("../package.json", { with: { type: "json" } });

  // One transport instance handles all sessions (stateful session mode)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = await createMcpServer(pkg.version);
  await server.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    // Auth gate
    if (!checkAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Unauthorized" }));
    }

    // CORS — allow any origin for tool clients (narrow in production via reverse proxy)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    // Health endpoint for deploy checks
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", version: pkg.version, transport: "http" }));
    }

    // Route all MCP traffic to the transport
    if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
      try {
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error("[MCP-HTTP] Transport error:", err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      }
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  httpServer.listen(PORT, () => {
    console.error(`[MCP-HTTP] ContextOS MCP HTTP server listening on port ${PORT}`);
    console.error(`[MCP-HTTP] Endpoint: http://localhost:${PORT}/mcp`);
    console.error(`[MCP-HTTP] Auth: ${AUTH_REQUIRED ? "ENABLED" : "disabled (set MCP_AUTH_REQUIRED=true to enable)"}`);
    console.error(`[MCP-HTTP] Version: ${pkg.version}`);
  });
}

main().catch((err) => {
  console.error("[MCP-HTTP] Fatal error:", err);
  process.exit(1);
});
