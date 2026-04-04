# ContextOS MCP Server (`workspace-mcp`)

The `workspace-mcp` server provides a programmable interface for interacting with ContextOS, designed to be used by AI agents (e.g., Cursor, Claude, local agents).

## Installation

```bash
cd workspace-mcp
npm install
npm run build
```

## Tools

### `workspace_read`
Read context and metadata for a specific project.
- Scopes file access to projects and knowledge directories
- Enforces read-only safety for protected files

### `workspace_write`
Update the project context file.
- Deterministic appends for log entries
- Structural updates for ADRs

### `workspace_search`
Search across knowledge and projects.
- Restricted grep-based search within workspace boundaries
- No shell injection risk

### `workspace_memory_update`
Sync the current project history into long-term memory.
- Automates memory lifecycle transitions
- Structures memory with timestamps and importance levels

## Security Hardening
The MCP server includes:
- Bucket-based path validation to prevent directory traversal
- Strict read-only enforcement for root configuration files
- Environment isolation for third-party scripts
