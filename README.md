# ContextOS (v1.12.0)

> Enterprise-grade intelligence layer for autonomous AI agents.

ContextOS is a TypeScript monorepo providing structured context infrastructure — from workspace indexing and vector search to multi-agent orchestration with built-in resilience. Ships as three npm packages and a spatial dashboard.

---

## Quick Start

### Install the CLI

```bash
npm install -g @context-os/cli
```

### Initialize a Project

```bash
context-os init my-project
```

### Connect an AI Agent (MCP)

In Cursor, Claude Desktop, or VS Code settings:

```bash
npx -y @context-os/mcp@latest
```

### Launch the Dashboard

```bash
context-os dashboard
```

---

## Architecture

Four workspaces under one Turborepo root:

| Package | Description |
| :--- | :--- |
| `@context-os/core` | SQLite indexer, vector search (sqlite-vec), ML embeddings, tree-sitter parsing, DI container, event bus, agent registry, orchestration, resilience |
| `@context-os/cli` | Terminal interface — project scaffolding, search, watch, dashboard launcher |
| `@context-os/mcp` | Model Context Protocol server — stdio and HTTP/SSE transports |
| `workspace-dashboard` | React 19 + Three.js spatial visualization (private, not published) |

### v2 Core Modules

| Module | Purpose |
| :--- | :--- |
| **ServiceContainer** | Dependency injection with scoped resolution and typed tokens |
| **WorkspaceEventBus** | Typed events with error-isolated handlers |
| **AgentRegistry** | Lifecycle management — register, heartbeat, quarantine, stale detection |
| **MessageBus** | Direct, broadcast, and correlation-based messaging with TTL |
| **TaskGraph** | DAG-validated task dependencies with compare-and-swap assignment |
| **TaskScheduler** | Dependency-aware scheduling with contention retry |
| **ConflictResolver** | Read/write locks with upgrade support |
| **CircuitBreaker** | Sliding-window failure tracking with auto-quarantine |
| **AuditLog** | Merkle-linked tamper-evident audit trail |

---

## Development

```bash
npm run build          # Turbo: build all workspaces
npm run test           # Turbo: run mocha tests (core/cli/mcp)
npm run link:all       # Build + npm link for local dev
```

Per-workspace:

```bash
cd workspace-dashboard && npm run dev    # Vite dev server
cd workspace-cli && npm run watch        # tsc watch
cd workspace-mcp && npm run mcp:stdio    # Run MCP server
```

Run a single test:

```bash
cd packages/core && npx mocha dist/tests/container.test.js
```

---

## Capability Matrix

| Feature | CLI | MCP | Core |
| :--- | :---: | :---: | :---: |
| Spatial Dashboard (Aether HUD) | x | | |
| Real-time Watch Service | x | | |
| Project Scaffolding | x | | |
| Daily Logging | x | x | |
| ADR Tracking | x | x | |
| Workspace Validation | x | | |
| Global Search | x | x | x |
| Multi-Agent Orchestration | | | x |
| Circuit Breaker / Resilience | | | x |
| Merkle Audit Log | | | x |

---

## Version & Release

All four `package.json` files must share the same version. Publish order: Core -> CLI -> MCP. Triggered by pushing a `v*` tag. CI runs on Node 22.

---

## Documentation

- [User Guide](./USER_GUIDE.md) — Getting started and daily workflows
- [CLI Commands](./docs/cli.md) — Full command reference
- [Architecture](./docs/architecture.md) — System layers and data flow
- [Publishing](./docs/publishing.md) — Build and release protocol
- [v2 Upgrade Plan](./docs/v2-upgrade-plan.md) — Multi-agent architecture design

---

## 📄 License

MIT © [Sairam Ugge](https://github.com/sairam0424)
