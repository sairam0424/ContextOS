import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

let serverRef: McpServer | null = null;

export function setLoggingServer(server: McpServer): void {
  serverRef = server;
}

export function logToClient(
  level: 'debug' | 'info' | 'warning' | 'error',
  data: string | Record<string, unknown>
): void {
  if (!serverRef) return;
  try {
    serverRef.server.sendLoggingMessage({ level, data });
  } catch {
    /* client may not support logging notifications */
  }
}
