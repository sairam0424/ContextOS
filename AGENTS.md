# Repository Guidelines

ContextOS is a TypeScript monorepo (Turborepo) providing an intelligence layer for AI agents. It publishes three npm packages and a private dashboard app.

## Project Structure & Module Organization

Four workspaces under one root:

- **`packages/core`** (`@context-os/core`) — Shared intelligence: SQLite indexer, vector search (sqlite-vec), ML embeddings (@xenova/transformers), tree-sitter code parsing, schema validation (Ajv).
- **`workspace-cli`** (`@context-os/cli`) — Terminal interface (`context-os` binary). Commands live in `src/commands/`. Uses Commander, Chalk, Ora.
- **`workspace-mcp`** (`@context-os/mcp`) — Model Context Protocol server (`context-os-mcp` binary). MCP tools in `src/tools/`.
- **`workspace-dashboard`** (private) — React 19 + Vite + Tailwind v4 + Three.js spatial visualization (Aether HUD). Not published.

Build order: Core -> CLI/MCP/Dashboard (Turbo handles dependency graph via `^build`).

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
```

Run a single test file:

```bash
cd packages/core && npx mocha dist/tests/some-file.test.js
```

## Coding Style & Naming Conventions

- **ESM only** — all packages use `"type": "module"` with `NodeNext` module resolution.
- **TypeScript strict mode** — `"strict": true` across all tsconfigs. Target: `ESNext`.
- **ESLint** — configured for the dashboard only (`eslint.config.js`): `typescript-eslint`, `react-hooks`, `react-refresh`.
- **No shared formatter config** — Prettier is referenced in `.cursorrules` (`npx prettier --write .`) but has no dotfile.

## Testing Guidelines

- **Framework**: Mocha + Chai (core, cli, mcp).
- Tests must compile first — they live in `src/tests/` as `.ts` and run from `dist/tests/` after build.
- The dashboard has no test suite.

## Version & Release Protocol

**Strict version parity**: all four `package.json` files (root, core, cli, mcp) must share the same version. CLI and MCP also pin `@context-os/core` to the exact version.

Publish order (CI and manual): **Core -> CLI -> MCP** (sequential). Triggered by pushing a `v*` tag. CI runs on Node 22.

## Git Hooks & CI

- **Husky pre-commit + pre-push**: both run `npm run validate` (full build + workspace checks).
- **GitHub Actions**: PR validation (`validate.yml`) and tag-based npm publish (`publish.yml`).

## Commit Conventions

Conventional commits with scoped prefixes:

```text
feat(dashboard): description
fix(core): description
chore: description
docs: description
```
