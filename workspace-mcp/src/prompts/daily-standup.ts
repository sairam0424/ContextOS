import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerDailyStandup(server: McpServer): void {
  server.prompt(
    'daily-standup',
    'Generates a daily context summary with workspace status, active decisions, and blockers',
    { date: z.string().optional().describe('ISO date (defaults to today)') },
    async ({ date }) => {
      const targetDate = date ?? new Date().toISOString().slice(0, 10);
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `# Daily Standup — ${targetDate}\n\nProvide a workspace status summary including:\n- Active context files and their staleness\n- Open decisions requiring attention\n- Recent memory entries\n- Current blockers or risks\n- Suggested priorities for today`,
          },
        }],
      };
    }
  );
}
