# workspace_browse MCP Tool Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a `workspace_browse` MCP tool to `@context-os/mcp` that fetches a public docs/changelog web page, extracts its main-content article, converts it to Markdown, writes it under `projects/<project>/web/`, and indexes it into the existing SQLite FTS5 + sqlite-vec store so `workspace_search` finds it immediately with zero changes to `search.ts`.

**Architecture:** Two new pure helper modules (`browse-url.ts` for SSRF-safe URL validation + slug derivation, `browse-extract.ts` for Readability+Turndown HTML→Markdown extraction) are composed by a new `browse.ts` tool file that follows the exact `registerXTool(server: McpServer)` convention every other tool in `workspace-mcp/src/tools/` uses. The tool calls `validatePath`/`recordWrite`/`commitOrNotice` from `utils.ts` exactly like `decision.ts`/`memory.ts` do (path-isolation + opt-in git commit + Merkle audit record), then calls the exported `globalIndexer.indexFile()` from `@context-os/core` — the same public method the file watcher and `context-os sync` use — so the ingested page's FTS5 row exists (via the `documents_ai` trigger) before the tool call returns. The tool must then be classified in `enforcement-actions.ts`'s `TOOL_ACTIONS` map and added to `enforcement.test.ts`'s `REGISTRARS` array, or the boot-time `auditClassificationCoverage()` check and the "pins the live tool count" test both fail.

**Tech Stack:** `@modelcontextprotocol/sdk` (`server.tool()`), `zod` (schema), Node 20+ global `fetch`/`AbortSignal.timeout` (already used identically in `packages/core/src/services/federation.ts`), `jsdom` (already a pinned dependency of `workspace-dashboard` at `^25.0.0`, added here as a direct dependency of `workspace-mcp`), `@mozilla/readability` (new dependency — confirmed absent from the whole monorepo), `turndown` (new dependency — confirmed absent from the whole monorepo).

**Spec:** This plan is based on direct inspection of `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS` on 2026-09-09, not the prior portfolio research, which was stale on several material points corrected below:

