# 📡 ContextOS: Spatial HUD Protocol (Aether)

You are operating within the **ContextOS Nexus Edition (v1.10.0)**. This workspace is a live Spatial Intelligence target.

## 🕹️ HUD Maintenance Rules

Every action you take reflects on the **Aether Visual Dashboard**. To maintain system integrity:

1. **Status Accuracy**: Use the `context-os status` command or update the `status` field in `context.md` to reflect active missions.
2. **Metadata Sync**: Ensure all markdown files contain valid Frontmatter. The Aether 3D Graph depends on `tags` and `priority` to render correctly.
3. **The Sentinel**: A background watch service (`context-os watch`) is active. Your changes will be indexed in real-time. Do not perform large bulk-writes without pausing to allow the indexer to catch up.

## 🧩 Workspace Context
- **Root**: `/Users/sairamugge/Desktop/ContextOS/`
- **Soul**: `root/soul.md` (Read-only for mission guidance)
- **Personality**: `root/personality.md` (Operational constraints)

## 🔄 Double-Hook Lifecycle

1. **Pre-Task Hook**: Read `AGENTS_LEARNING.md` to avoid recursive failure patterns.
2. **Post-Task Hook**: Update `AGENTS_LEARNING.md` with new architectural discoveries or technical debt identified.

---

## Session Notes — 2026-04-10 (Aether Release v1.6.1)

### New Insights

- **Spatial Intelligence**: Transitioning from a list-based view to a 3D Knowledge Graph (Aether HUD) significantly improves the ability of agents to detect context silos and orphaned files.
- **The Sentinel Pattern**: Transitioning from manual indexing to a background `watch` service (Sentinel) prevents "Stale Intelligence" where an agent reads an ADR that was just overwritten.
- **Dependency Version Pinning**: In a monorepo, version drifts (e.g., CLI at 1.5.0 but Core at 1.6.1) cause silent failures in domain logic. Fixed via Turbo-sync and manual manifest audit.

### Decisions

- **Aether Visual Dashboard**: Adopted `3d-force-graph` with Glassmorphism aesthetic for the primary control interface.
- **Unified Binary Name**: Standardized on `context-os` as the global binary name for better branding and recognition.
- **NPM Distribution Strategy**: Implemented sequential publication (Core -> CLI -> MCP) with `sudo chown` as the documented fix for Mac permission blockers.

### Mistakes & Mitigations

- **Mistake**: The CLI `bin` mapping in `package.json` used `./dist/index.js`, which NPM flagged as invalid during global install.
- **Mitigation**: Switched to canonical `dist/index.js` path mapping.
- **Mistake**: Permission `EPERM` error when publishing from Mac due to root-owned cache files.
- **Mitigation**: Documented the definitive `sudo chown -R $(whoami) ~/.npm` fix in `docs/publishing.md`.
- **Mistake**: Aether graph failed to render metadata for files missing H2 headers.
- **Mitigation**: Upgraded the `IntelligenceService` to support fallback H1 matching for document titles.

---

*Identity: Antigravity v1.6.1 (Aether)*
