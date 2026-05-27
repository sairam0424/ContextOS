import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workspaceRoot, getSharedDatabase } from "@context-os/core";
import path from "node:path";
import fs from "fs-extra";
import { handleToolError } from "../utils.js";
import { createProgressReporter } from "../progress.js";

export function registerPruneTool(server: McpServer) {
  server.tool(
    "workspace_prune",
    {
      target: z.enum(["tmp", "stale", "all"]).default("all").describe("What to prune: tmp files, stale index entries, or all"),
      dryRun: z.boolean().default(true).describe("If true (default), report what would be removed without deleting")
    },
    async ({ target, dryRun }, extra) => {
      try {
        const reporter = createProgressReporter(server, extra._meta?.progressToken);
        const removed: string[] = [];
        const skipped: string[] = [];

        // Collect total items for progress reporting
        let totalItems = 0;
        let processedItems = 0;

        const tmpEntries: string[] = [];
        if (target === "tmp" || target === "all") {
          const tmpDir = path.join(workspaceRoot, "tmp");
          if (await fs.pathExists(tmpDir)) {
            const entries = await fs.readdir(tmpDir);
            tmpEntries.push(...entries);
            totalItems += entries.length;
          }
        }

        let docs: { path: string }[] = [];
        if (target === "stale" || target === "all") {
          const db = getSharedDatabase();
          docs = db.getAllDocuments();
          totalItems += docs.length;
        }

        // Process tmp entries
        for (const entry of tmpEntries) {
          processedItems++;
          reporter.report(processedItems, totalItems);
          const full = path.join(workspaceRoot, "tmp", entry);
          if (!dryRun) await fs.remove(full);
          removed.push(`tmp/${entry}`);
        }

        // Process stale index entries
        if (target === "stale" || target === "all") {
          const db = getSharedDatabase();
          for (const doc of docs) {
            processedItems++;
            reporter.report(processedItems, totalItems);
            const fullPath = path.join(workspaceRoot, doc.path);
            const exists = await fs.pathExists(fullPath);
            if (!exists) {
              if (!dryRun) {
                db.removeDocument(doc.path);
              }
              removed.push(doc.path);
            } else {
              skipped.push(doc.path);
            }
          }
        }

        const prefix = dryRun ? "[DRY RUN] " : "";
        const summary = `${prefix}Prune complete: ${removed.length} removed, ${skipped.length} skipped.`;
        const details = removed.length > 0 ? `\n\nRemoved:\n${removed.map(r => `  - ${r}`).join('\n')}` : '';
        return {
          content: [{ type: "text" as const, text: summary + details }],
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
