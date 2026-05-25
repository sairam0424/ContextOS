import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerDecisionReview(server: McpServer): void {
  server.prompt(
    'decision-review',
    'Reviews open or recent decisions with optional status filter',
    {
      filter: z.string().optional().describe('Filter decisions by status: open, closed, deferred, all (default: open)'),
    },
    async ({ filter }) => {
      const status = filter ?? 'open';
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `# Decision Review — Filter: ${status}\n\nReview all decisions matching filter "${status}".\n\nFor each decision provide:\n- Decision ID and title\n- Current status and age\n- Options considered with pros/cons\n- Stakeholders involved\n- Recommended action or escalation path\n- Impact on dependent work items`,
          },
        }],
      };
    }
  );
}
