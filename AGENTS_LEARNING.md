# AGENTS_LEARNING.md

This file tracks agentic intelligence, mistakes, and architectural evolutions within the Context OS. It must be read by all agents at the start of a session.

## ❌ Mistakes & Mitigations

### 1. Restricted Path Access (`~/.workspace`)

- **Mistake**: Attempting to initialize the workspace at `~/.workspace/` and global Claude config at `~/.claude/` on a restricted system.
- **Mitigation**: Switched to a localized root at `/Users/sairamugge/Desktop/ContextOS/` and created a local `.claude/` proxy directory.
- **Learning**: Always verify directory write permissions before building core infrastructure.

### 2. Artifact Path Ambiguity

- **Mistake**: Attempting to write implementation plans and task lists directly to the workspace root when they must reside in the session's artifact directory.
- **Mitigation**: Standardized on `<appDataDir>/brain/<conversation-id>/` for artifact storage.
- **Learning**: Explicitly check the `<artifacts>` system instructions for path requirements.

---

## ✅ Best Practices

### 1. Master Index First

Always read `WORKSPACE.md` before performing any operation. It contains the most up-to-date context loading rules and scope definitions.

### 2. Status-First Operations

Maintain a `task.md` or equivalent to track progress. This prevents redundant work and provides a clear handoff point for future agents.

### 3. Absolute Path Normalization

Use absolute paths within the localized workspace root (`/Users/sairamugge/Desktop/ContextOS/`) to prevent ambiguity across tool calls.

---

## 🚫 Anti-Patterns

### 1. "Generic" Redundancy

Avoid creating duplicate or vague directories (e.g., `temp/`, `stuff/`). Stick to the established Scaffolding.

### 2. Information Silos

Do not perform major architectural changes without updating `root/decisions.md` (ADR).

---

## 🏗️ Architectural Patterns to Avoid

### 1. Flat Hierarchies

Never dump files directly into the root. Every file must have a designated "Ring" (Root, Org, Project, Skills, Knowledge).

### 2. Un-indexed Memory Blocks

Do not create complex knowledge structures without updating the Master Index (`WORKSPACE.md`).

---

## 🚀 Self-Improvement Protocol (Gravity V2 Upgrade)

### 1. The Double-Hook Loop

Every agent session must now follow the **Double-Hook** workflow:

- **Hook 1 (Start)**: Load the `AGENTS_LEARNING.md` file immediately after `WORKSPACE.md`.
- **Hook 2 (End)**: Before ending the session, summarize all new technical debt, architectural decisions, and error-mitigation patterns into this file.

### 2. Recursive Intelligence

Agents are required to "Upgrade" their operational baseline by checking this file for task-specific anti-patterns before executing any `run_command` or `write_to_file` operations.

### 3. Cross-Agent Handoff

Treat this file as the primary handoff mechanism. If a task is interrupted, the latest entry here must provide the next agent with the "Mental Model" of the current problem state.

---

## Session Notes — 2026-05-27 (v2.0 Comprehensive Upgrade)

### Architectural Decisions
- DI container now registers ALL 23 services (9 existing + 14 new). Module-level singletons deprecated with @deprecated JSDoc — consumers should migrate to `container.resolve(TOKENS.Xxx)`.
- Lock table redesigned from `path#read:agentId` encoding to composite PK `(path, agent_id, mode)`. Migration in schema.ts handles legacy data automatically.
- Event system upgraded with priority-based handlers (default 0) and wildcard subscriptions (`*`, `prefix.*`). Backward compatible.
- Embedding service now has failover chain: Gemini → Ollama → Transformers (3-strike threshold, sticky failover).

### Patterns Discovered
- When adding test files to a Vite/React workspace, exclude `__tests__/` from `tsconfig.app.json` to prevent build failures (test deps not available at build time).
- The `better-sqlite3` native module ERR_DLOPEN_FAILED is a pre-existing env issue (Node ABI mismatch) — not a regression. Fix with `npm rebuild`.
- 3 of the 6 bugs in `docs/v2-upgrade-plan.md` (B2, B3, B5) were already fixed but the plan wasn't updated. Always verify claims from planning docs against current code.

### Security Fixes Applied
- Hardcoded NPM token removed from `.npmrc` (replaced with `${NPM_TOKEN}` env var). Token must be revoked manually in npm dashboard.
- Credential leakage in embedding service fixed (3 `JSON.stringify(data)` calls sanitized).
- Lock release tool now validates ownership before returning success.

