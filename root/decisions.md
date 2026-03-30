# decisions.md (Architecture Decision Records)

## [2026-03-30] ADR 001: Initial Scaffolding
- **Decision**: Initializing the workspace Context OS in a dedicated directory relative to the current project location.
- **Rationale**: System permissions on the local machine prevent creation of the root `~/.workspace` directory.
- **Impact**: All workspace paths must be localized to `/Users/sairamugge/Desktop/ContextOS`.
- **Status**: Completed.
