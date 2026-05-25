import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Creates a progress reporter for long-running tool operations.
 *
 * Usage in a tool handler:
 *   const reporter = createProgressReporter(server, _meta?.progressToken);
 *   reporter.report(1, 10); // 1 of 10
 *   reporter.report(5, 10); // 5 of 10
 *   reporter.report(10, 10); // done
 */
export function createProgressReporter(server: McpServer, progressToken: string | number | undefined) {
  if (!progressToken) return { report: () => {} };
  return {
    report(progress: number, total?: number) {
      try {
        (server.server as any).sendProgress({ progressToken, progress, total });
      } catch { /* client may not support progress notifications */ }
    },
  };
}
