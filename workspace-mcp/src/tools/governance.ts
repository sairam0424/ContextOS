import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSharedDatabase, WorkspaceEventBus } from "@context-os/core";
import { handleToolError } from "../utils.js";
import { CapabilityTokenService, TrustEngine, PolicyEngine, AnomalyDetector } from "@context-os/core";

let capabilityTokenService: CapabilityTokenService | null = null;
let trustEngine: TrustEngine | null = null;
let policyEngine: PolicyEngine | null = null;
let anomalyDetector: AnomalyDetector | null = null;

function getCapabilityTokenService(): CapabilityTokenService {
  if (!capabilityTokenService) {
    const db = getSharedDatabase();
    const eventBus = new WorkspaceEventBus();
    capabilityTokenService = new CapabilityTokenService(db.getRawDb(), eventBus);
  }
  return capabilityTokenService;
}

function getTrustEngine(): TrustEngine {
  if (!trustEngine) {
    const db = getSharedDatabase();
    const eventBus = new WorkspaceEventBus();
    trustEngine = new TrustEngine(db.getRawDb(), eventBus);
  }
  return trustEngine;
}

function getPolicyEngine(): PolicyEngine {
  if (!policyEngine) {
    const db = getSharedDatabase();
    const te = getTrustEngine();
    policyEngine = new PolicyEngine(db.getRawDb(), te);
  }
  return policyEngine;
}

function getAnomalyDetector(): AnomalyDetector {
  if (!anomalyDetector) {
    const db = getSharedDatabase();
    const eventBus = new WorkspaceEventBus();
    anomalyDetector = new AnomalyDetector(db.getRawDb(), eventBus);
  }
  return anomalyDetector;
}

export function registerGovernanceTools(server: McpServer): void {
  server.tool(
    "governance_issue_token",
    {
      agentId: z.string().describe("Agent to issue the token to"),
      capabilities: z.array(z.object({
        resource: z.string(),
        actions: z.array(z.enum(["read", "write", "execute", "delegate"])),
      })).describe("Capability grants for this token"),
      issuedBy: z.string().describe("Issuing authority identifier"),
      ttlMs: z.number().default(3600000).describe("Token time-to-live in milliseconds"),
      maxDelegationDepth: z.number().default(0).describe("Maximum allowed delegation depth"),
    },
    async ({ agentId, capabilities, issuedBy, ttlMs, maxDelegationDepth }) => {
      try {
        const service = getCapabilityTokenService();
        const token = service.issue({
          agentId,
          capabilities,
          issuedBy,
          ttlMs,
          maxDelegationDepth,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(token) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "governance_issue_token");
      }
    },
  );

  server.tool(
    "governance_check_trust",
    {
      agentId: z.string().describe("Agent to query trust score for"),
    },
    async ({ agentId }) => {
      try {
        const te = getTrustEngine();
        const score = te.getScore(agentId);
        const detector = getAnomalyDetector();
        const alerts = detector.detectAll(agentId);
        const result = { score, alerts };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "governance_check_trust");
      }
    },
  );

  server.tool(
    "governance_evaluate_policy",
    {
      agentId: z.string().describe("Agent requesting the action"),
      resource: z.string().describe("Target resource identifier"),
      action: z.enum(["read", "write", "execute", "delegate"]).describe("Action to evaluate"),
    },
    async ({ agentId, resource, action }) => {
      try {
        const pe = getPolicyEngine();
        const decision = pe.evaluate(agentId, resource, action);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(decision) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "governance_evaluate_policy");
      }
    },
  );
}
