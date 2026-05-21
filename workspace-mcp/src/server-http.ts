#!/usr/bin/env node
/**
 * ContextOS MCP — HTTP/SSE Transport
 *
 * Starts an HTTP server that accepts MCP connections via Streamable HTTP.
 * Run alongside the stdio server for web-native agent clients.
 *
 * Port: MCP_HTTP_PORT env var, default 3001.
 * Auth: enabled by default. Set MCP_AUTH_TOKEN=<secret> (required).
 *       Set MCP_AUTH_REQUIRED=false to explicitly disable (not recommended).
 * CORS: set MCP_CORS_ORIGINS=https://example.com,https://app.example.com
 *       Default is empty (reject all cross-origin requests).
 * Rate limits: 100 req/min authenticated, 5 req/min unauthenticated.
 * Body limit: 1MB max request body size.
 * Timeout: 30s request timeout.
 */
import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

/* ─── Configuration ─────────────────────────────────────────────────── */

const PORT = parseInt(process.env.MCP_HTTP_PORT ?? "3001", 10);
const AUTH_REQUIRED = process.env.MCP_AUTH_REQUIRED !== "false"; // default ON
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const MAX_BODY_BYTES = 1_048_576; // 1MB
const REQUEST_TIMEOUT_MS = 30_000; // 30s

// CORS origin allowlist (comma-separated)
const CORS_ORIGINS: ReadonlyArray<string> = process.env.MCP_CORS_ORIGINS
  ? process.env.MCP_CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

/* ─── Rate Limiter (in-memory sliding window) ───────────────────────── */

interface RateEntry {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateEntry>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_AUTHENTICATED = 100;
const RATE_LIMIT_UNAUTHENTICATED = 5;

function cleanupRateLimiter(): void {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (entry.timestamps.length === 0) {
      rateLimitMap.delete(ip);
    }
  }
}

// Periodic cleanup every 60s to prevent memory growth
const rateLimitCleanupInterval = setInterval(cleanupRateLimiter, 60_000);
rateLimitCleanupInterval.unref();

function isRateLimited(ip: string, isAuthenticated: boolean): boolean {
  const now = Date.now();
  const limit = isAuthenticated ? RATE_LIMIT_AUTHENTICATED : RATE_LIMIT_UNAUTHENTICATED;

  let entry = rateLimitMap.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitMap.set(ip, entry);
  }

  // Slide window: remove timestamps older than 1 minute
  entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (entry.timestamps.length >= limit) {
    return true;
  }

  entry.timestamps.push(now);
  return false;
}

/* ─── Auth ──────────────────────────────────────────────────────────── */

function timingSafeCompare(a: string, b: string): boolean {
  // timingSafeEqual requires equal-length buffers.
  // Encode both to buffers; if lengths differ, compare against a
  // same-length dummy to avoid leaking length info via timing.
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");

  if (bufA.length !== bufB.length) {
    // Compare bufA against itself to consume constant time, then return false.
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

function checkAuth(req: http.IncomingMessage): boolean {
  if (!AUTH_REQUIRED) return true;
  // AUTH_TOKEN is guaranteed non-empty at this point (startup validation)
  const authHeader = req.headers["authorization"] ?? "";
  return timingSafeCompare(authHeader, `Bearer ${AUTH_TOKEN}`);
}

/* ─── CORS ──────────────────────────────────────────────────────────── */

function getCorsOrigin(req: http.IncomingMessage): string | null {
  const origin = req.headers["origin"];
  if (!origin) return null;
  if (CORS_ORIGINS.length === 0) return null; // no origins allowed
  if (CORS_ORIGINS.includes(origin)) return origin;
  return null;
}

function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
}

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  const allowedOrigin = getCorsOrigin(req);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

function getClientIp(req: http.IncomingMessage): string {
  // Respect X-Forwarded-For only if behind a trusted proxy; default to socket address
  return (req.socket.remoteAddress ?? "unknown");
}

/* ─── Main ──────────────────────────────────────────────────────────── */

async function main() {
  // ──── Startup validation: fail-closed if auth is required but token missing ────
  if (AUTH_REQUIRED && !AUTH_TOKEN) {
    console.error("[MCP-HTTP] FATAL: MCP_AUTH_REQUIRED is enabled (default) but MCP_AUTH_TOKEN is not set.");
    console.error("[MCP-HTTP] Set MCP_AUTH_TOKEN=<secret> or explicitly set MCP_AUTH_REQUIRED=false to disable auth.");
    process.exit(1);
  }

  const { default: pkg } = await import("../package.json", { with: { type: "json" } });

  // One transport instance handles all sessions (stateful session mode)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = await createMcpServer(pkg.version);
  await server.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    // Apply security headers to ALL responses
    setSecurityHeaders(res);

    const clientIp = getClientIp(req);

    // CORS headers (validated against allowlist)
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      // Preflight — only respond if origin is allowed
      const allowedOrigin = getCorsOrigin(req);
      if (!allowedOrigin && req.headers["origin"]) {
        res.writeHead(403);
        return res.end();
      }
      res.writeHead(204);
      return res.end();
    }

    // Auth gate
    const isAuthenticated = checkAuth(req);

    // Rate limiting (applied before auth rejection to catch brute-force)
    if (isRateLimited(clientIp, isAuthenticated)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Too many requests" }));
    }

    if (!isAuthenticated) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Unauthorized" }));
    }

    // Request body size check (Content-Length based)
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      res.writeHead(413, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Request body too large" }));
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
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
      }
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  // Request timeout: 30s
  httpServer.timeout = REQUEST_TIMEOUT_MS;

  // Max request body size enforcement at socket level
  httpServer.on("connection", (socket) => {
    let received = 0;
    socket.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES * 2) {
        // Allow some overhead for headers, but kill connections sending far too much data
        socket.destroy();
      }
    });
  });

  httpServer.listen(PORT, () => {
    console.error(`[MCP-HTTP] ContextOS MCP HTTP server listening on port ${PORT}`);
    console.error(`[MCP-HTTP] Endpoint: http://localhost:${PORT}/mcp`);
    console.error(`[MCP-HTTP] Auth: ${AUTH_REQUIRED ? "ENABLED" : "DISABLED (not recommended)"}`);
    console.error(`[MCP-HTTP] CORS origins: ${CORS_ORIGINS.length > 0 ? CORS_ORIGINS.join(", ") : "(none — cross-origin blocked)"}`);
    console.error(`[MCP-HTTP] Rate limits: ${RATE_LIMIT_AUTHENTICATED} req/min (auth), ${RATE_LIMIT_UNAUTHENTICATED} req/min (unauth)`);
    console.error(`[MCP-HTTP] Body limit: ${MAX_BODY_BYTES} bytes | Timeout: ${REQUEST_TIMEOUT_MS}ms`);
    console.error(`[MCP-HTTP] Version: ${pkg.version}`);
  });

  /* ─── Graceful Shutdown ─────────────────────────────────────────── */

  function shutdown(signal: string): void {
    console.error(`[MCP-HTTP] Received ${signal}, shutting down gracefully...`);
    httpServer.close(() => {
      console.error("[MCP-HTTP] HTTP server closed.");
      clearInterval(rateLimitCleanupInterval);
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      console.error("[MCP-HTTP] Graceful shutdown timed out, forcing exit.");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[MCP-HTTP] Fatal error:", err);
  process.exit(1);
});
