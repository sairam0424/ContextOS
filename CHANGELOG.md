# Changelog

All notable changes to the ContextOS platform will be documented in this file.

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
