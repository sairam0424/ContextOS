# Contributing to ContextOS

## Prerequisites

- **Node.js** 22+ (LTS)
- **npm** 11+
- **C++ toolchain** — required for native SQLite module compilation
  - macOS: `xcode-select --install`
  - Linux: `build-essential` package
  - Windows: Visual Studio Build Tools

## Quick Start

```bash
git clone <repo-url>
cd ContextOS
npm install
npm run build
npm run test
```

## Project Structure

This is a monorepo with 4 workspaces:

| Workspace | Path | Purpose |
|-----------|------|---------|
| `@context-os/core` | `packages/core/` | Context engine, storage, resilience, orchestration |
| `@context-os/native` | `packages/native/` | Native SQLite bindings (N-API) |
| `workspace-mcp` | `workspace-mcp/` | MCP server (stdio + HTTP transports) |
| `context-os` | root | Monorepo orchestration |

## Development Workflow

### Building

```bash
npm run build              # Build all workspaces
npm run build -w packages/core  # Build core only
```

### Testing

```bash
npm run test               # Run all tests
npm test -w packages/core  # Test core only
npx vitest run src/path/to/file.test.ts  # Single test file
```

### Validation

```bash
npm run validate           # Full project integrity check (types + lint + tests)
```

### Watch Mode

For iterative development on core:

```bash
cd packages/core
npx vitest --watch
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | No | Enables AI-powered embeddings and repairs. Without it, local transformer models are used (slower but free). |
| `CONTEXTOS_LOG_LEVEL` | No | Log verbosity: `debug`, `info`, `warn`, `error`. Defaults to `info`. |
| `MCP_AUTH_TOKEN` | For HTTP server | Bearer token for authenticating MCP HTTP transport clients. |
| `MCP_HTTP_PORT` | No | Port for MCP HTTP server. Defaults to `3001`. |
| `MCP_CORS_ORIGINS` | No | Comma-separated allowed CORS origins for MCP HTTP. |

Copy `.env.example` to `.env` and fill in values as needed.

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(core): add circuit breaker to storage layer
fix(mcp): handle missing workspace root gracefully
test(core): add stale agent recovery tests
refactor(native): simplify N-API bindings
docs: update README for v2 architecture
chore: bump vitest to 3.x
```

Scopes: `core`, `native`, `mcp`, `ci`, or omit for cross-cutting changes.

## Pull Request Guidelines

1. **Tests pass** — `npm run test` completes without failures
2. **Types check** — `npm run build` succeeds (includes `tsc`)
3. **One logical change per commit** — keep PRs focused
4. **Describe the "why"** — PR body should explain motivation, not just what changed
5. **Link issues** — reference related GitHub issues when applicable

## Known Issues

- Some `sqlite-hybrid` tests may fail depending on workspace resolution order and native module availability. This is a pre-existing issue tracked separately — do not treat as a regression from your changes.
- Native module compilation requires the C++ toolchain; CI handles this automatically.

## Getting Help

- Open an issue for bugs or feature requests
- Check existing issues before creating duplicates
- For architecture questions, review `packages/core/src/` module structure
