# Changelog

All notable changes to the ContextOS platform will be documented in this file.

## [1.13.1] - 2026-05-25

### Architecture
- **Read Lock Persistence**: ConflictResolver read locks now persist to SQLite via `mode` column (removes volatile in-memory Map)
- **Audit Log Pagination**: `verifyIntegrity()` processes in batches of 1000 (no full-table memory load, supports resumable verification)
- **Event Bus WAL**: Events persisted to `event_log` table before handler dispatch; supports `replay()` after crash and `getSince()` for late subscribers

### Performance
- **Batch Embedding**: Gemini `batchEmbedContents` API processes 100 texts per call (~100x fewer HTTP round-trips during bulk indexing)

### MCP Protocol
- **Rate Limiter Persistence**: State flushed to file every 60s, restored on restart
- **Roots Support**: `roots/list` returns workspace root URI for filesystem boundary declaration
- **Progress Notifications**: `createProgressReporter` utility for long-running tool operations
- **Session Cleanup**: Subscriptions automatically cleaned up on client disconnect
- **Prometheus Metrics**: `GET /metrics` endpoint returns counters/histograms/gauges in Prometheus text format

### CLI
- **--json Output Wired**: 12 data-returning commands now respect `--json` flag for structured output
- **Completion Fix**: Shell completion uses `program.name()` instead of hardcoded string

## [1.13.0] - 2026-05-25 — "Nexus"

### Security
- **API Key Header Migration**: Gemini API key moved from URL query param to `x-goog-api-key` HTTP header (prevents log leakage)
- **LIKE Injection Prevention**: Escape `%` and `_` metacharacters in access log path filter queries
- **HTTP Body Hardening**: Stream-accumulate request body with hard byte cutoff (replaces Content-Length-only check)

