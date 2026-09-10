import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { globalIndexer } from "@context-os/core";
import { registerBrowseTool } from "../tools/browse.js";
import { registerSearchTool } from "../tools/search.js";
import { workspaceRoot } from "../utils.js";

/**
 * `registerBrowseTool`'s handler calls the real `gitCommit()` on the success
 * path (see the identical rationale in `browse.test.ts`), so this test makes
 * a real commit against `workspaceRoot`'s actual git history. Capture HEAD
 * before the test and, if it moved, `git reset` (mixed — deliberately NOT
 * `--hard`) back to it in `afterEach`, exactly like `browse.test.ts` does.
 * Without this, `fs.rmSync(PROBE_DIR, ...)` below only deletes the working
 * copy — the commit itself survives, leaving a permanent stray "ingest"
 * commit behind every time this test runs.
 */
function currentHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot })
    .toString()
    .trim();
}

/**
 * Proves the claim this plan's Spec makes: `workspace_search` needs NO changes
 * to find a page ingested by `workspace_browse`, because both go through the
 * same SQLite documents/fts_documents tables — `globalIndexer.indexFile()`
 * (called by the browse tool) upserts into `documents`, whose `documents_ai`
 * trigger syncs `fts_documents` synchronously, and `intelligenceService.search()`
 * (called by the search tool) queries that same FTS5 table. No file-watcher,
 * no polling, no coupling between browse.ts and search.ts source files.
 */

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function newServer(): McpServer {
  return new McpServer({ name: "browse-ingest-search-test", version: "0.0.0" });
}

async function invoke(
  server: McpServer,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  const registry = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (...a: unknown[]) => unknown }
      >;
    }
  )._registeredTools;
  const tool = registry[name];
  assert.ok(tool, `tool '${name}' is not registered`);
  return (await tool.handler(args, { _meta: {} })) as ToolResult;
}

function textOf(result: ToolResult): string {
  return result.content.map((c) => c.text).join("\n");
}

describe("workspace_browse then workspace_search — end to end, real index", function () {
  this.timeout(20000);

  const PROBE_PROJECT = "__browse_search_probe__";
  const PROBE_DIR = path.join(workspaceRoot, "projects", PROBE_PROJECT);
  // A distinctive phrase unlikely to already exist anywhere else in this
  // workspace's index, so a keyword match proves THIS ingest was found.
  const NEEDLE = "Zephyrquartz-9000-deployment-runbook";

  let server: McpServer;
  let originalFetch: typeof globalThis.fetch;
  let indexedRelativePath: string | undefined;
  let headBeforeTest: string;

  beforeEach(() => {
    server = newServer();
    registerBrowseTool(server);
    registerSearchTool(server);
    originalFetch = globalThis.fetch;
    headBeforeTest = currentHead();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (indexedRelativePath) {
      await globalIndexer.removeFile(indexedRelativePath).catch(() => {});
    }
    if (currentHead() !== headBeforeTest) {
      // Mixed reset (no --hard): rewinds HEAD + the index only, never the
      // working tree, so it cannot discard any other uncommitted edit
      // sitting in a tracked file.
      execFileSync("git", ["reset", headBeforeTest], { cwd: workspaceRoot });
    }
    fs.rmSync(PROBE_DIR, { recursive: true, force: true });
  });

  it("finds the ingested page's content via workspace_search immediately after ingest", async () => {
    const html = `<html><head><title>Runbook</title></head><body><article>
      <h1>Deployment Runbook</h1>
      <p>This runbook describes the ${NEEDLE} procedure end to end, including
      the pre-flight checks operators must run before touching production
      traffic and the exact rollback sequence if any health check fails.</p>
      <p>Every step below has been used in a real incident and is written so a
      first responder unfamiliar with the service can still execute it
      correctly under pressure without asking anyone else for context.</p>
      <p>The runbook closes with a short verification checklist covering
      request latency, error rate, and queue depth, so whoever is running it
      has a concrete, objective way to decide whether the deployment is
      actually healthy before declaring the incident over.</p>
    </article></body></html>`;

    globalThis.fetch = (async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;

    const browseRes = await invoke(server, "workspace_browse", {
      url: "https://example.com/runbooks/deployment",
      project: PROBE_PROJECT,
    });
    assert.strictEqual(browseRes.isError, false, textOf(browseRes));

    const webDir = path.join(PROBE_DIR, "web");
    const [file] = fs.readdirSync(webDir);
    indexedRelativePath = path.relative(workspaceRoot, path.join(webDir, file));

    const searchRes = await invoke(server, "workspace_search", {
      query: NEEDLE,
      limit: 5,
    });
    // search.ts's success branch (non-empty results) explicitly returns
    // `isError: false as const` — only the zero-results branch leaves it
    // undefined. Since this test's whole point is that the search DOES find
    // results, assert `false`, not `undefined`.
    assert.strictEqual(searchRes.isError, false, textOf(searchRes));

    const out = textOf(searchRes);
    assert.ok(
      out.includes(indexedRelativePath.replace(/\\/g, "/")) ||
        out.includes(NEEDLE),
      `expected workspace_search to surface the freshly-ingested page; got:\n${out}`,
    );
    assert.ok(
      !out.includes("No results found."),
      "the ingested page must be found, not report zero results",
    );
  });
});
