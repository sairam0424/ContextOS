import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import { validatePath, gitCommit, handleToolError } from "../utils.js";

export function registerDecisionTool(server: McpServer) {
  server.tool(
    "workspace_log_decision",
    {
      project: z.string().describe("Project name"),
      title: z.string().describe("Decision title"),
      context: z.string().describe("Context of the decision"),
      decision: z.string().describe("The decision made"),
      rationale: z.string().describe("Rationale for the decision")
    },
    async ({ project, title, context, decision, rationale }) => {
      try {
        const { fullPath: projectDir } = validatePath(`projects/${project}`);
        const decisionsPath = `${projectDir}/decisions.md`;
        const date = new Date().toISOString().split("T")[0];
        const adrId = `ADR-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;

        const adrContent = `
## [${adrId}] ${title}

- **Date**: ${date}
- **Status**: Accepted
- **Context**: ${context}
- **Decision**: ${decision}
- **Rationale**: ${rationale}
\n---\n`;

        await fs.appendFile(decisionsPath, adrContent, "utf-8");
        await gitCommit(decisionsPath, `feat(mcp): log decision ${adrId}: ${title}`);

        return {
          content: [{ type: "text" as const, text: `Logged decision ${adrId} in ${project}/decisions.md` }]
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
