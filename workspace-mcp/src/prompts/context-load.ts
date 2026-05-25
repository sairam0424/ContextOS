import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerContextLoad(server: McpServer): void {
  server.prompt(
    'context-load',
    'Loads workspace context from a specific path with configurable depth',
    {
      path: z.string().describe('Relative path within workspace to load context from'),
      depth: z.string().optional().describe('How many levels deep to traverse (1-5, default 2)'),
    },
    async ({ path, depth }) => {
      const maxDepth = depth ? parseInt(depth, 10) : 2;
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `# Context Load — ${path}\n\nLoad and summarize workspace context from path "${path}" with depth ${maxDepth}.\n\nInclude:\n- File structure overview\n- Key entities and their relationships\n- Recent modifications\n- Relevant decision history\n- Connection graph edges at this path`,
          },
        }],
      };
    }
  );
}
