# Repository Guidelines

ContextOS is a TypeScript monorepo (Turborepo + npm workspaces) providing an intelligence layer for autonomous AI agents. It publishes three npm packages (`core`, `cli`, `mcp`) and ships one private dashboard app.

## Project Structure & Module Organization

Four workspaces under one root (`package.json` `workspaces`):

- **`packages/core`** (`@context-os/core`) — Shared intelligence: SQLite indexer + vector search (`better-sqlite3` + sqlite-vec), embeddings (@xenova/transformers), tree-sitter parsing, schema validation (Ajv), resilience and orchestration.
- **`workspace-cli`** (`@context-os/cli`) — Terminal interface (`context-os` binary). Commands in `src/commands/` (Commander, Chalk, Ora).
- **`workspace-mcp`** (`@context-os/mcp`) — Model Context Protocol server (`context-os-mcp` binary). Dual transport: stdio (default, `server.ts`) and HTTP/SSE (`server-http.ts`). Tools in `src/tools/`.
- **`workspace-dashboard`** (private) — React 19 + Vite + Tailwind v4 + Three.js spatial UI (Aether HUD). Not published.

Build order: Core -> CLI/MCP/Dashboard (Turbo resolves via `^build`). CLI and MCP import core's built `dist/`, so **rebuild core before they see new exports**.

### Core Internal Architecture

The core package wires services through a **dependency injection container** (`src/container/`): `container.ts` (scoped resolution), `tokens.ts` (~45 typed `Symbol` injection keys), `defaults.ts` (default graph). `factory.ts` exposes `createContextOS()`, re-exported from `src/index.ts`. New modules register in the default container and export from `src/index.ts`.

Subsystems (each a `src/` subdirectory):

- **`events/`** — `WorkspaceEventBus`, typed payloads, error-isolated handlers (one failure does not cascade).
- **`agents/`** — `AgentRegistry` (lifecycle, heartbeat, stale quarantine) + `MessageBus` (direct/broadcast/correlation).
- **`orchestration/`** — `TaskGraph` (DAG/cycle detection), `TaskScheduler`, `ConflictResolver` (read/write lock upgrades), `SwarmOrchestrator`, consensus + negotiation.
- **`resilience/`** — `CircuitBreaker`, Merkle-linked `AuditLog`, predictive-failure (CUSUM change-point detection).
- **`cognitive/`** — memory stream, reflection, skill library, LATS tree search.
- **`governance/`** — capability tokens, trust scoring, policy engine, anomaly detection.
- **`streaming/`** — CEP event processing, predictive health, knowledge distillation, hierarchical memory.
- **`services/`** — domain services: `git-intelligence`, `fusion-scoring`, `graph-rag`, `temporal-graph`, `knowledge-graph`, `embedding`, `locking`, `mission`, `repair`, etc.
- **`database/`** + **`metrics/`** — SQLite schema/vectors; Prometheus metrics export.

## Build, Test, and Development Commands

```bash
npm run build          # Turbo: tsc for core/cli/mcp, tsc+vite for dashboard
npm run test           # Turbo: mocha (core/cli/mcp); vitest (dashboard)
npm run validate       # Turbo: build + workspace validation (uncached)
npm run sync:assets    # Copy templates to dist (scripts/sync-templates.js)
npm run link:all       # Build + npm link cli and mcp for local dev
```

Per-workspace:

```bash
cd workspace-dashboard && npm run dev    # Vite dev server
cd workspace-dashboard && npm run lint   # ESLint (dashboard only)
cd workspace-cli && npm run watch        # tsc watch mode
cd workspace-mcp && npm run watch        # tsc watch mode
```

Run a single test (Mocha workspaces compile to `dist/` first):

```bash
cd packages/core && npx mocha dist/tests/some-file.test.js
cd packages/core && npx mocha 'dist/tests/**/*.test.js' --grep "circuit breaker"
```

Coverage (core only): `cd packages/core && npm run test:coverage` (c8, text + lcov).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | No | AI embeddings/repairs. Without it, local transformers are used. |
| `CONTEXTOS_LOG_LEVEL` | No | `debug` / `info` / `warn` / `error`. Defaults to `info`. |
| `MCP_AUTH_TOKEN` | For HTTP | Bearer token for MCP HTTP transport. |
| `MCP_HTTP_PORT` | No | MCP HTTP port. Defaults to `3001`. |
| `MCP_CORS_ORIGINS` | No | Comma-separated CORS origins for MCP HTTP. |

## Coding Style & Naming Conventions

- **ESM only** — every package is `"type": "module"` with `NodeNext` resolution.
- **TypeScript strict** — `"strict": true` across all tsconfigs; target `ESNext`.
- **ESLint** — dashboard only (`eslint.config.js`: `typescript-eslint`, `react-hooks`, `react-refresh`), enforced at zero warnings via lint-staged.
- **No shared formatter** — no Prettier or `.editorconfig` in the repo.
- **Immutability preferred** — create new objects; avoid in-place mutation.
- **Spawn over exec** — use `spawn` for subprocesses to prevent shell injection.

## Testing Guidelines

