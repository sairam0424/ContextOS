import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerMissionBrief(server: McpServer): void {
  server.prompt(
    'mission-brief',
    'Generates a comprehensive mission briefing for a specific mission',
    {
      missionId: z.string().describe('Mission identifier to generate briefing for'),
    },
    async ({ missionId }) => {
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `# Mission Brief — ${missionId}\n\nGenerate a comprehensive mission briefing for mission "${missionId}".\n\nInclude:\n- Mission objective and success criteria\n- Current progress and completion percentage\n- Active sub-tasks and their status\n- Resource allocation and constraints\n- Risk assessment and mitigation strategies\n- Timeline with key milestones\n- Dependencies on other missions or external factors`,
          },
        }],
      };
    }
  );
}