### Added
- **MCP Prompts**: 4 prompt templates — daily-standup, context-load, decision-review, mission-brief
- **MCP Logging**: Structured `notifications/logging` messages to connected clients
- **MCP Subscriptions**: Resource subscription manager with session cleanup and change notifications
- **MCP Correlation**: X-Request-Id header on HTTP transport (echo client's or generate UUID)
- **MCP graph_query Tool**: Traverse knowledge graph with depth, direction, weight filters
- **MCP workspace_notify Tool**: Agent-to-agent messaging (send/read/broadcast via MessageBus)
- **DI Container Lifecycle**: `start()` calls warmup on Warmable services, `stop()` disposes in reverse order
- **Circuit Breaker Persistence**: State survives process restart via SQLite-backed storage
- **Dead-Letter Queue**: TTL-expired messages moved to `dead_letters` table with `message.expired` event
- **Event-Audit Bridge**: `task.failed`, `agent.quarantined`, `message.expired` auto-produce audit entries
- **MetricsCollector**: In-process counters, histograms (p50/p95/p99), and gauges via DI singleton
- **Capability-Based Routing**: Tasks declare `requiredCapabilities`; scheduler filters agents before assignment
- **Task Priority**: Scheduler processes higher-priority tasks first
- **Configurable Retry**: Exponential backoff with `RetryConfig` (replaces hardcoded maxRetries=2)
- **CLI Shell Completion**: `context-os completion <bash|zsh|fish>` generates install-ready scripts
- **CLI --json Flag**: Global structured output for all commands
- **CLI --verbose Flag**: Debug-level output with timing info
- **CLI --dry-run**: Report-only mode on prune and archive commands
- **CLI Typo Suggestions**: Levenshtein-based command suggestions on unknown input

### Performance
- **Embedding Warmup**: Pre-load transformer model via container lifecycle (eliminates cold-start)
- **Selective Column Fetch**: `getAllMetadata()` returns only path+mtime during reindex
- **Bounded Graph CTE**: LIMIT clause on recursive affinity queries (default 100 results)
- **Vector Cache Key**: Includes provider name to prevent stale results on model swap

## [1.12.0] - 2026-04-30 — "Nexus Consolidation"

### Fixed
- **Database Singleton**: All services now share a single SQLite connection, fixing embedding isolation bug where intelligence queue writes were invisible to search.
- **Search Pipeline**: Semantic search generates real query embeddings instead of passing empty vectors; returns fused results instead of keyword-only.
- **Command Injection (CVE-class)**: Grep fallback switched from `exec` to `execFile`, preventing shell injection via MCP search tool.
- **Tag Extraction**: Body tags (#hashtags) now correctly merged with frontmatter tags in index records.
- **Dashboard Reconnection**: WebSocket auto-reconnects with exponential backoff (1s → 30s max).
- **Stale Closure**: Dashboard `onmessage` handler reads from ref instead of stale render-scope variable.
- **Schema Migration**: Existing databases with missing columns now self-heal on startup via `ALTER TABLE`.

### Changed
- **MiniSearch Removed**: FTS5 is the sole keyword search engine (removed redundant in-memory index and `minisearch` dependency).
- **Access Log Pruning**: Sentinel prunes stale access records on startup and hourly (24h TTL).
- **2nd-Degree Affinity**: Spatial RAG considers two-hop graph neighbors with 0.3x decay weighting.
- **Streaming Static Files**: Dashboard server uses `createReadStream().pipe()` instead of blocking `readFileSync`.
- **Search Result Types**: Unified to `'hybrid' | 'deep'` (removed `'index'` and `'semantic'` variants).

### Added
- **Spatial RAG in MCP**: `workspace_search` tool accepts `anchor` parameter for graph-boosted retrieval.
- **Error Boundary**: Three.js crashes no longer take down the entire Aether dashboard.
- **Test Coverage**: 5 new test suites — locking, knowledge graph, intelligence queue, repair, capabilities (24 tests total for new suites).

## [1.11.0] - 2026-04-19

### Added
- **Janitor Agent (Autonomous Resilience)**: Gemini-powered self-healing engine for context reconstruction.
- **Spatial RAG**: Graph-affinity search boosting based on topological proximity.
- **Resilience Telemetry**: Real-time HUD indicators for repair states and persistent failures.

## [1.10.0] - 2026-04-10

### Added
- **Aether Nexus Initial Release**: Introduced the foundation for autonomous background services.
- **Sentinel Watcher**: Low-latency file monitoring and incremental indexing.
- **Capability-Based Routing**: Enhanced mission orchestration for multi-agent systems.

## [1.9.1] - 2026-04-09

### Added
- **Monorepo Stabilization**: Sequential publication protocol for Core, CLI, and MCP packages.
- **Intelligence Mirroring**: Automated schema and root-doc synchronization between packages.

## [1.6.1] - 2026-04-10

### Added
- **Aether Visual Overhaul**: Transitioned the Visual Control Center to a high-fidelity "Aether" design system.
- **Holographic HUD**: Implemented tripartite layout (Header, Inspector, Ticker) with glassmorphism and CRT scanning effects.
- **Spatial Intelligence**: Upgraded 3D Force Graph with custom geometries (Spheres/Tetrahedrons) and animated directional data particles.
- **Interactive Inspector**: Deep metadata and path-copy utility for knowledge graph entities.

## 🕹️ The Aether Command Deck

The v1.6.1 release introduces the **Aether HUD**, a real-time visual control center for your workspace.

- **3D Knowledge Graph**: Visualize the relationships between your project's "Soul," memory, and active decisions in a spatial force-directed graph.
- **The Sentinel (Watch Service)**: Full-auto background indexing that ensures your AI agents always have the freshest architectural intelligence.
- **Hybrid Semantic Mesh**: Combines high-speed relational grep with deep semantic extraction for unified context resolution.

## [1.4.0] - 2026-04-08
### Added
- **Federated Intelligence Mesh**: Expansion of the Knowledge Graph service to support cross-domain entity resolution.
- **Hybrid Search**: Integrated `sqlite-vec` semantic search with keyword-based relational queries.

## [1.1.0] - 2026-04-07
### Added
- **Initial Stability Release**: Unified domain handlers and enterprise-grade validation suites.
- **MCP Protocol V1**: Standardized tool registration for AI agent compatibility.

## [1.0.0] - 2026-04-07

### Added
- **Initial Stability Release**: Unified domain handlers and enterprise-grade validation suites.
- **MCP Protocol V1**: Standardized tool registration for AI agent compatibility.
