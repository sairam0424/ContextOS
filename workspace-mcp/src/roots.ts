import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerRoots(server: McpServer): void {
  try {
    (server.server as any).setRequestHandler('roots/list', async () => ({
      roots: [{
        uri: `file://${process.cwd()}`,
        name: 'ContextOS Workspace',
      }],
    }));
  } catch {
    // Roots may not be supported by this SDK version
  }
}
