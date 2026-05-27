import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { intelligenceService } from "@context-os/core";
import { handleToolError } from "../utils.js";
import { createProgressReporter } from "../progress.js";

interface CursorPayload {
  offset: number;
  q: string;
}

function hashQuery(query: string): string {
  return createHash("sha256").update(query).digest("hex").slice(0, 16);
}

function encodeCursor(offset: number, queryHash: string): string {
  const payload: CursorPayload = { offset, q: queryHash };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload {
  return JSON.parse(Buffer.from(cursor, "base64url").toString()) as CursorPayload;
}

export function registerSearchTool(server: McpServer) {
  server.tool(
    "workspace_search",
    {
      query: z.string().describe("Search query string"),
      deep: z.boolean().optional().describe("Force deep scan using grep"),
      anchor: z.string().optional().describe("Anchor node path for Spatial RAG graph-boosted results"),
      limit: z.number().min(1).max(100).optional().describe("Max results to return (default 10)"),
      offset: z.number().min(0).optional().describe("Offset for pagination (default 0)"),
      cursor: z.string().optional().describe("Cursor for cursor-based pagination (alternative to offset)")
    },
    async ({ query, deep, anchor, limit, offset, cursor }, extra) => {
      try {
        const reporter = createProgressReporter(server, extra._meta?.progressToken);
        const effectiveLimit = limit ?? 10;
        let effectiveOffset = offset ?? 0;
        const qHash = hashQuery(query);

        // Cursor-based pagination: decode cursor and validate
        if (cursor) {
          const decoded = decodeCursor(cursor);
          if (decoded.q !== qHash) {
            return {
              content: [{ type: "text" as const, text: "Error: stale cursor — query has changed since cursor was issued." }],
              isError: true as const
            };
          }
          effectiveOffset = decoded.offset;
        }

        reporter.report(1, 4);

        // Generate embeddings and search
        reporter.report(2, 4);
        const results = await intelligenceService.search(query, {
          deep,
          anchorNode: anchor,
          limit: effectiveLimit,
          offset: effectiveOffset
        });

        // Fuse results
        reporter.report(3, 4);

        if (results.length === 0) {
          reporter.report(4, 4);
          return {
            content: [{ type: "text" as const, text: "No results found." }],
          };
        }

        const formattedResults = results.map(res => {
          const typeTag = res.type === 'hybrid' ? '[Hybrid]' : '[Deep]';
          let output = `${typeTag} ${res.path}\n`;
          if (res.title && res.title !== 'Deep Scan Result') {
            output += `Title: ${res.title} ${res.tags.length ? `[${res.tags.join(', ')}]` : ''}\n`;
          }
          output += `Excerpt: ${res.excerpt}\n`;
          output += `---`;
          return output;
        }).join('\n');

        // Build next cursor if more results may exist
        let paginationFooter = "";
        if (results.length === effectiveLimit) {
          const nextCursor = encodeCursor(effectiveOffset + effectiveLimit, qHash);
          paginationFooter = `\n\n---\nnextCursor: ${nextCursor}`;
        }

        reporter.report(4, 4);

        return {
          content: [{ type: "text" as const, text: formattedResults + paginationFooter }],
          isError: false as const
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    }
  );
}
