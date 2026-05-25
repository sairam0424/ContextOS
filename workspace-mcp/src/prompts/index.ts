import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDailyStandup } from './daily-standup.js';
import { registerContextLoad } from './context-load.js';
import { registerDecisionReview } from './decision-review.js';
import { registerMissionBrief } from './mission-brief.js';

export function registerPrompts(server: McpServer): void {
  registerDailyStandup(server);
  registerContextLoad(server);
  registerDecisionReview(server);
  registerMissionBrief(server);
}
