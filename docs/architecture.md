# ContextOS Architecture

ContextOS is a multi-layered infrastructure for managing project context and developer intelligence.

## System Layers

### 1. File Layer (`root/ projects/ knowledge/`)
The source of truth for all project context.
- `soul.md`: Project purpose and mission
- `context.md`: Technical context and dependencies
- `memory.md`: Long-term project memory
- `decisions.md`: ADR records

### 2. Validation Layer (`schemas/`)
Enforces structural integrity through JSON schemas.
- `soul.schema.json`
- `context.schema.json`
- `memory.schema.json`
- `decision.schema.json`

### 3. CLI Layer (`workspace-cli/`)
Provides developer tools for manual interaction and automation.
- Project initialization
- Daily logging
- ADR recording
- Workspace validation

### 4. API Layer (`workspace-mcp/`)
Enables autonomous agents to interact with ContextOS through the Model Context Protocol (MCP).
- Safe read/write operations
- Isolated project access
- Structural knowledge search

## Security Model
ContextOS follows an **"Allowed-Bucket"** isolation strategy:
- **Projects**: Scoped read/write access to project-specific subdirectories
- **Knowledge**: Read-only access to global knowledge bases
- **Schemas**: Read-only access for validation
- **Archive**: Read-only access to historical logs