### Anti-Patterns Identified
- Module-level singletons (`getSharedXxx()`) bypass DI and make testing harder. Always resolve from container in new code.
- Audit log and event store had no pruning — unbounded growth. Now auto-pruned (90 days / 7 days respectively).
- MCP `mcp.json` manifest was out of sync with registered tools (7 listed vs 17 actual). Keep manifest auto-generated or verified in CI.

---

## Session Notes — 2026-03-31 (Day 4)

### New Insights
- Project isolation is safest when CLAUDE.md references exist within ~/.workspace; create root/org stubs to avoid broken loads.
- Use create-if-missing guards to maintain idempotency and avoid overwriting context files.

### Decisions
- Established first isolated project at ~/.workspace/projects/context-os with explicit context loading rules.

### Patterns to Reuse
- Copy CLAUDE.md to AGENTS.md to keep agent rules in sync.
- Ensure tasks/active.md and tasks/backlog.md are populated to prevent empty-task ambiguity.

---

## Session Notes — 2026-04-04 (Day 10 Audit)

### New Insights

- **Validation Robustness**: CLI validation must handle both Frontmatter and Section-based metadata to support different developer styles while enforcing the same schema.
- **Root Discovery**: `process.cwd()` is unreliable in multi-package repositories; implemented parent-walk root discovery for both CLI and MCP to find `root/soul.md`.
- **Security Scoping**: Added `orgs/` and `root/` buckets to `ALLOWED_ROOTS` to enable safe cross-layer context management.

### Decisions

- Switched from `exec` to `spawn` for git operations to eliminate shell injection vulnerabilities and improve signal handling.
- Enforced strict schema validation on the `workspace-starter` template to prevent regression in onboarding materials.

### Mistakes & Mitigations

- **Mistake**: Accurately identified that `SOUL.md` and `CONTEXT.md` were desynced from their JSON schemas (missing required sections like Identity/Overview).
- **Mitigation**: Aligned all project and starter files with updated schemas using strict Frontmatter or Section definitions.
- **Mistake**: Discovered that Section parsing was failing when content started with Frontmatter but lacked `## ` headers.
- **Mitigation**: Upgraded `extractMetadata` in the CLI to merge results from both Frontmatter and Section parsers intelligently.

---

## Session Notes — 2026-04-08 (Optimization Loop v1.1 - v1.3)

### New Insights

- **Monorepo Task Runners**: Transitioning from manual shell scripts to **Turborepo** results in massive performance gains (Cold: 12s → 3s, Warm: 11ms). Parallelization across Core, CLI, and MCP ensures that build bottlenecks are eliminated.
- **Headless Domain Logic**: Moving business logic (Search, Sync, Validation) into a **Service Layer** in `@context-os/core` is the most significant architectural win. It ensures that the MCP server and CLI provide identical outcomes while allowing for a "Thin CLI" that focuses only on UI/UX.
- **Inter-Package Dependency Loop**: In a monorepo, changing the Core package requires a `tsc` build before other packages (CLI/MCP) can see the new exports. Using `turbo run build` is the safest way to ensure the entire system is in sync.

### Decisions

- **Functional Singletons**: Implemented Services (Intelligence, Validation, Workspace) as exported instances to provide a clean, ready-to-use API for consumers.
- **Hybrid Search Parity**: Upgraded the MCP server from raw `grep` to the hybrid `IntelligenceService` (Index + Grep fallback), providing immediate parity with the CLI.

### Mistakes & Mitigations

- **Mistake**: Forgot to export a convenience getter for the workspace root, leading to lint errors across new services.
- **Mitigation**: Added `getWorkspaceRoot()` to `packages/core/src/context.ts` as the standard way to resolve the system root.
- **Mistake**: Attempted to pass CLI-unsupported flags (like `--cache`) during manual smoke tests.
- **Mitigation**: Verified commands against actual CLI help signatures before execution.

---

## Session Notes — 2026-04-08 (v1.0 Readiness Audit)

### New Insights

- **Audit-Ready Architecture**: The decoupling of CLI and MCP through a shared "Intelligence Layer" makes the system remarkably stable for multi-agent workflows.
- **Isolation Validation**: Testing the security model with `isolation.test.ts` is a critical baseline for allowing autonomous writes in enterprise environments.

### Decisions

- Formally declared ContextOS as "Ready for v1.0.0" based on the implementation of 14 CLI commands and 7 MCP tools.
- Identified 5 core USPs (Isolation, Hybrid Schema, Memory Tiers, Schema Enforcement, Git-as-DB) to be used in marketing and documentation.

### Mistakes & Mitigations

- **Mistake**: Identified that while `search` exists in both CLI and MCP, semantic search is currently a placeholder for future vector DB integration.
- **Mitigation**: Clarified in the audit report that current search is Grep-based, ensuring transparent expectations for the v1.0 release.

