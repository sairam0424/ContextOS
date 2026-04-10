# Changelog

All notable changes to the ContextOS platform will be documented in this file.

## [1.6.1] - 2026-04-10
### Added
- **Aether Visual Overhaul**: Transitioned the Visual Control Center to a high-fidelity "Aether" design system.
- **Holographic HUD**: Implemented tripartite layout (Header, Inspector, Ticker) with glassmorphism and CRT scanning effects.
- **Spatial Intelligence**: Upgraded 3D Force Graph with custom geometries (Spheres/Tetrahedrons) and animated directional data particles.
- **Interactive Inspector**: Deep metadata and path-copy utility for knowledge graph entities.

## [1.6.0] - 2026-04-10
### Added
- **Visual Control Center**: Initial release of the 3D Knowledge Graph dashboard at `/dashboard`.
- **Node Classification**: Automatic visual grouping of documents, people, and tags in 3D space.

## [1.5.0] - 2026-04-09
### Added
- **Real-time Watch Service**: Native filesystem monitor for autonomous workspace synchronization.
- **Incremental Indexing**: Optimized background ingestion using `mtime` change detection.

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

# 1. Publish the Developer Interface (CLI)
npm publish -w workspace-cli --access public

# 2. Publish the Model Context Protocol Server
npm publish -w workspace-mcp --access public

