import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "node:path";
import { globalIndexer } from "@context-os/core";
import { validatePath, gitCommit, handleToolError } from "../utils.js";
import { assertSafeHttpUrl, slugifyUrl } from "./browse-url.js";
import { extractArticleMarkdown } from "./browse-extract.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Fetches `url`, re-validating every redirect hop against the same SSRF
 * denylist as the original URL before following it. Node's `fetch` (undici)
 * has no cross-origin concept server-side, so `redirect: "manual"` returns
 * the real 3xx status and a readable `Location` header rather than an
 * opaque response — using the SDK's default `redirect: "follow"` would
 * silently follow a redirect to a private/loopback host on an otherwise
 * public, allowed origin, defeating `assertSafeHttpUrl` entirely (an
 * attacker-controlled or open-redirect endpoint on any allowed host could
 * point at `169.254.169.254` or `127.0.0.1`).
 */
async function fetchFollowingSafeRedirects(url: URL): Promise<Response> {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(currentUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "manual",
    });

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(
        `FETCH_FAILED: ${currentUrl} returned a redirect (HTTP ${response.status}) with no Location header.`,
      );
    }

    const nextUrl = new URL(location, currentUrl);
    currentUrl = assertSafeHttpUrl(nextUrl.toString());
  }

  throw new Error(
    `FETCH_FAILED: ${url} exceeded the maximum of ${MAX_REDIRECTS} redirects.`,
  );
}

function buildMarkdownDocument(
  title: string,
  sourceUrl: string,
  fetchedAt: string,
  body: string,
): string {
  return [
    "---",
    `title: ${yamlQuote(title)}`,
    `source: ${yamlQuote(sourceUrl)}`,
    `fetchedAt: ${yamlQuote(fetchedAt)}`,
    `tags: ["web-import"]`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/**
 * Registers `workspace_browse`: fetches an external HTTP(S) docs/changelog
 * page, extracts its readable article content, and ingests it as Markdown
 * under `projects/<project>/web/`, then indexes it so it is immediately
 * keyword-searchable via `workspace_search`.
 *
 * Follows the same `validatePath` + `gitCommit` convention as
 * `workspace_log_decision` and `workspace_memory_update` (see decision.ts /
 * memory.ts) for path isolation and opt-in git commit.
 */
export function registerBrowseTool(server: McpServer) {
  server.tool(
    "workspace_browse",
    {
      url: z
        .string()
        .min(1)
        .describe(
          "HTTP(S) URL of the external page to ingest (docs, changelog, etc.)",
        ),
      project: z
        .string()
        .regex(
          /^[a-zA-Z0-9_-]+$/,
          "project must be alphanumeric, '-' or '_' only",
        )
        .describe(
          "Project the page is filed under; stored at projects/<project>/web/",
        ),
    },
    async ({ url: rawUrl, project }) => {
      try {
        const safeUrl = assertSafeHttpUrl(rawUrl);
        const slug = slugifyUrl(safeUrl);
        const relativePath = `projects/${project}/web/${slug}.md`;
        const { fullPath } = validatePath(relativePath);

        const response = await fetchFollowingSafeRedirects(safeUrl);

        if (!response.ok) {
          throw new Error(
            `FETCH_FAILED: ${safeUrl} returned HTTP ${response.status}.`,
          );
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("html")) {
          throw new Error(
            `FETCH_NOT_HTML: expected an HTML page, got content-type '${contentType}'.`,
          );
        }

        const contentLength = Number(
          response.headers.get("content-length") ?? "0",
        );
        if (contentLength > MAX_FETCH_BYTES) {
          throw new Error(
            `FETCH_TOO_LARGE: ${safeUrl} is ${contentLength} bytes, over the ${MAX_FETCH_BYTES}-byte cap.`,
          );
        }

        let html = await response.text();
        if (html.length > MAX_FETCH_BYTES) {
          html = html.slice(0, MAX_FETCH_BYTES);
        }

        const { title, markdown } = extractArticleMarkdown(
          html,
          safeUrl.toString(),
        );
        const fetchedAt = new Date().toISOString();
        const document = buildMarkdownDocument(
          title,
          safeUrl.toString(),
          fetchedAt,
          markdown,
        );

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, document, "utf-8");

        await gitCommit(
          fullPath,
          `feat(mcp): ingest ${safeUrl} into ${relativePath}`,
        );

        let indexNotice = "";
        try {
          await globalIndexer.indexFile(fullPath);
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          indexNotice =
            `\nWARNING [unindexed]: the page is on disk and committed, but indexing failed (${reason}). ` +
            `Run context-os sync to repair.`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Ingested "${title}" from ${safeUrl} into ${relativePath}${indexNotice}`,
            },
          ],
          isError: false as const,
        };
      } catch (error: any) {
        return handleToolError(error);
      }
    },
  );
}
