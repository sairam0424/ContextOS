import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { globalIndexer } from "@context-os/core";
import { workspaceRoot } from "../utils.js";
import { registerBrowseTool } from "../tools/browse.js";

/**
 * `registerBrowseTool` calls the real `gitCommit()` from `@context-os/core`
 * on the success path (same convention as `workspace_log_decision` /
 * `workspace_memory_update`) — there is no seam to mock it (it is a plain
 * function export, not a method on a mutable object like `globalIndexer`,
 * so it cannot be monkey-patched the way `globalThis.fetch` and
 * `globalIndexer.indexFile` are below). Exercising the real handler
 * therefore makes a real commit against `workspaceRoot`'s actual git
 * history. Capture HEAD before each test and, if it moved, `git reset`
 * (mixed — deliberately NOT `--hard`) back to it afterward so the suite
 * never leaves a stray commit behind. A mixed reset only rewinds HEAD and
 * the index; it never touches the working tree, so it cannot clobber any
 * other uncommitted edit sitting in a tracked file (a `--hard` reset here
 * already once destroyed an uncommitted edit to this very file). The
 * probe file the reverted commit added is left behind, untracked, in the
 * working tree by design — `afterEach` removes it explicitly below.
 */
function currentHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot })
    .toString()
    .trim();
}

/**
 * Minimal test-only harness for invoking a registered tool's handler
 * directly, bypassing the MCP SDK's `CallToolRequestSchema` request handler
 * (and therefore its zod `validateToolInput` step — that parsing only runs
 * inside `server.setRequestHandler(CallToolRequestSchema, ...)`, a separate
 * code path from the raw `handler` stored on `_registeredTools`, confirmed
 * in the installed SDK's `server/mcp.js`).
 */
function newServer(): McpServer {
  return new McpServer({ name: "test-server", version: "1.0.0" });
}

async function invoke(
  server: McpServer,
  name: string,
  args: unknown,
): Promise<any> {
  const registered = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (args: unknown, extra: unknown) => Promise<any> }
      >;
    }
  )._registeredTools[name];
  if (!registered) {
    throw new Error(`Tool '${name}' is not registered`);
  }
  return registered.handler(args, {});
}

function textOf(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return result.content.map((block) => block.text ?? "").join("\n");
}

