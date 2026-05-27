# Repository Guidelines

ContextOS is a TypeScript monorepo (Turborepo) providing an intelligence layer for AI agents. It publishes three npm packages and a private dashboard app.

## Project Structure & Module Organization

Four workspaces under one root:

- **`packages/core`** (`@context-os/core`) — Shared intelligence: SQLite indexer, vector search (sqlite-vec), ML embeddings (@xenova/transformers), tree-sitter code parsing, schema validation (Ajv), resilience patterns.
- **`workspace-cli`** (`@context-os/cli`) — Terminal interface (`context-os` binary). Commands live in `src/commands/`. Uses Commander, Chalk, Ora.
- **`workspace-mcp`** (`@context-os/mcp`) — Model Context Protocol server (`context-os-mcp` binary). Dual transport: stdio (default) and HTTP/SSE (`server-http.ts`). MCP tools in `src/tools/`.
- **`workspace-dashboard`** (private) — React 19 + Vite + Tailwind v4 + Three.js spatial visualization (Aether HUD). Not published.

Build order: Core -> CLI/MCP/Dashboard (Turbo handles dependency graph via `^build`).

### Core Internal Architecture (v2)

The core package uses a **dependency injection container** (`src/container/`) with typed tokens for all services. Key subsystems:

- **`container/`** — `ServiceContainer` with scoped resolution; `tokens.ts` defines injection keys; `defaults.ts` wires the default graph.
- **`events/`** — `WorkspaceEventBus` with typed event payloads. Handlers are error-isolated (one failing handler does not cascade).
- **`agents/`** — `AgentRegistry` (lifecycle management) + `MessageBus` (direct/broadcast/correlation messaging).
- **`orchestration/`** — `TaskGraph` (DAG validation, cycle detection), `TaskScheduler` (dependency-aware assignment), `ConflictResolver` (read/write lock upgrades).
- **`resilience/`** — `CircuitBreaker` (open/half-open/closed states) + Merkle-linked `AuditLog`.

All new modules register themselves in the default container and export from `src/index.ts`.

## Build, Test, and Development Commands

```bash
npm run build          # Turbo: tsc for core/cli/mcp, tsc+vite for dashboard
npm run test           # Turbo: mocha (core/cli/mcp only)
npm run validate       # Turbo: build + workspace-specific validation (uncached)
npm run sync:assets    # Copy templates to dist
npm run link:all       # Build + npm link cli and mcp for local dev
```

Per-workspace:

```bash
cd workspace-dashboard && npm run dev      # Vite dev server
cd workspace-dashboard && npm run lint     # ESLint (dashboard only)
cd workspace-cli && npm run watch          # tsc watch mode
cd workspace-mcp && npm run watch          # tsc watch mode
cd workspace-mcp && npm run mcp:stdio      # Run MCP server (stdio transport)
cd workspace-mcp && npm run mcp:http       # Run MCP server (HTTP/SSE on port 3001)
```

Run a single test file:

```bash
cd packages/core && npx mocha dist/tests/some-file.test.js
```

Coverage (core only):

