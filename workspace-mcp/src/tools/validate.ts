import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validationService, ALLOWED_BUCKETS, workspaceRoot } from "@context-os/core";
import path from "node:path";
import fs from "fs-extra";
import { handleToolError } from "../utils.js";
import { createProgressReporter } from "../progress.js";

export function registerValidateTool(server: McpServer) {
  server.tool(
    "workspace_validate",
    {
      path: z.string().optional().describe("Relative file path to validate. Omit to validate the entire workspace.")
    },
    async ({ path: filePath }, extra) => {
      try {
        const reporter = createProgressReporter(server, extra._meta?.progressToken);

        if (filePath) {
          reporter.report(1, 2);
          const fullPath = path.resolve(workspaceRoot, filePath);
          const { valid, issues } = await validationService.validateFile(fullPath);
          const status = valid ? "✅ Valid" : `❌ Invalid (${issues.length} issue${issues.length !== 1 ? 's' : ''})`;
          const body = issues.length > 0 ? `\n${issues.map(i => `  - ${i}`).join('\n')}` : '';
          reporter.report(2, 2);
          return { content: [{ type: "text" as const, text: `${status}: ${filePath}${body}` }] };
        }

        // Full workspace scan — collect all files first for accurate progress
        const allFiles: string[] = [];
        for (const bucket of ALLOWED_BUCKETS) {
          const bucketPath = path.join(workspaceRoot, bucket);
          if (!(await fs.pathExists(bucketPath))) continue;
          const files = await findMarkdownFiles(bucketPath);
          allFiles.push(...files);
        }

        const totalFiles = allFiles.length;
        let totalChecked = 0;
        let totalIssues = 0;
        const invalidFiles: string[] = [];

        for (const f of allFiles) {
          totalChecked++;
          reporter.report(totalChecked, totalFiles);
          const { valid, issues } = await validationService.validateFile(f);
          if (!valid) {
            totalIssues += issues.length;
            invalidFiles.push(`${path.relative(workspaceRoot, f)}: ${issues.join('; ')}`);
          }
        }

        const summary = `Workspace Validation: ${totalChecked} files checked, ${invalidFiles.length} invalid, ${totalIssues} total issues.`;
        const details = invalidFiles.length > 0 ? `\n\nInvalid files:\n${invalidFiles.map(f => `  ❌ ${f}`).join('\n')}` : '\n\n✅ All files valid.';
        return { content: [{ type: "text" as const, text: summary + details }] };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}