describe("workspace_browse — SSRF guard, extraction, and write/index wiring", function () {
  // The success-path test's handler calls the real gitCommit(), which spawns
  // `git add` + `git commit` (through Husky's pre-commit hook) against this
  // repo's actual working tree — comfortably over mocha's 2000ms default
  // under any real system load. A timed-out test does not cancel the
  // in-flight handler promise, so the write/commit can complete *after*
  // mocha has already moved on and this suite's own afterEach git-history
  // cleanup ran — leaving a stray commit behind. A generous suite-level
  // timeout keeps the async work inside the test that owns it.
  this.timeout(20_000);

  let server: McpServer;
  let originalFetch: typeof globalThis.fetch;
  let originalIndexFile: typeof globalIndexer.indexFile;
  let headBeforeTest: string;
  const PROBE_PROJECT = "__browse_probe__";
  const PROBE_DIR = path.join(workspaceRoot, "projects", PROBE_PROJECT);

  beforeEach(() => {
    server = newServer();
    registerBrowseTool(server);
    originalFetch = globalThis.fetch;
    originalIndexFile = globalIndexer.indexFile;
    headBeforeTest = currentHead();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalIndexer.indexFile = originalIndexFile;
    if (currentHead() !== headBeforeTest) {
      // Mixed reset (no --hard): rewinds HEAD + the index only, never the
      // working tree, so it cannot discard any other uncommitted edit
      // sitting in a tracked file.
      execFileSync("git", ["reset", headBeforeTest], {
        cwd: workspaceRoot,
      });
    }
    fs.rmSync(PROBE_DIR, { recursive: true, force: true });
  });

  it("rejects a private-host URL before ever calling fetch", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called");
    }) as typeof fetch;

    const res = await invoke(server, "workspace_browse", {
      url: "http://127.0.0.1/admin",
      project: PROBE_PROJECT,
    });

    assert.strictEqual(res.isError, true);
    assert.match(textOf(res), /SEC_SSRF_PRIVATE_HOST/);
    assert.strictEqual(
      fetchCalled,
      false,
      "the SSRF guard must run before any network call",
    );
    assert.ok(
      !fs.existsSync(PROBE_DIR),
      "nothing may be written for a rejected URL",
    );
  });

  it("rejects a redirect that points at a private host, without writing anything", async () => {
    // fetch() is stubbed to behave like `redirect: "manual"` against a
    // public origin that 302s to a loopback target — asserts the redirect
    // hop is re-validated by assertSafeHttpUrl rather than blindly followed.
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:9999/internal" },
      })) as typeof fetch;

    const res = await invoke(server, "workspace_browse", {
      url: "https://example.com/redirector",
      project: PROBE_PROJECT,
    });

    assert.strictEqual(res.isError, true);
    assert.match(textOf(res), /SEC_SSRF_PRIVATE_HOST/);
    assert.ok(
      !fs.existsSync(PROBE_DIR),
      "nothing may be written when a redirect hop is unsafe",
    );
  });

  it("rejects a project name containing path-traversal-shaped characters", async () => {
    // This test invokes the raw registered handler directly (see `invoke`
    // above), bypassing the MCP SDK's zod `validateToolInput` step, so the
    // zod regex's "must be alphanumeric" message never surfaces here —
    // `../evil` reaches `validatePath("projects/../evil/web/<slug>.md")`
    // directly, which resolves to `<root>/evil/web/<slug>.md`, outside every
    // allowed bucket, and `validatePath` (packages/core/src/index.ts) throws
    // "Security violation: ... is outside the allowed bucket (...)".
    const res = await invoke(server, "workspace_browse", {
      url: "https://example.com/docs",
      project: "../evil",
    });
    assert.strictEqual(res.isError, true);
    assert.match(textOf(res), /outside the allowed bucket/);
  });

  it("fetches, extracts, writes under projects/<project>/web/, and indexes the result", async () => {
    const html = `<html><head><title>Widget Changelog</title></head><body><article>
      <h1>Widget Changelog</h1>
      <p>Version 2.0 introduces a completely rewritten configuration loader
      that resolves options from environment variables, a config file, and
      inline overrides, in that priority order, with clear diagnostics when
      two sources disagree about the same key.</p>
      <p>Version 1.9 fixed a long-standing race condition in the plugin
      loader that could double-register a plugin under heavy concurrent
      startup, which manifested as duplicate log lines and, rarely, a crash.</p>
      <p>Both releases also update the bundled documentation examples so
      that copy-pasting a snippet from the changelog itself always produces
      a working configuration, which was not reliably true before this pass
      through every example in the repository.</p>
    </article></body></html>`;

    globalThis.fetch = (async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as typeof fetch;

    let indexedPath: string | undefined;
    globalIndexer.indexFile = (async (filePath: string) => {
      indexedPath = filePath;
      return null;
    }) as typeof globalIndexer.indexFile;

    const res = await invoke(server, "workspace_browse", {
      url: "https://example.com/changelog",
      project: PROBE_PROJECT,
    });

    assert.strictEqual(res.isError, false, textOf(res));
    assert.match(textOf(res), /Widget Changelog/);

    const written = path.join(PROBE_DIR, "web");
    const files = fs.readdirSync(written);
    assert.strictEqual(
      files.length,
      1,
      `expected exactly one ingested file, found ${files.join(", ")}`,
    );

    const content = fs.readFileSync(path.join(written, files[0]), "utf-8");
    assert.match(content, /^---\n/, "must start with YAML frontmatter");
    assert.match(content, /title: "Widget Changelog"/);
    assert.match(content, /source: "https:\/\/example\.com\/changelog"/);
    assert.match(content, /tags: \["web-import"\]/);
    assert.match(content, /completely rewritten configuration loader/);

    assert.ok(
      indexedPath,
      "globalIndexer.indexFile must be called after the write",
    );
    assert.strictEqual(indexedPath, path.join(written, files[0]));
  });

  it("reports FETCH_FAILED on a non-2xx response and writes nothing", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 404 })) as typeof fetch;
    const res = await invoke(server, "workspace_browse", {
      url: "https://example.com/gone",
      project: PROBE_PROJECT,
    });
    assert.strictEqual(res.isError, true);
    assert.match(textOf(res), /FETCH_FAILED/);
    assert.ok(!fs.existsSync(PROBE_DIR));
  });

  it("reports FETCH_NOT_HTML for a non-HTML content-type and writes nothing", async () => {
    globalThis.fetch = (async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const res = await invoke(server, "workspace_browse", {
      url: "https://example.com/api",
      project: PROBE_PROJECT,
    });
    assert.strictEqual(res.isError, true);
    assert.match(textOf(res), /FETCH_NOT_HTML/);
    assert.ok(!fs.existsSync(PROBE_DIR));
  });
});