```bash
cd packages/core && npm run test:coverage  # c8 with text + lcov reporters
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | No | AI-powered embeddings and repairs. Without it, local transformers are used. |
| `CONTEXTOS_LOG_LEVEL` | No | `debug` / `info` / `warn` / `error`. Defaults to `info`. |
| `MCP_AUTH_TOKEN` | For HTTP | Bearer token for MCP HTTP transport authentication. |
| `MCP_HTTP_PORT` | No | MCP HTTP server port. Defaults to `3001`. |
| `MCP_CORS_ORIGINS` | No | Comma-separated CORS origins for MCP HTTP. |

## Coding Style & Naming Conventions

- **ESM only** — all packages use `"type": "module"` with `NodeNext` module resolution.
- **TypeScript strict mode** — `"strict": true` across all tsconfigs. Target: `ESNext`.
- **ESLint** — configured for the dashboard only (`eslint.config.js`): `typescript-eslint`, `react-hooks`, `react-refresh`.
- **No shared formatter config** — no Prettier dotfile in the repo.
- **Immutability preferred** — create new objects, avoid in-place mutation.
- **Spawn over exec** — use `spawn` for subprocess calls to prevent shell injection.

## Testing Guidelines

- **Framework**: Mocha + Chai (core, cli, mcp).
- Tests must compile first — they live in `src/tests/` as `.ts` and run from `dist/tests/` after build.
- Core tests use per-test temp databases (`.context-db-test-*` dirs — gitignored).
- Integration tests may need extended timeouts (5000ms) for full-workspace scans.
- The dashboard has no test suite.

## Agent Teams & Sub-Agent Delegation

This section defines how AI agent teams (Claude Code sub-agents, Cursor background agents, or any multi-agent system) should divide and execute work on this codebase.

### Agent Routing by Scope

| Agent Role | Scope | Files Touched | Model Tier |
|------------|-------|---------------|------------|
| **Architect** | System design, DI container changes, new subsystem planning | `packages/core/src/container/`, `docs/architecture.md` | Opus |
| **Core Engineer** | Business logic in core: orchestration, resilience, agents, events | `packages/core/src/**` | Sonnet/Opus |
| **CLI Developer** | Commands, flags, shell completion, output formatting | `workspace-cli/src/**` | Sonnet |
| **MCP Developer** | Tools, transports, protocol compliance, session management | `workspace-mcp/src/**` | Sonnet |
| **Dashboard Dev** | React components, Three.js scenes, Tailwind styling | `workspace-dashboard/src/**` | Sonnet |
| **Test Engineer** | Test coverage, regression tests, test infra | `*/src/tests/**` | Sonnet |
| **Security Reviewer** | Auth, input validation, injection vectors, secret handling | Any file touching auth/PII/uploads | Opus |
| **Release Manager** | Version bumps, CHANGELOG, publish pipeline | `package.json` (all), `CHANGELOG.md`, `release.sh` | Haiku/Sonnet |

### Parallel Execution Rules

Launch agents simultaneously when their scopes are independent:

```
PARALLEL OK:
  - CLI agent + MCP agent (different workspaces, no shared source)
  - Test engineer + Dashboard dev (no file overlap)
  - Core engineer (events/) + Core engineer (orchestration/) — different subdirs

SEQUENTIAL REQUIRED:
  - Core changes → then CLI/MCP updates (they import from core dist/)
  - Schema changes → then validation updates → then tests
  - Any architect decision → then implementation agents
```

### Sub-Agent Boot Protocol

Every sub-agent MUST follow this sequence before writing code:

1. **Read `AGENTS_LEARNING.md`** — avoid repeating past mistakes
2. **Read this file (`AGENTS.md`)** — understand scope and conventions
3. **Build core first** if touching core: `npm run build -w packages/core`
4. **Run existing tests** in your scope before modifying code
5. **After completing work**: update `AGENTS_LEARNING.md` with new learnings

### Task Handoff Format

When delegating to a sub-agent, provide:

```markdown
## Task: [brief title]
- **Scope**: [workspace/directory]
- **Files**: [specific paths to read/modify]
- **Depends on**: [other agent outputs, if any]
- **Acceptance**: [how to verify — test command or behavior check]
```

### Conflict Avoidance

- Each agent works in its designated workspace/subdirectory only
- If a task requires cross-workspace changes, the **orchestrating agent** sequences them
- Never modify `packages/core/src/index.ts` exports without coordinating — all workspaces depend on it
- Lock files (`package-lock.json`) should only be modified by one agent per session

### Review Chain

After implementation, route through these agents in order:

1. **Code Reviewer** — correctness, style, immutability, no mutations
2. **Security Reviewer** — if touching auth/PII/uploads/env-vars (auto-triggered)
3. **Test Analyzer** — coverage check, regression scan

## Version & Release Protocol

**Strict version parity**: all four `package.json` files (root, core, cli, mcp) must share the same version. CLI and MCP pin `@context-os/core` to the exact version.

Publish order (CI and manual): **Core -> CLI -> MCP** (sequential). Triggered by pushing a `v*` tag. CI runs on Node 22.

Prerequisites: Node 22+, npm 11+, C++ toolchain (for native SQLite compilation).

## Git Hooks & CI

- **Husky pre-commit + pre-push**: both run `npm run validate`. Run `npm run prepare` after fresh clone to install hooks.
- **GitHub Actions**: PR validation (`validate.yml` on PRs to main) and tag-based npm publish (`publish.yml` on `v*` tags).

## Commit Conventions

Conventional commits with scoped prefixes:

```text
feat(core): description       # New functionality
fix(core): description        # Bug fixes
test(core): description       # Adding/updating tests
perf(core): description       # Performance improvements
refactor(core): description   # Restructuring without behavior change
docs: description             # Documentation only
chore: description            # Tooling, deps, config
```

Scopes match workspace names: `core`, `dashboard`, `cli`, `mcp`. Omit scope for cross-cutting changes.
