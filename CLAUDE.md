# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ContextOS is a TypeScript monorepo (Turborepo + npm workspaces, ESM-only, all packages `"type": "module"`) that publishes an intelligence layer for autonomous AI agents — three npm packages (`@context-os/core`, `@context-os/cli`, `@context-os/mcp`) plus a private React dashboard. The same repo root is *also* a live, file-first context workspace (`root/`, `orgs/`, `projects/`, `knowledge/`, `config/`) — the exact data shape the product indexes. Treat code dirs and data dirs as two different domains.

## Commands

All from real scripts. Root scripts run via Turbo (caches; resolves cross-workspace `^build` order).

```bash
npm run build          # turbo run build  — tsc for core/cli/mcp, tsc -b + vite for dashboard
npm run test           # turbo run test   — mocha (core/cli/mcp), vitest (dashboard)
npm run validate       # turbo run validate -- (uncached) — build + per-workspace validation
npm run sync:assets    # node scripts/sync-templates.js — copy CLI templates into dist
npm run link:all       # build + npm link -w @context-os/cli and -w @context-os/mcp
```

Per-workspace (run from the workspace dir):

```bash
cd workspace-dashboard && npm run dev        # vite dev server
cd workspace-dashboard && npm run lint       # eslint .  (ONLY workspace with a linter)
cd workspace-cli  && npm run watch           # tsc -w
cd workspace-mcp  && npm run mcp:stdio       # node dist/index.js (stdio transport)
cd workspace-mcp  && npm run mcp:http        # node dist/server-http.js (HTTP/SSE transport)
```

Single test — **core/cli/mcp compile `src/tests/*.ts` to `dist/tests/` first**, so build before targeting a file:

```bash
npm run build -w @context-os/core
cd packages/core && npx mocha dist/tests/container.test.js               # one file
cd packages/core && npx mocha 'dist/tests/**/*.test.js' --grep "circuit" # by name
cd workspace-dashboard && npx vitest run src/path/Foo.test.tsx           # dashboard (no build step; vitest reads .ts)
```

Coverage (core only): `cd packages/core && npm run test:coverage` (c8). Mocha test runners are `mocha dist/tests/**/*.test.js`; `validate` is `exit 0` for core/mcp and `build + --help` smoke for cli.

## High-level Architecture

**Build dependency = hard runtime dependency.** CLI and MCP import core's compiled `dist/`, not its source. After changing any core export you MUST `npm run build -w @context-os/core` before CLI/MCP or tests see it (this is the #1 recurring desync bug). All four `package.json` files share one lockstep version (currently `1.13.2`); CLI and MCP pin `@context-os/core` to that exact version. Publish order is always Core -> CLI -> MCP.

**`packages/core` is the engine, wired by a DI container.** `src/container/` holds `container.ts` (scoped resolution), `tokens.ts` (~45 typed `Symbol` keys), `defaults.ts` (default service graph). `factory.ts#createContextOS()` is the public entry, re-exported from `src/index.ts`. A new module registers in the default container and exports from `index.ts` — **never edit `src/index.ts` exports without coordinating**, every workspace depends on it. Subsystems are `src/` subdirs: `events/` (error-isolated `WorkspaceEventBus`), `agents/` (`AgentRegistry` + `MessageBus`), `orchestration/` (`TaskGraph` DAG, `TaskScheduler`, `ConflictResolver`, `SwarmOrchestrator`), `resilience/` (`CircuitBreaker`, Merkle-linked `AuditLog`, CUSUM predictive-failure), `cognitive/`, `governance/` (capability tokens, trust scoring, policy engine), `streaming/`, plus `services/` (git-intelligence, graph-rag, temporal-graph, knowledge-graph, embedding, locking, mission, repair) and `database/` + `metrics/`.

**Storage & search.** `better-sqlite3` + `sqlite-vec` for the vector index; embeddings via `@xenova/transformers` locally (or Gemini if `GEMINI_API_KEY` is set); tree-sitter (TS + Python) for parsing; Ajv validates documents against `packages/core/schemas/*.schema.json` (`soul`, `context`, `decision`, `memory`, `mission`, `capabilities`). The SQLite DB and `.context-db/` warehouse are gitignored — never commit `*.db`.

**CLI (`workspace-cli`)** is the human surface: one Commander subcommand per file in `src/commands/` (`init`, `search`, `watch`, `dashboard`, `today`, `decide`, `sync`, `mission`, `graph`, `validate`, `health`, …) mapping to the file-first lifecycle (`context-os today` -> work -> `decide` -> `sync`). `watch` is the Sentinel that re-indexes on filesystem change; `dashboard` launches the Aether HUD.

**MCP (`workspace-mcp`)** is the agent surface: an MCP server over **dual transport** — stdio (`server.ts`, default) and HTTP/SSE (`server-http.ts`, needs `MCP_AUTH_TOKEN`, port `MCP_HTTP_PORT` default 3001). One tool per file in `src/tools/` (`read`, `write`, `search`, `memory`, `decision`, `mission`, `graph-query`, `governance`, `swarm`, `temporal-graph`, …). The server enforces path isolation (no traversal outside workspace root) and the read-only buckets rule: agents may READ `knowledge/` and `schemas/` but never WRITE them.

**Dashboard (`workspace-dashboard`, private)** — React 19 + Vite + Tailwind v4 + Three.js spatial UI (force-directed 3D knowledge graph). Not published; the only workspace with ESLint (enforced at zero warnings).

**The data workspace (root/, orgs/, projects/, knowledge/, config/)** is the OS's own dogfooded memory and the canonical example of indexed content — scope rings root -> org -> project, isolated by default (`config/workspace.json` `contextRules`). When editing these, follow `WORKSPACE.md` and the schemas; do not invent non-standard directories.

## Conventions

- TypeScript `strict`, ESM + `NodeNext`, target `ESNext`. Prefer immutability (new objects, no in-place mutation). Use `spawn` not `exec` for subprocesses.
- **Double-Hook protocol** (project mandate): READ `AGENTS_LEARNING.md` before writing code (avoid repeating logged mistakes); UPDATE it with new learnings after. `AGENTS.md` is the richest scope/routing reference.
- Conventional Commits with workspace/subsystem scopes (`feat(core):`, `fix(mcp):`, scopes: `core`, `cli`, `mcp`, `dashboard`, `governance`, `streaming`, `swarm`, `temporal`). Husky `pre-commit` runs lint-staged (per-package `tsc --noEmit` + dashboard ESLint `--max-warnings=0`); `pre-push` runs `npm run validate`. Run `npm run prepare` after a fresh clone to install hooks.
- Prerequisites: Node 18+ (package `engines`); CI tests Node 20 + 22 and pins 22 for build/publish; npm 11+ (root `packageManager: npm@11`), a C++ toolchain (native `better-sqlite3` compilation).
