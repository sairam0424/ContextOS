import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSharedDatabase, getSharedEmbeddingService, MemoryStream, ReflectionEngine, SkillLibrary, WorkspaceEventBus } from "@context-os/core";
import { handleToolError, sanitizeUntrustedContent } from "../utils.js";

const MEMORY_TYPE_ENUM = z.enum(["observation", "reflection", "plan", "skill"]);

let memoryStream: MemoryStream | null = null;
let reflectionEngine: ReflectionEngine | null = null;
let skillLibrary: SkillLibrary | null = null;

// Pass the shared embedding service so cognitive retrieval uses cosine relevance
// (WS-B); without it MemoryStream/ReflectionEngine/SkillLibrary fall back to
// lexical token overlap.
function getMemoryStream(): MemoryStream {
  if (!memoryStream) {
    const db = getSharedDatabase();
    const eventBus = new WorkspaceEventBus();
    memoryStream = new MemoryStream(db.getRawDb(), eventBus, undefined, getSharedEmbeddingService());
  }
  return memoryStream;
}

function getReflectionEngine(): ReflectionEngine {
  if (!reflectionEngine) {
    const db = getSharedDatabase();
    const eventBus = new WorkspaceEventBus();
    reflectionEngine = new ReflectionEngine(db.getRawDb(), eventBus, getMemoryStream(), getSharedEmbeddingService());
  }
  return reflectionEngine;
}

function getSkillLibrary(): SkillLibrary {
  if (!skillLibrary) {
    const db = getSharedDatabase();
    skillLibrary = new SkillLibrary(db.getRawDb(), getSharedEmbeddingService());
  }
  return skillLibrary;
}

export function registerCognitiveTools(server: McpServer): void {
  server.tool(
    "cognitive_observe",
    {
      agentId: z.string().describe("Agent identifier"),
      content: z.string().describe("Observation content to record"),
      type: MEMORY_TYPE_ENUM.optional().describe("Memory entry type"),
      importance: z.number().min(0).max(1).optional().describe("Importance score between 0 and 1"),
    },
    async ({ agentId, content, type, importance }) => {
      try {
        const entry = getMemoryStream().observe(agentId, content, { type, importance });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(entry) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "cognitive_observe");
      }
    },
  );

  server.tool(
    "cognitive_retrieve",
    {
      agentId: z.string().describe("Agent identifier"),
      query: z.string().describe("Retrieval query for three-factor scoring"),
      limit: z.number().int().min(1).max(50).default(10).describe("Maximum entries to return"),
      type: MEMORY_TYPE_ENUM.optional().describe("Filter by memory type"),
    },
    async ({ agentId, query, limit, type }) => {
      try {
        const entries = getMemoryStream().retrieve(agentId, query, { limit, type });
        // Stored memory entries are agent-supplied (cognitive_observe) — quarantine.
        return {
          content: [{ type: "text" as const, text: sanitizeUntrustedContent(JSON.stringify(entries), `memory:${agentId}`) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "cognitive_retrieve");
      }
    },
  );

  server.tool(
    "cognitive_reflect",
    {
      agentId: z.string().describe("Agent identifier"),
      taskId: z.string().describe("Task being reflected upon"),
      trial: z.number().int().describe("Trial number for this reflection"),
      observation: z.string().describe("What was observed during execution"),
      diagnosis: z.string().describe("Root cause analysis"),
      prescription: z.string().describe("Corrective action for future attempts"),
    },
    async ({ agentId, taskId, trial, observation, diagnosis, prescription }) => {
      try {
        const reflection = getReflectionEngine().reflect({
          agentId,
          taskId,
          trial,
          observation,
          diagnosis,
          prescription,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(reflection) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "cognitive_reflect");
      }
    },
  );

  server.tool(
    "skill_store",
    {
      name: z.string().describe("Unique skill name"),
      description: z.string().describe("What this skill does"),
      code: z.string().describe("Executable skill code or action sequence"),
      prerequisites: z.array(z.string()).optional().describe("Required prerequisite skill names"),
      createdBy: z.string().describe("Agent that created this skill"),
    },
    async ({ name, description, code, prerequisites, createdBy }) => {
      try {
        const skill = getSkillLibrary().store({ name, description, code, prerequisites, createdBy });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(skill) }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "skill_store");
      }
    },
  );

  server.tool(
    "skill_search",
    {
      query: z.string().describe("Search query to find relevant skills"),
      limit: z.number().int().min(1).max(20).default(5).describe("Maximum skills to return"),
    },
    async ({ query, limit }) => {
      try {
        const skills = getSkillLibrary().search(query, limit);
        // Stored skills are agent-supplied (skill_store) — quarantine.
        return {
          content: [{ type: "text" as const, text: sanitizeUntrustedContent(JSON.stringify(skills), 'skills') }],
          isError: false as const,
        };
      } catch (error: unknown) {
        return handleToolError(error, "skill_search");
      }
    },
  );
}