- **Frameworks**: Mocha + Chai (core, cli, mcp); Vitest (dashboard).
- Mocha tests live in `src/tests/` as `.ts` and run from `dist/tests/` after build.
- Core tests use per-test temp databases (`.context-db-test-*` — gitignored).
- Integration tests may need extended timeouts (5000ms) for full-workspace scans.

## Agent Teams & Sub-Agent Delegation

How AI agent teams (Claude Code sub-agents, Cursor background agents, or any multi-agent system) should divide work on this codebase.

### Agent Routing by Scope

| Agent Role | Scope | Files Touched | Model Tier |
|------------|-------|---------------|------------|
| **Architect** | System design, DI container, new subsystem planning | `packages/core/src/container/`, `docs/architecture.md` | Opus |
| **Core Engineer** | Core logic: orchestration, resilience, cognitive, governance, streaming, services | `packages/core/src/**` | Sonnet/Opus |
| **CLI Developer** | Commands, flags, output formatting | `workspace-cli/src/**` | Sonnet |
| **MCP Developer** | Tools, transports, protocol compliance | `workspace-mcp/src/**` | Sonnet |
| **Dashboard Dev** | React components, Three.js scenes, Tailwind | `workspace-dashboard/src/**` | Sonnet |
| **Test Engineer** | Coverage, regression tests, test infra | `*/src/tests/**` | Sonnet |
| **Security Reviewer** | Auth, input validation, injection, secrets | Any auth/PII/upload file | Opus |
| **Release Manager** | Version bumps, CHANGELOG, publish pipeline | `package.json` (all), `CHANGELOG.md` | Haiku/Sonnet |

### Parallel Execution Rules

```
PARALLEL OK:
  - CLI agent + MCP agent (different workspaces, no shared source)
  - Test engineer + Dashboard dev (no file overlap)
  - Core engineer (events/) + Core engineer (orchestration/) — different subdirs

SEQUENTIAL REQUIRED:
  - Core changes -> then CLI/MCP updates (they import core dist/)
  - Schema changes -> then validation updates -> then tests
  - Any architect decision -> then implementation agents
```

### Sub-Agent Boot Protocol

Every sub-agent MUST, before writing code:

1. **Read `AGENTS_LEARNING.md`** — avoid repeating past mistakes.
2. **Read this file (`AGENTS.md`)** — understand scope and conventions.
3. **Build core first** if touching core: `npm run build -w @context-os/core`.
4. **Run existing tests** in scope before modifying.
5. **After completing work**: update `AGENTS_LEARNING.md` with new learnings.

### Task Handoff Format

```markdown
## Task: [brief title]
- **Scope**: [workspace/directory]
- **Files**: [specific paths to read/modify]
- **Depends on**: [other agent outputs, if any]
- **Acceptance**: [verify command or behavior check]
```

### Conflict Avoidance

- Each agent works only in its designated workspace/subdirectory.
- Cross-workspace changes are sequenced by the **orchestrating agent**.
- Never modify `packages/core/src/index.ts` exports without coordinating — all workspaces depend on it.
- `package-lock.json` is modified by only one agent per session.

### Review Chain

After implementation, route in order: **Code Reviewer** (correctness, immutability) -> **Security Reviewer** (if auth/PII/uploads/env-vars, auto-triggered) -> **Test Analyzer** (coverage, regression).

## Version & Release Protocol

**Strict version parity**: all four `package.json` files (root, core, cli, mcp) share one version (currently `1.13.2`). CLI and MCP pin `@context-os/core` to the exact version. Publish order: **Core -> CLI -> MCP** (sequential), triggered by pushing a `v*` tag (`publish.yml`).

Prerequisites: Node 22+, npm 11+, C++ toolchain (native SQLite compilation).

## Git Hooks & CI

- **Husky `pre-commit`** runs `npx lint-staged`: per-package `tsc --noEmit --skipLibCheck` (core/cli/mcp) and dashboard ESLint (`--max-warnings=0`) + `tsc -b`. Run `npm run prepare` after a fresh clone to install hooks.
- **Husky `pre-push`** runs `npm run validate` (full build + validation).
- **GitHub Actions** (`.github/workflows/`):
  - `validate.yml` — build + test + validate on PRs/pushes; test matrix **Node 20 and 22**.
  - `security.yml` — CodeQL, dependency-review, OSSF Scorecard; weekly cron + PR/push.
  - `publish.yml` — npm publish on `v*` tags (Core -> CLI -> MCP).
  - `preview-deploy.yml` / `preview-cleanup.yml` — ephemeral PR preview deploys + teardown.
  - `bundle-analysis.yml` — dashboard bundle-size report (sticky PR comment).
  - `release-preview.yml` — next-version preview via semantic-release.
  - `docs.yml` — build + publish docs (gh-pages) on push / manual dispatch.

## Commit Conventions

Conventional Commits with scoped prefixes:

```text
feat(scope): description      # New functionality
fix(scope): description       # Bug fixes
test(scope): description      # Adding/updating tests
perf(scope): description      # Performance improvements
refactor(scope): description  # Restructuring without behavior change
docs: description             # Documentation only
chore: description            # Tooling, deps, config
ci: description               # CI/workflow changes
```

Scopes are workspace or subsystem names: `core`, `cli`, `mcp`, `dashboard`, `governance`, `streaming`, `predictive`, `swarm`, `temporal`. Omit scope for cross-cutting changes.