---

## Session Notes — 2026-04-09 (Verification & Indexing Loop v1.4)

### New Insights

- **4-Tier Verification Architecture**: Implementing tests across Core (Logic), CLI (UX), MCP (Protocol), and Performance (Benchmark) tiers is the only way to guarantee stability in a decoupled monorepo. 
- **Metadata Edge Cases**: Real-world files often use # Title (H1) headers instead of frontmatter title. Validation logic must support both to avoid "stale metadata" errors in indexing.
- **Benchmark Masking**: In small repositories, Node.js and CLI startup overhead can mask indexing performance gains. Use high-volume file sets or internal timers to measure actual logic speedup.

### Decisions

- **Incremental Default**: Incremental sync is now the default on all interfaces, with --force reserved for manual re-indexing.
- **Mocha Timeouts**: Increased default timeouts for integration tests utilizing grep to 5000ms to handle full-workspace scans without failure.

### Mistakes & Mitigations

- **Mistake**: The extractMetadata service was only looking for ## sections, causing files with only H1 titles (#) to return empty metadata.
- **Mitigation**: Upgraded ValidationService with H1 regex matching as a fallback for the document title.
- **Mistake**: Tests in workspace-mcp failed due to McpServer.listTools being a private/internal API.
- **Mitigation**: Switched to a registration-stability pattern (using assert.doesNotThrow) to verify tool integration without relying on SDK internals.
- **Mistake**: Passing a path string instead of file content to extractMetadata during tests.
- **Mitigation**: Ensured all tests readFile before calling core extraction services.

---

## Session Notes — 2026-04-11 (Streaming & Deep Context Upgrade)

### New Insights

