import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSharedDatabase, WorkspaceEventBus, AgentRegistry, MessageBus, TaskScheduler, SwarmOrchestrator, NegotiationService, ConsensusService } from "@context-os/core";
import type { SwarmSession } from "@context-os/core";
import { handleToolError } from "../utils.js";

let swarmOrchestrator: SwarmOrchestrator | null = null;
let negotiationService: NegotiationService | null = null;
let consensusService: ConsensusService | null = null;

function getSwarmOrchestrator(): SwarmOrchestrator {
  if (!swarmOrchestrator) {
    const db = getSharedDatabase();
    const eventBus = new WorkspaceEventBus();
    const messageBus = new MessageBus(db.getRawDb(), eventBus);
    const registry = new AgentRegistry(db.getRawDb(), eventBus);
    const scheduler = new TaskScheduler(db.getRawDb(), registry, messageBus, eventBus);
    swarmOrchestrator = new SwarmOrchestrator(db.getRawDb(), eventBus, scheduler, registry);
  }
  return swarmOrchestrator;
}

function getNegotiationService(): NegotiationService {
  if (!negotiationService) {
    const db = getSharedDatabase();
    const eventBus = new WorkspaceEventBus();
    negotiationService = new NegotiationService(db.getRawDb(), eventBus);
  }
  return negotiationService;
}

function getConsensusService(): ConsensusService {
  if (!consensusService) {
    const db = getSharedDatabase();
    const eventBus = new WorkspaceEventBus();
    consensusService = new ConsensusService(db.getRawDb(), eventBus);
  }
  return consensusService;
}

export function registerSwarmTools(server: McpServer): void {
  server.tool(
    "swarm_spawn",
    {
      missionId: z.string().describe("Mission identifier to orchestrate"),
      topology: z.enum(["supervisor", "peer_swarm", "hierarchical", "round_robin"]).default("supervisor").describe("Swarm topology mode"),
      stallThreshold: z.number().default(5).describe("Number of stall ticks before triggering replan"),
      maxReplans: z.number().default(3).describe("Maximum replan attempts before abort"),
    },
    async ({ missionId, topology, stallThreshold, maxReplans }) => {
      try {
        const session = getSwarmOrchestrator().spawn(missionId, {
          topology,
          stallThreshold,
          maxReplans,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(session) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "swarm_spawn");
      }
    },
  );

  server.tool(
    "swarm_status",
    {
      sessionId: z.string().optional().describe("Specific session ID to query"),
      missionId: z.string().optional().describe("Mission ID to find session for"),
    },
    async ({ sessionId, missionId }) => {
      try {
        const orchestrator = getSwarmOrchestrator();

        if (sessionId) {
          const session = orchestrator.getSession(sessionId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(session) }],
            isError: false as const,
          };
        }

        if (missionId) {
          const sessions = orchestrator.getActiveSessions().filter(
            (s: SwarmSession) => s.missionId === missionId,
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(sessions) }],
            isError: false as const,
          };
        }

        const sessions = orchestrator.getActiveSessions();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(sessions) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "swarm_status");
      }
    },
  );

  server.tool(
    "swarm_negotiate",
    {
      action: z.enum(["propose", "accept", "reject", "counter"]).describe("Negotiation action to perform"),
      proposalId: z.string().optional().describe("Proposal ID for accept/reject/counter actions"),
      fromAgent: z.string().optional().describe("Proposing agent ID"),
      toAgent: z.string().optional().describe("Target agent ID"),
      resource: z.string().optional().describe("Resource being negotiated"),
      type: z.enum(["task_handoff", "resource_request", "capability_offer"]).optional().describe("Proposal type"),
      bid: z.number().optional().describe("Bid value or counter-bid"),
    },
    async ({ action, proposalId, fromAgent, toAgent, resource, type, bid }) => {
      try {
        const service = getNegotiationService();

        switch (action) {
          case "propose": {
            const proposal = service.propose({
              fromAgent: fromAgent!,
              toAgent: toAgent!,
              resource: resource!,
              type: type!,
              bid,
            });
            return {
              content: [{ type: "text" as const, text: JSON.stringify(proposal) }],
              isError: false as const,
            };
          }
          case "accept": {
            service.accept(proposalId!, toAgent!);
            const updated = service.getProposal(proposalId!);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(updated) }],
              isError: false as const,
            };
          }
          case "reject": {
            service.reject(proposalId!, toAgent!);
            const updated = service.getProposal(proposalId!);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(updated) }],
              isError: false as const,
            };
          }
          case "counter": {
            service.counter(proposalId!, toAgent!, bid!);
            const updated = service.getProposal(proposalId!);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(updated) }],
              isError: false as const,
            };
          }
        }
      } catch (error: unknown) {
        return handleToolError(error, "swarm_negotiate");
      }
    },
  );

  server.tool(
    "swarm_consensus",
    {
      action: z.enum(["propose", "vote", "result"]).describe("Consensus action to perform"),
      requestId: z.string().optional().describe("Vote request ID for vote/result actions"),
      proposerId: z.string().optional().describe("Agent proposing the vote"),
      topic: z.string().optional().describe("Topic for the vote"),
      options: z.array(z.string()).optional().describe("Available voting options"),
      quorum: z.number().optional().describe("Minimum votes needed for decision"),
      voterId: z.string().optional().describe("Voting agent ID"),
      choice: z.string().optional().describe("Vote choice from available options"),
      weight: z.number().optional().describe("Vote weight multiplier"),
    },
    async ({ action, requestId, proposerId, topic, options, quorum, voterId, choice, weight }) => {
      try {
        const service = getConsensusService();

        switch (action) {
          case "propose": {
            const request = service.propose({
              proposerId: proposerId!,
              topic: topic!,
              options: options!,
              quorum: quorum!,
            });
            return {
              content: [{ type: "text" as const, text: JSON.stringify(request) }],
              isError: false as const,
            };
          }
          case "vote": {
            const vote = service.vote(requestId!, voterId!, choice!, weight);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(vote) }],
              isError: false as const,
            };
          }
          case "result": {
            const result = service.getResult(requestId!);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result) }],
              isError: false as const,
            };
          }
        }
      } catch (error: unknown) {
        return handleToolError(error, "swarm_consensus");
      }
    },
  );
}