- The tool count is **38** live `server.tool(...)` registrations (verified by `grep -c`), not "~18". `enforcement.ts`'s own comment and `enforcement.test.ts`'s `it("pins the live tool count at 38 ...")` both say `mcp.json`'s count of 17 is *already* stale — this repo has drifted before and has a test specifically to catch it happening again.
- `knowledge/` and `schemas/` are **read-only for agents** (`isReadOnly()` in `packages/core/src/index.ts`, enforced by `workspace_write` and documented in root `CLAUDE.md`: "agents may READ `knowledge/` and `schemas/` but never WRITE them" — `isReadOnly()`'s actual bucket list is broader still: `["knowledge", "schemas", "root", "packages", "workspace-cli", "workspace-mcp", "workspace-dashboard"]`, though this doesn't change this plan's target bucket since `projects/` is unaffected and stays writable). The comment in `write.ts` — `"Use specific extraction tools to update knowledge."` — is **aspirational dead text**: no such tool exists anywhere in the codebase (`grep -rn "extraction tool"` finds only that one comment). There is no bypass convention to reuse. The correct target bucket for new agent-writable content is `projects/<project>/...`, exactly like `workspace_log_decision` and `workspace_memory_update` already use — so this plan writes ingested pages to `projects/<project>/web/<slug>.md`, not to `knowledge/`.
- `workspace_search` calls `intelligenceService.search()`, which queries `DatabaseService.searchHybrid()` directly against SQLite — it does **not** re-scan the filesystem. A file dropped on disk is invisible to it until something calls the indexer. `ContextIndexer.indexFile()` (exported as part of `globalIndexer`, itself exported via `export * from './indexer.js'` in `packages/core/src/index.ts`) is the public, already-existing hook that upserts into `documents` (whose `documents_ai` trigger syncs `fts_documents` synchronously) and enqueues embedding. Calling it after the write is what makes the "immediately hybrid-searchable, no changes to search.ts" property in the original research actually true — it is not automatic.
- No Readability-style extraction library exists anywhere in this monorepo. The only match for `jsdom` is a `devDependency` of `workspace-dashboard` (`^25.0.0`, for Vitest's DOM environment) — unrelated to content extraction. This plan adds `@mozilla/readability` + `jsdom` (pinned to the version already used elsewhere in this repo) + `turndown` as new dependencies of `workspace-mcp` specifically.
- **`browser-harness` is deliberately NOT used.** Its own `SKILL.md` says: *"A basic fetch of public information needs no browser... If a plain HTTP request can read it — a public page, an API, docs — use curl or your fetch tool, and leave the browser alone."* Docs and changelog pages are exactly that case. `browser-harness` also requires an already-running local Chrome CDP daemon with per-invocation Python heredoc scripts and a persistent "attached tab" model — none of which fits a stateless MCP tool call, and there is no existing precedent anywhere in `workspace-mcp` of shelling out to an external CLI with piped stdin (the one shell-out precedent, `execFile('grep', ...)` in `packages/core/src/services/intelligence.ts`, passes CLI args, not stdin, for a synchronous, sandboxed, sub-second operation — a very different risk/complexity profile than driving a live browser daemon). Acting as an MCP *client* of the browser-harness MCP *server* has zero precedent in this codebase either (no file anywhere constructs an SDK `Client` against an external server process). The idiomatic, "boring tech" choice consistent with this repo's own `federation.ts` is Node's built-in `fetch()`. JS-rendered/bot-walled pages are explicitly out of scope for v1 (see Global Constraints) and are a natural follow-up if ever needed, at which point `browser-harness`'s own guidance to escalate from a failed plain fetch would apply.
- Every registered tool **must** appear in `enforcement-actions.ts`'s `TOOL_ACTIONS` map (fail-closed to `"write"` otherwise, plus a loud boot-time ALERT), and `enforcement.test.ts` pins the live registrar list, the live tool count (`38`), and the `TOOL_ACTIONS` map against each other in both directions. Both must be updated in lockstep with the new tool or the test suite fails on purpose.
- `FederationService` (`packages/core/src/services/federation.ts`) confirms the "nothing reaches the outside web" framing precisely: it `fetch()`es `/api/search` on other **ContextOS peer workspaces** (`workspaceConfigService.get('federation.peers')`), never an arbitrary external URL. `workspace_browse` is the first tool in this codebase to fetch an arbitrary external HTTP(S) resource.

## Global Constraints

- Every new/changed TypeScript file uses ESM `NodeNext` resolution: relative imports end in `.js` even though the source file is `.ts` (see any existing file in `workspace-mcp/src/tools/`).
- Path safety: every filesystem write MUST go through `validatePath()` from `../utils.js` before touching disk — no exceptions, per the `SECURITY` comment on `validatePath` in `packages/core/src/index.ts`.
- SSRF hardening on the fetch is a literal hostname/IP-range denylist (`localhost`, `127.*`, `10.*`, `172.16-31.*`, `192.168.*`, `169.254.*`, `0.0.0.0`, `::1`, `fc00::/7`, `fe80::/10`, `*.local`), not a DNS-resolution-based defense — this is a documented limitation (DNS rebinding is not caught), matching this codebase's own house style of stating real limitations rather than hiding them (see `SEMANTIC_UNAVAILABLE_NOTICE` in `packages/core/src/services/intelligence.ts`).
- Fetch cap: `FETCH_TIMEOUT_MS = 15_000`, `MAX_FETCH_BYTES = 5_000_000` (5 MB), enforced via `Content-Length` header rejection plus a hard slice of the decoded body as defense-in-depth.
- Out of scope for v1, explicitly: JS-rendered pages, bot-walled/login-walled pages, non-HTML content types (raw `.md`, PDFs), and browser automation of any kind.
- Every new tool MUST be classified in `workspace-mcp/src/enforcement-actions.ts`'s `TOOL_ACTIONS` map and added to `workspace-mcp/src/tests/enforcement.test.ts`'s `REGISTRARS` array, updating both hardcoded tool-count assertions from `38` to `39`.
- Test commands always build first: `cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build` (compiles `src/**/*.ts` → `dist/`), then `npx mocha --require ../scripts/mocha-test-env.cjs dist/tests/<file>.test.js` for a single file, or `npm test` for the whole suite (equivalent to the `package.json` `test` script, run from `workspace-mcp/`).

---

### Task 1: SSRF-safe URL validation and slug derivation

**Files:**
- Create: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tools/browse-url.ts`
- Test: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/browse-url.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces: `assertSafeHttpUrl(raw: string): URL` and `slugifyUrl(url: URL): string`, both consumed by Task 3's `browse.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/browse-url.test.ts
import assert from "node:assert";
import { assertSafeHttpUrl, slugifyUrl } from "../tools/browse-url.js";

describe("browse-url", () => {
  describe("assertSafeHttpUrl", () => {
    it("accepts a plain public https URL and returns a URL object", () => {
      const url = assertSafeHttpUrl("https://example.com/docs/getting-started");
      assert.strictEqual(url.hostname, "example.com");
      assert.strictEqual(url.pathname, "/docs/getting-started");
    });

    it("accepts http as well as https", () => {
      const url = assertSafeHttpUrl("http://example.com/changelog");
      assert.strictEqual(url.protocol, "http:");
    });

    it("rejects a malformed URL", () => {
      assert.throws(() => assertSafeHttpUrl("not a url"), /SEC_SSRF_INVALID_URL/);
    });

    it("rejects a non-http(s) scheme", () => {
      assert.throws(() => assertSafeHttpUrl("file:///etc/passwd"), /SEC_SSRF_SCHEME/);
      assert.throws(() => assertSafeHttpUrl("ftp://example.com/x"), /SEC_SSRF_SCHEME/);
    });

    it("rejects localhost and loopback", () => {
      assert.throws(() => assertSafeHttpUrl("http://localhost/admin"), /SEC_SSRF_PRIVATE_HOST/);
      assert.throws(() => assertSafeHttpUrl("http://127.0.0.1/admin"), /SEC_SSRF_PRIVATE_HOST/);
    });

    it("rejects RFC1918 private ranges and link-local (incl. the cloud metadata address)", () => {
      assert.throws(() => assertSafeHttpUrl("http://10.0.0.5/"), /SEC_SSRF_PRIVATE_HOST/);
      assert.throws(() => assertSafeHttpUrl("http://192.168.1.1/"), /SEC_SSRF_PRIVATE_HOST/);
      assert.throws(() => assertSafeHttpUrl("http://172.16.0.1/"), /SEC_SSRF_PRIVATE_HOST/);
      assert.throws(() => assertSafeHttpUrl("http://169.254.169.254/latest/meta-data"), /SEC_SSRF_PRIVATE_HOST/);
    });

    it("rejects IPv6 loopback and link-local", () => {
      assert.throws(() => assertSafeHttpUrl("http://[::1]/"), /SEC_SSRF_PRIVATE_HOST/);
      assert.throws(() => assertSafeHttpUrl("http://[fe80::1]/"), /SEC_SSRF_PRIVATE_HOST/);
    });

    it("rejects .local mDNS hostnames", () => {
      assert.throws(() => assertSafeHttpUrl("http://printer.local/"), /SEC_SSRF_PRIVATE_HOST/);
    });

    it("does not reject a public hostname that merely contains a blocked substring", () => {
      // Must match the FULL hostname, not substring — "10.example.com" is public.
      assert.doesNotThrow(() => assertSafeHttpUrl("https://10.example.com/docs"));
    });
  });

  describe("slugifyUrl", () => {
    it("produces a lowercase, hyphenated slug from hostname + path", () => {
      const slug = slugifyUrl(new URL("https://Example.com/Docs/Getting-Started"));
      assert.match(slug, /^example-com-docs-getting-started-[0-9a-f]{8}$/);
    });

    it("is deterministic for the same URL", () => {
      const a = slugifyUrl(new URL("https://example.com/docs?x=1"));
      const b = slugifyUrl(new URL("https://example.com/docs?x=1"));
      assert.strictEqual(a, b);
    });

    it("differs for URLs that share a path but differ only in query string", () => {
      const a = slugifyUrl(new URL("https://example.com/docs?v=1"));
      const b = slugifyUrl(new URL("https://example.com/docs?v=2"));
      assert.notStrictEqual(a, b, "the hash suffix must be derived from the full URL, including the query string");
    });

    it("falls back to 'page' when hostname+path has no alphanumeric characters", () => {
      const slug = slugifyUrl(new URL("https://example.com/"));
      assert.match(slug, /^example-com-[0-9a-f]{8}$/);
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build
```
Expected failure: `error TS2307: Cannot find module '../tools/browse-url.js' or its corresponding type declarations.` (the module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

```typescript
// /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tools/browse-url.ts
import { createHash } from "node:crypto";

/**
 * Literal hostname/IP-range denylist for `workspace_browse`'s SSRF guard. This
 * is NOT a DNS-resolution-based defense — a hostname that resolves to a
 * private address only after this check (DNS rebinding) is not caught. Stated,
 * not hidden, matching this codebase's own convention for real limitations
 * (see SEMANTIC_UNAVAILABLE_NOTICE in packages/core/src/services/intelligence.ts).
 * Matches against the FULL hostname only, never a substring, so a public
 * domain that happens to start with a blocked octet (e.g. "10.example.com")
 * is never falsely rejected.
 */
const BLOCKED_HOSTNAME_PATTERNS: readonly RegExp[] = [
  /^localhost$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^\[?fc[0-9a-f]{2}:/,
  /^\[?fe80:/,
  /\.local$/,
];

/**
 * SSRF guard for `workspace_browse`: the URL is agent/model-supplied and
 * reaches a server-side fetch (OWASP SSRF), so it must be validated as a
 * plain public http(s) URL before anything is fetched.
 */
export function assertSafeHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SEC_SSRF_INVALID_URL: invalid URL '${raw}'.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`SEC_SSRF_SCHEME: invalid URL scheme '${url.protocol}' — only http/https are supported.`);
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(host))) {
    throw new Error(
      `SEC_SSRF_PRIVATE_HOST: invalid target host '${host}' — private, loopback and link-local hosts are blocked.`,
    );
  }

  return url;
}

/**
 * Deterministic filename for an ingested page: a readable slug of
 * `hostname + pathname`, suffixed with a short hash of the FULL url (query
 * string included) so two distinct URLs that happen to share a slug never
 * collide, and re-ingesting the SAME url always resolves to the SAME file
 * (an upsert via `workspace_browse` re-running, not a growing pile of
 * near-duplicates).
 */
export function slugifyUrl(url: URL): string {
  const base = `${url.hostname}${url.pathname}`.toLowerCase();
  const cleaned = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "page";
  const hash = createHash("sha256").update(url.toString()).digest("hex").slice(0, 8);
  return `${cleaned}-${hash}`;
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build && npx mocha --require ../scripts/mocha-test-env.cjs dist/tests/browse-url.test.js
```
Expected: all `browse-url` tests pass (build succeeds, mocha reports the described `it` blocks green).

- [ ] **Step 5: Commit**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS
git add workspace-mcp/src/tools/browse-url.ts workspace-mcp/src/tests/browse-url.test.ts
git commit -m "feat(mcp): add SSRF-safe URL validation and slug derivation for workspace_browse

First building block of the workspace_browse tool: validates that an
agent-supplied URL is a plain public http(s) address (not private/loopback/
link-local) and derives a deterministic filename slug from it."
```

---

### Task 2: HTML → Markdown article extraction

**Files:**
- Create: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tools/browse-extract.ts`
- Test: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/browse-extract.test.ts`
- Modify: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/package.json` (add `@mozilla/readability`, `jsdom`, `turndown` to `dependencies`; `@types/jsdom`, `@types/turndown` to `devDependencies`)

**Interfaces:**
- Consumes: nothing from Task 1 (independent pure module).
- Produces: `extractArticleMarkdown(html: string, sourceUrl: string): { title: string; markdown: string }`, consumed by Task 3's `browse.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/browse-extract.test.ts
import assert from "node:assert";
import { extractArticleMarkdown } from "../tools/browse-extract.js";

const ARTICLE_HTML = `
<html>
  <head><title>Getting Started — Widget Docs</title></head>
  <body>
    <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
    <article>
      <h1>Getting Started</h1>
      <p>Widget is a small library for building things quickly and reliably in
      modern applications, and this guide walks through the essentials that
      every new user needs before writing their first integration.</p>
      <p>Install it with your package manager of choice, then import the
      default export and call it with a configuration object describing the
      target environment, the desired output format, and any plugins you
      would like enabled for this particular build.</p>
      <h2>Configuration</h2>
      <p>Every option has a sensible default, so a minimal configuration is
      often enough to get a working setup, but production deployments
      typically override at least the output directory and the plugin list
      to match their own conventions and existing tooling.</p>
      <pre><code>widget.configure({ output: "dist" });</code></pre>
    </article>
    <footer>Copyright 2026</footer>
  </body>
</html>
`;

describe("browse-extract", () => {
  it("extracts the article title", () => {
    const { title } = extractArticleMarkdown(ARTICLE_HTML, "https://example.com/docs/start");
    assert.match(title, /Getting Started/);
  });

  it("converts the article body to markdown, dropping nav and footer boilerplate", () => {
    const { markdown } = extractArticleMarkdown(ARTICLE_HTML, "https://example.com/docs/start");
    assert.match(markdown, /Widget is a small library/);
    assert.match(markdown, /## Configuration/);
    assert.ok(!markdown.includes("Copyright 2026"), "footer boilerplate must be stripped by Readability");
    assert.ok(!markdown.includes("Home"), "nav links must be stripped by Readability");
  });

  it("renders a code block as a fenced markdown block", () => {
    const { markdown } = extractArticleMarkdown(ARTICLE_HTML, "https://example.com/docs/start");
    assert.match(markdown, /```[\s\S]*widget\.configure/);
  });

  it("throws EXTRACT_EMPTY when the page has no extractable article content", () => {
    const empty = "<html><body><div>just a tiny fragment</div></body></html>";
    assert.throws(() => extractArticleMarkdown(empty, "https://example.com/blank"), /EXTRACT_EMPTY/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build
```
Expected failure: `error TS2307: Cannot find module '../tools/browse-extract.js'` (and, before dependencies are added, also `error TS2307: Cannot find module 'jsdom'`/`'@mozilla/readability'`/`'turndown'` once the implementation file is written but the packages aren't installed yet).

- [ ] **Step 3: Write the minimal implementation**

First add the dependencies. In `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/package.json`, change:

```json
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.0",
    "@context-os/core": "1.13.2"
  },
```
to:

```json
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.0",
    "@context-os/core": "1.13.2",
    "@mozilla/readability": "^0.5.0",
    "jsdom": "^25.0.0",
    "turndown": "^7.2.0"
  },
```

and add to `devDependencies`:

```json
    "@types/jsdom": "^21.1.7",
    "@types/turndown": "^5.0.5",
```

then run `cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm install`.

Then create the implementation:

```typescript
// /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tools/browse-extract.ts
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export interface ExtractedArticle {
  readonly title: string;
  readonly markdown: string;
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

/**
 * Extracts the main-content article from a raw HTML page and converts it to
 * Markdown. Readability strips navigation/ads/boilerplate the same way a
 * reader-mode browser view does; turndown converts the remaining article HTML
 * to Markdown so the ingested page reads (and indexes) like the rest of the
 * workspace's markdown corpus — `parseMarkdownFile` in packages/core only
 * assigns titles/excerpts/tags for `.md` content.
 */
export function extractArticleMarkdown(html: string, sourceUrl: string): ExtractedArticle {
  const dom = new JSDOM(html, { url: sourceUrl });
  const article = new Readability(dom.window.document).parse();

  if (!article || !article.content || article.content.trim().length === 0) {
    throw new Error(`EXTRACT_EMPTY: could not find readable article content at ${sourceUrl}.`);
  }

  const title = (article.title ?? "").trim() || sourceUrl;
  const markdown = turndown.turndown(article.content).trim();

  if (markdown.length === 0) {
    throw new Error(`EXTRACT_EMPTY: readable content at ${sourceUrl} converted to empty markdown.`);
  }

  return { title, markdown };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build && npx mocha --require ../scripts/mocha-test-env.cjs dist/tests/browse-extract.test.js
```
Expected: all `browse-extract` tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS
git add workspace-mcp/package.json workspace-mcp/package-lock.json workspace-mcp/src/tools/browse-extract.ts workspace-mcp/src/tests/browse-extract.test.ts
git commit -m "feat(mcp): add Readability + Turndown article extraction for workspace_browse

Adds @mozilla/readability, jsdom and turndown (confirmed absent from the
whole monorepo) to extract main-content article HTML from a fetched page
and convert it to Markdown, dropping nav/ads/footer boilerplate."
```

---

### Task 3: The `workspace_browse` tool

**Files:**
- Create: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tools/browse.ts`
- Modify: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/tool-behaviour.test.ts` (new `describe("workspace_browse — ...")` block)

**Interfaces:**
- Consumes: `assertSafeHttpUrl`/`slugifyUrl` (Task 1), `extractArticleMarkdown` (Task 2), `validatePath`/`commitOrNotice`/`handleToolError` (existing `../utils.js`), `recordWrite` (existing `../write-audit.js`), `globalIndexer` (existing `@context-os/core`).
- Produces: `registerBrowseTool(server: McpServer): void`, consumed by Task 4's `server.ts` and by Task 5's integration test.

- [ ] **Step 1: Write the failing test**

Append to `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/tool-behaviour.test.ts` (a new top-level `describe` block, after the existing ones, following this file's existing `invoke`/`textOf` helpers already defined above in the file):

```typescript
// Add these two imports to the EXISTING import block at the top of
// tool-behaviour.test.ts (it already imports `fs from "node:fs"`, `path from
// "node:path"`, `McpServer`, and `workspaceRoot` from "../utils.js" — do NOT re-import those,
// only add the two below, e.g. right after the existing
// `import { registerValidateTool } from "../tools/validate.js";` line):
import { registerBrowseTool } from "../tools/browse.js";
import { globalIndexer } from "@context-os/core";

// Then append this new describe block at the end of the file:
describe("workspace_browse — SSRF guard, extraction, and write/index wiring", () => {
  let server: McpServer;
  let originalFetch: typeof globalThis.fetch;
  let originalIndexFile: typeof globalIndexer.indexFile;
  const PROBE_PROJECT = "__browse_probe__";
  const PROBE_DIR = path.join(workspaceRoot, "projects", PROBE_PROJECT);

  beforeEach(() => {
    server = newServer();
    registerBrowseTool(server);
    originalFetch = globalThis.fetch;
    originalIndexFile = globalIndexer.indexFile;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalIndexer.indexFile = originalIndexFile;
    fs.rmSync(PROBE_DIR, { recursive: true, force: true });
  });

  it("rejects a private-host URL before ever calling fetch", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called");
    }) as typeof fetch;

    const res = await invoke(server, "workspace_browse", { url: "http://127.0.0.1/admin", project: PROBE_PROJECT });

    assert.strictEqual(res.isError, true);
    assert.match(textOf(res), /SEC_SSRF_PRIVATE_HOST/);
    assert.strictEqual(fetchCalled, false, "the SSRF guard must run before any network call");
    assert.ok(!fs.existsSync(PROBE_DIR), "nothing may be written for a rejected URL");
  });

  it("rejects a project name containing path-traversal-shaped characters", async () => {
    // NOTE: this test invokes the raw registered handler directly (see `invoke`
    // above), bypassing the MCP SDK's `validateToolInput` zod-parsing step —
    // that step only runs inside `server.setRequestHandler(CallToolRequestSchema, ...)`,
    // a separate code path from `.handler` (confirmed in the installed SDK's
    // `server/mcp.js`). So the zod regex's "must be alphanumeric" message never
    // surfaces here; `../evil` reaches `validatePath("projects/../evil/web/<slug>.md")`
    // directly, which resolves outside every allowed bucket and throws
    // SEC_OUTSIDE_BUCKET — the same pattern already asserted elsewhere in this
    // file (see the "rejects a traversal write that lands inside the root but
    // outside a bucket" test) and in `isolation.test.ts`.
    const res = await invoke(server, "workspace_browse", { url: "https://example.com/docs", project: "../evil" });
    assert.strictEqual(res.isError, true);
    assert.match(textOf(res), /SEC_OUTSIDE_BUCKET/);
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
      new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as typeof fetch;

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
    assert.strictEqual(files.length, 1, `expected exactly one ingested file, found ${files.join(", ")}`);

    const content = fs.readFileSync(path.join(written, files[0]), "utf-8");
    assert.match(content, /^---\n/, "must start with YAML frontmatter");
    assert.match(content, /title: "Widget Changelog"/);
    assert.match(content, /source: "https:\/\/example\.com\/changelog"/);
    assert.match(content, /tags: \["web-import"\]/);
    assert.match(content, /completely rewritten configuration loader/);

    assert.ok(indexedPath, "globalIndexer.indexFile must be called after the write");
    assert.strictEqual(indexedPath, path.join(written, files[0]));
  });

  it("reports FETCH_FAILED on a non-2xx response and writes nothing", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    const res = await invoke(server, "workspace_browse", { url: "https://example.com/gone", project: PROBE_PROJECT });
    assert.strictEqual(res.isError, true);
    assert.match(textOf(res), /FETCH_FAILED/);
    assert.ok(!fs.existsSync(PROBE_DIR));
  });

  it("reports FETCH_NOT_HTML for a non-HTML content-type and writes nothing", async () => {
    globalThis.fetch = (async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const res = await invoke(server, "workspace_browse", { url: "https://example.com/api", project: PROBE_PROJECT });
    assert.strictEqual(res.isError, true);
    assert.match(textOf(res), /FETCH_NOT_HTML/);
    assert.ok(!fs.existsSync(PROBE_DIR));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build
```
Expected failure: `error TS2307: Cannot find module '../tools/browse.js'`.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tools/browse.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "node:path";
import { globalIndexer } from "@context-os/core";
import { validatePath, commitOrNotice, handleToolError } from "../utils.js";
import { recordWrite } from "../write-audit.js";
import { assertSafeHttpUrl, slugifyUrl } from "./browse-url.js";
import { extractArticleMarkdown } from "./browse-extract.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_BYTES = 5_000_000;

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildMarkdownDocument(title: string, sourceUrl: string, fetchedAt: string, body: string): string {
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

export function registerBrowseTool(server: McpServer) {
  server.tool(
    "workspace_browse",
    {
      url: z.string().min(1).describe("HTTP(S) URL of the external page to ingest (docs, changelog, etc.)"),
      project: z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/, "project must be alphanumeric, '-' or '_' only")
        .describe("Project the page is filed under; stored at projects/<project>/web/"),
    },
    async ({ url: rawUrl, project }) => {
      try {
        const safeUrl = assertSafeHttpUrl(rawUrl);
        const slug = slugifyUrl(safeUrl);
        const relativePath = `projects/${project}/web/${slug}.md`;
        const { fullPath } = validatePath(relativePath);

        const response = await fetch(safeUrl, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "follow",
        });

        if (!response.ok) {
          throw new Error(`FETCH_FAILED: ${safeUrl} returned HTTP ${response.status}.`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("html")) {
          throw new Error(`FETCH_NOT_HTML: expected an HTML page, got content-type '${contentType}'.`);
        }

        const contentLength = Number(response.headers.get("content-length") ?? "0");
        if (contentLength > MAX_FETCH_BYTES) {
          throw new Error(
            `FETCH_TOO_LARGE: ${safeUrl} is ${contentLength} bytes, over the ${MAX_FETCH_BYTES}-byte cap.`,
          );
        }

        let html = await response.text();
        if (html.length > MAX_FETCH_BYTES) {
          html = html.slice(0, MAX_FETCH_BYTES);
        }

        const { title, markdown } = extractArticleMarkdown(html, safeUrl.toString());
        const fetchedAt = new Date().toISOString();
        const document = buildMarkdownDocument(title, safeUrl.toString(), fetchedAt, markdown);

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, document, "utf-8");

        const unrecorded = recordWrite({
          tool: "workspace_browse",
          fullPath,
          mode: "replace",
          bytes: Buffer.byteLength(document, "utf-8"),
        });

        const uncommitted = await commitOrNotice(fullPath, `feat(mcp): ingest ${safeUrl} into ${relativePath}`);

        let indexNotice = "";
        try {
          await globalIndexer.indexFile(fullPath);
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          indexNotice =
            `\nWARNING [unindexed]: the page is on disk and recorded, but indexing failed (${reason}). ` +
            `Run context-os sync to repair.`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Ingested "${title}" from ${safeUrl} into ${relativePath}${unrecorded}${uncommitted}${indexNotice}`,
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
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build && npx mocha --require ../scripts/mocha-test-env.cjs dist/tests/tool-behaviour.test.js
```
Expected: all `tool-behaviour.test.ts` suites pass, including the new `workspace_browse` block, and no `projects/__browse_probe__` directory remains on disk afterward.

- [ ] **Step 5: Commit**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS
git add workspace-mcp/src/tools/browse.ts workspace-mcp/src/tests/tool-behaviour.test.ts
git commit -m "feat(mcp): add workspace_browse tool — fetch, extract, write, index

Ingests an external docs/changelog page into projects/<project>/web/ as
Markdown with YAML frontmatter, following the same validatePath +
recordWrite + commitOrNotice convention as workspace_log_decision and
workspace_memory_update, then calls globalIndexer.indexFile() so the page
is immediately keyword-searchable via workspace_search."
```

---

### Task 4: Enforcement classification and server wiring

**Files:**
- Modify: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/server.ts`
- Modify: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/enforcement-actions.ts`
- Modify: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/enforcement.test.ts`

**Interfaces:**
- Consumes: `registerBrowseTool` (Task 3).
- Produces: nothing new — this task only wires an existing export into the boot path and the trust-boundary classification tables so the existing `enforcement.test.ts` assertions (which already exist and already run) pass against a server that now has 39 tools instead of 38.

- [ ] **Step 1: Write the failing test**

`enforcement.test.ts` already contains the exact assertions this task must satisfy — no new test file is needed, only the following edits to the *existing* test (this IS the "test-first" step: the edit encodes the new expected state before the source is changed to match it):

In `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/enforcement.test.ts`, change:

```typescript
import { registerPredictiveTools } from "../tools/predictive.js";
import { registerResources } from "../resources.js";
```
to:

```typescript
import { registerPredictiveTools } from "../tools/predictive.js";
import { registerBrowseTool } from "../tools/browse.js";
import { registerResources } from "../resources.js";
```

and change the `REGISTRARS` array's closing tail:

```typescript
  registerIntelligenceStreamTools,
  registerPredictiveTools,
]);
```
to:

```typescript
  registerIntelligenceStreamTools,
  registerPredictiveTools,
  registerBrowseTool,
]);
```

and change both hardcoded counts:

```typescript
    it("pins the live tool count at 38 (mcp.json's 17 is stale)", () => {
      assert.strictEqual(liveToolNames().length, 38);
      assert.strictEqual(Object.keys(TOOL_ACTIONS).length, 38);
    });
```
to:

```typescript
    it("pins the live tool count at 39 (mcp.json's 17 is stale)", () => {
      assert.strictEqual(liveToolNames().length, 39);
      assert.strictEqual(Object.keys(TOOL_ACTIONS).length, 39);
    });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build && npx mocha --require ../scripts/mocha-test-env.cjs dist/tests/enforcement.test.js
```
Expected failure: `these registered tools are missing from TOOL_ACTIONS (they would default to 'write'): workspace_browse` (from the "classifies every live tool as read or write" test) and a count mismatch (`39 !== 38`) on the pinned-count test.

- [ ] **Step 3: Write the minimal implementation**

In `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/enforcement-actions.ts`, change the doc comment and add the entry (alphabetically, matching the existing sort order):

```typescript
/**
 * Every registered tool MUST appear here. An unlisted tool is treated as
 * `write` (fail closed) AND reported loudly by `auditClassificationCoverage` at
 * boot, so adding a tool without classifying it is noisy rather than silently
 * unguarded.
 *
 * Derived from the 39 live `server.tool("name"` registrations in `src/tools/`,
 * NOT from `mcp.json` (stale at 17) — `enforcement.test.ts` asserts the map and
 * the live registration list agree exactly, in both directions.
 */
export const TOOL_ACTIONS: Readonly<Record<string, ToolAction>> = Object.freeze({
```

and, in the `// ── write ──` section, insert (before `workspace_daily_update`, after `swarm_spawn`):

```typescript
  swarm_spawn: "write",
  // Fetches an external page and writes it under projects/<project>/web/.
  workspace_browse: "write",
  workspace_daily_update: "write",
```

In `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/server.ts`, add the import next to the other tool imports:

```typescript
import { registerWriteTool } from "./tools/write.js";
import { registerBrowseTool } from "./tools/browse.js";
```

and register it next to `registerWriteTool(server);`:

```typescript
  registerWriteTool(server);
  registerBrowseTool(server);
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build && npx mocha --require ../scripts/mocha-test-env.cjs dist/tests/enforcement.test.js dist/tests/registration-coverage.test.js
```
Expected: all tests in both files pass, including "pins the live tool count at 39", "classifies every live tool as read or write, with no stale entries", and `registration-coverage.test.ts`'s "classifies every request-bearing method a fully exercised server dispatches" (unaffected by this change, but must stay green since `server.ts` now constructs one more tool at boot).

- [ ] **Step 5: Commit**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS
git add workspace-mcp/src/server.ts workspace-mcp/src/enforcement-actions.ts workspace-mcp/src/tests/enforcement.test.ts
git commit -m "feat(mcp): wire workspace_browse into the server and trust boundary

Registers the new tool in server.ts and classifies it as 'write' in
TOOL_ACTIONS so the enforcement gate evaluates it like every other
mutating tool; updates enforcement.test.ts's pinned registrar list and
live-tool-count assertions from 38 to 39."
```

---

### Task 5: End-to-end proof — ingest then search finds it, with no changes to search.ts

**Files:**
- Create: `/Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/browse-ingest-search.test.ts`

**Interfaces:**
- Consumes: `registerBrowseTool` (Task 3), `registerSearchTool` (existing `../tools/search.js`), `globalIndexer.removeFile` (existing `@context-os/core`, used only for test cleanup).
- Produces: nothing new — this is the plan's proof of the core claim from the Spec section: a page ingested via `workspace_browse` is found by `workspace_search` with zero changes to `search.ts`, because `intelligenceService.search()` reads the same SQLite `documents`/`fts_documents` tables that `globalIndexer.indexFile()` (called by `browse.ts`) writes into.

- [ ] **Step 1: Write the failing test**

```typescript
// /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp/src/tests/browse-ingest-search.test.ts
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { globalIndexer } from "@context-os/core";
import { registerBrowseTool } from "../tools/browse.js";
import { registerSearchTool } from "../tools/search.js";
import { workspaceRoot } from "../utils.js";

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

async function invoke(server: McpServer, name: string, args: unknown): Promise<ToolResult> {
  const registry = (server as unknown as {
    _registeredTools: Record<string, { handler: (...a: unknown[]) => unknown }>;
  })._registeredTools;
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

  beforeEach(() => {
    server = newServer();
    registerBrowseTool(server);
    registerSearchTool(server);
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (indexedRelativePath) {
      await globalIndexer.removeFile(indexedRelativePath).catch(() => {});
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
      new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;

    const browseRes = await invoke(server, "workspace_browse", {
      url: "https://example.com/runbooks/deployment",
      project: PROBE_PROJECT,
    });
    assert.strictEqual(browseRes.isError, false, textOf(browseRes));

    const webDir = path.join(PROBE_DIR, "web");
    const [file] = fs.readdirSync(webDir);
    indexedRelativePath = path.relative(workspaceRoot, path.join(webDir, file));

    const searchRes = await invoke(server, "workspace_search", { query: NEEDLE, limit: 5 });
    // search.ts's success branch (non-empty results) explicitly returns
    // `isError: false as const` — only the zero-results branch leaves it
    // undefined. Since this test's whole point is that the search DOES find
    // results, assert `false`, not `undefined`.
    assert.strictEqual(searchRes.isError, false, textOf(searchRes));

    const out = textOf(searchRes);
    assert.ok(
      out.includes(indexedRelativePath.replace(/\\/g, "/")) || out.includes(NEEDLE),
      `expected workspace_search to surface the freshly-ingested page; got:\n${out}`,
    );
    assert.ok(!out.includes("No results found."), "the ingested page must be found, not report zero results");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build && npx mocha --require ../scripts/mocha-test-env.cjs dist/tests/browse-ingest-search.test.js
```
Expected failure before Tasks 1–3 exist: `error TS2307: Cannot find module '../tools/browse.js'`. If run *after* Tasks 1–4 are already done (the realistic order), this test should already pass — in that case, temporarily comment out the `await globalIndexer.indexFile(fullPath);` call in `browse.ts` and re-run to observe the genuine failure mode this test guards against: `assert.ok(...)` fails with `"No results found."` in the output, proving the test actually exercises the indexing step and is not vacuously true. Restore the line afterward.

- [ ] **Step 3: Write the minimal implementation**

No new implementation code — Tasks 1 through 4 are the implementation. This step is confirming there is nothing left to write: `browse.ts` already calls `globalIndexer.indexFile(fullPath)` (Task 3, Step 3) and `search.ts` already exists unmodified. If this test fails for any reason other than the deliberate sabotage in Step 2, that is a real defect in Task 3's implementation to fix now (most likely candidates: `indexFile` not awaited, `fullPath` mismatch, or the FTS5 query needing the needle phrase's exact casing/tokenization — check `dbService.searchHybrid`'s FTS5 query construction in `packages/core/src/database/` if so).

- [ ] **Step 4: Run it and confirm it passes**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS/workspace-mcp && npm run build && npm test
```
Expected: the full suite passes, including `browse-ingest-search.test.ts`, and no `projects/__browse_search_probe__` directory remains on disk afterward.

- [ ] **Step 5: Commit**

```bash
cd /Users/sairamugge/Desktop/Not-Humans-World/ContextOS
git add workspace-mcp/src/tests/browse-ingest-search.test.ts
git commit -m "test(mcp): prove workspace_browse ingests are immediately searchable

End-to-end test against the real SQLite documents/fts_documents tables:
ingests a page with a distinctive needle phrase via workspace_browse,
then finds it via workspace_search with zero changes to search.ts —
confirming the two tools are coupled only through globalIndexer.indexFile()
and the documents_ai FTS5 trigger, not through any new code path."
```