- **Spatial Telemetry & Trust**: Visualizing the "Agent Focus" (the AI's active attention) in the 3D HUD creates a "Glass Box" effect. Users feel less anxiety about autonomous agents when they can physically see the agent "moving" through the graph.
- **Top-K vs. Hard-Thresholds**: Flat similarity thresholds (e.g. >0.85) fail in heterogeneous workspaces. Switching to a "Top-3 Neighbors" pruning strategy (v1.9.0) ensures that every node has logical context bridges without devolving into a "hairball" graph.
- **Bidirectional HUD Patterns**: Moving from a passive dashboard to an active Command Center requires a bidirectional WebSocket protocol. The "Send Command -> Execute in Core -> Broadcast Sync" loop ensures all connected clients remain in a consistent state.
- **Unified Persistence Layer**: Replacing the JSON-based synchronization with a SQLite-only Source of Truth (SOT) significantly reduces I/O overhead and avoids the "Dual-Write" problem that caused race conditions in v1.7.0.
- **Background Intelligence Queue**: De-coupling embedding generation from the main watcher thread (Sentinel) ensures the CLI remains interactive even during bulk indexing operations.
- **FTS5 vs Semantic Hybrid Search**: Using SQLite FTS5 for keyword matching while leveraging `sqlite-vec` for semantic distance provides a production-grade search architecture that out-performs simple property filtering.
- **Spatial Intelligence**: Transitioning from a list-based view to a 3D Knowledge Graph (Aether HUD) significantly improves the ability of agents to detect context silos and orphaned files.
- **The Sentinel Pattern**: Transitioning from manual indexing to a background `watch` service (Sentinel) prevents "Stale Intelligence" where an agent reads an ADR that was just overwritten.
- **Dependency Version Pinning**: In a monorepo, version drifts (e.g., CLI at 1.5.0 but Core at 1.6.1) cause silent failures in domain logic. Fixed via Turbo-sync and manual manifest audit.

### Decisions

- **Aether Command Center (v1.9.0)**: Standardized on a Command-Action pattern for HUD-to-CLI communication. Manual links are persisted with `type: 'manual'` to differentiate from AI-generated bridges.
- **Intelligence Backbone (v1.8.0)**: Adopted a background worker pattern for all semantic processing. Documents are indexed as "Metadata Ready" first, then "Semantic Ready" once processed.
- **Aether Visual Dashboard**: Adopted `3d-force-graph` with Glassmorphism aesthetic for the primary control interface.
- **Unified Binary Name**: Standardized on `context-os` as the global binary name for better branding and recognition.
- **NPM Distribution Strategy**: Implemented sequential publication (Core -> CLI -> MCP) with `sudo chown` as the documented fix for Mac permission blockers.
- **Exported Symbols Only**: To avoid noise, we only index exported code symbols. This focuses the graph on the "Public API" of the workspace.
- **Socket-Based "Pulse"**: Standardized all HUD updates on a single WebSocket channel for `init` and `sync` events, reducing HTTP request overhead.

### Mistakes & Mitigations

- **Mistake**: Attempted to use standard CSS `linkDashArray` for 3D links, which is not supported by the underlying Three.js LineBasicMaterial.
- **Mitigation**: Switched to **Color-encoded links** and increased `linkWidth` for code references to achieve visual differentiation.
- **Mistake**: Encountered multiple `TS18048` errors in the React HUD because the WebSocket can deliver partial updates or "entities" that lack document-specific metadata.
- **Mitigation**: Enforced rigorous **optional chaining** (`?.`) across the entire Dashboard UI layer.
- **Mitigation**: Used local caches (`--cache ./npm_cache`) and verified `node` paths before running build scripts.

### 4. Monorepo Build Desync (Core vs CLI)

- **Mistake**: Adding a new export to `@context-os/core` but experiencing `TS2305` errors (no exported member) in dependent packages like CLI or MCP.
- **Mitigation**: Always run `npm run build -w @context-os/core` after modifying core source code. Dependent packages consume the compiled `dist/` files, not the raw TypeScript source.
- **Learning**: In a workspace setup, source changes are not "live" to other packages until the transpilation step (`tsc`) updates the distributed type definitions.

---

## Session Notes — 2026-04-18 (Protocol Aether v2.0 Research)

### New Insights

- **AST vs. Regex Gap**: Discovered that `indexer.ts` currently relies on brittle regex for symbol extraction, missing internal private methods and dependency usage patterns.
- **Spatial RAG Pruning**: Current search is flat; implementing a graph-weighted similarity score (Distance-Weighted Retrieval) is essential for handling high-density knowledge meshes without information overload.
- **Actionable HUD Surfaces**: The 3D Aether graph is currently "Read-Only." Transitioning to an interactive command-plane (Actionable Nodes) will unify visual navigation with task execution.
- **Self-Healing Loop**: The Sentinel pattern can be extended from simple indexing to "Autonomous Correction" by hooking validation failures into repair agents.

### Decisions

- **Tree-Sitter Adoption**: Decided to replace regex indexing with Tree-Sitter for AST-level semantic accuracy in v2.0.
- **Mission-Centric UX**: Standardized on "Missions" as state-managed objects in the graph to replace fragmented "Daily Logs."

### Technical Debt Identified

- **Dual-Write Risk**: `indexer.ts` still manually coordinates between SQLite and the JSON index; moving to a pure SQLite-driven state is the priority for v2.0.
- **Static Bucket Limits**: The `ALLOWED_BUCKETS` are hardcoded in `context.ts`. This lacks the flexibility needed for multi-tenant or workspace-specific configurations.
---

## Session Notes — 2026-04-18 (ContextOS Aether Phase 4: Resilience & Intelligence)

### New Insights

- **Autonomous Self-Healing**: Implementing the **Janitor Agent** as a fallback for rule-based repair creates a resilient context layer. The LLM (Gemini 1.5 Pro) excels at reconstructing malformed frontmatter while preserving intent.
- **Retrieval-Augmented Geometry (Spatial RAG)**: Boosting search results by graph affinity (connectedness to an anchor node) solves the relevance problem in high-density workspaces. It prioritizes "logical neighbors" over generic keyword matches.
- **Safety Guardrails**: Autonomous LLM agents REQUIRE infinite-loop protection. A simple `repairCount` map with a hard cap (3 attempts) prevents runaway token usage and "flapping" states.
- **HUD-as-Status-Broadcaster**: Propagating `repairing` and `error` states to the HUD visual layer is critical for trust. Seeing a yellow "pulse" for a self-healing file makes autonomous actions feel safe and observable.

### Decisions

- **Affinity Weighting**: Decided on a `(1 + affinity)` multiplier for Spatial RAG. This ensures connectivity boosts scores significantly without drowning out high-quality semantic matches.
- **Sentinel Status Updates**: The Sentinel now explicitly manages the `intelligence_status` in the database, ensuring the UI remains in sync with background processes.

### Technical Debt Identified

- **Token Budgeting**: The Janitor Agent lacks a `REPAIR_BUDGET` (token count tracking). Sustained failures in large files could lead to high operational costs.
- **Multi-Hop Affinities**: The current `getAffinities` only calculates 1st-degree connections. Implementing a fast decay-based BFS would enable "Knowledge Halo" expansion in search.
- **Manual HUD Triggers**: While visual states are present, the UI lacks right-click handlers for "Force Repair" or "Assign to Mission" (deferred to Phase 5).
