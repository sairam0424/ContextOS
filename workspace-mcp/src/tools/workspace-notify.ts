import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleToolError } from '../utils.js';

export function registerWorkspaceNotifyTool(server: McpServer): void {
  server.tool(
    'workspace_notify',
    {
      action: z.enum(['send', 'read', 'broadcast']),
      topic: z.string().optional().describe('Notification topic/channel'),
      targetAgentId: z.string().optional().describe('Target agent ID for send action'),
      content: z.string().optional().describe('Message content'),
      agentId: z.string().optional().describe('Agent ID for read action'),
    },
    async ({ action, topic, targetAgentId, content, agentId }) => {
      try {
        if (action === 'send' && (!targetAgentId || !content)) {
          return {
            content: [{ type: 'text' as const, text: 'Error: send requires targetAgentId and content' }],
            isError: true,
          };
        }
        if (action === 'broadcast' && !content) {
          return {
            content: [{ type: 'text' as const, text: 'Error: broadcast requires content' }],
            isError: true,
          };
        }
        if (action === 'read' && !agentId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: read requires agentId' }],
            isError: true,
          };
        }

        const result = {
          action,
          status: 'ok',
          timestamp: new Date().toISOString(),
          ...(topic && { topic }),
          ...(targetAgentId && { targetAgentId }),
          ...(agentId && { agentId }),
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (error: unknown) {
        return handleToolError(error);
      }
    }
  );
}
