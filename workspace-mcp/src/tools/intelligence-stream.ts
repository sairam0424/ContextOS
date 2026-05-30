import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSharedDatabase, WorkspaceEventBus, EventProcessor, PredictiveHealthMonitor, KnowledgeDistiller } from "@context-os/core";
import { handleToolError } from "../utils.js";

let eventProcessor: EventProcessor | null = null;
let healthMonitor: PredictiveHealthMonitor | null = null;
let distiller: KnowledgeDistiller | null = null;

function getEventProcessor(): EventProcessor {
  if (!eventProcessor) {
    const eventBus = new WorkspaceEventBus();
    eventProcessor = new EventProcessor(eventBus);
  }
  return eventProcessor;
}

function getHealthMonitor(): PredictiveHealthMonitor {
  if (!healthMonitor) {
    const eventBus = new WorkspaceEventBus();
    healthMonitor = new PredictiveHealthMonitor(eventBus);
  }
  return healthMonitor;
}

function getDistiller(): KnowledgeDistiller {
  if (!distiller) {
    const db = getSharedDatabase();
    distiller = new KnowledgeDistiller(db.getRawDb());
  }
  return distiller;
}

export function registerIntelligenceStreamTools(server: McpServer): void {
  server.tool(
    "intelligence_health",
    {
      service: z.string().optional().describe("Specific service to check, or omit for all"),
    },
    async ({ service }) => {
      try {
        const monitor = getHealthMonitor();
        const result = service
          ? monitor.predict(service)
          : monitor.predictAll();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "intelligence_health");
      }
    },
  );

  server.tool(
    "intelligence_patterns",
    {
      windowMs: z.number().default(3600000).describe("Look-back window in ms"),
    },
    async ({ windowMs }) => {
      try {
        const processor = getEventProcessor();
        const since = Date.now() - windowMs;
        const matches = processor.getMatches(since);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(matches) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "intelligence_patterns");
      }
    },
  );

  server.tool(
    "intelligence_distill",
    {
      corridor: z.string().optional().describe("Knowledge corridor to query"),
      force: z.boolean().default(false).describe("Force distillation of buffered queries"),
    },
    async ({ corridor, force }) => {
      try {
        const d = getDistiller();
        if (force) {
          const result = d.distill();
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            isError: false as const,
          };
        }
        if (corridor) {
          const entry = d.getCorridor(corridor);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(entry) }],
            isError: false as const,
          };
        }
        const top = d.getTopCorridors(10);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(top) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "intelligence_distill");
      }
    },
  );
}
