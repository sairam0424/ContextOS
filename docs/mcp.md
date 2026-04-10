# 🔌 ContextOS MCP Server (`@context-os/mcp`)

The `@context-os/mcp` server provides a secure, programmable bridge between your favorite AI agents (Cursor, Claude, etc.) and your ContextOS workspace.

---

## 🚀 Quick Usage (NPX)

The recommended way to run the MCP server is via **NPX**. This ensures you are always using the latest protocol definitions.

```bash
npx -y @context-os/mcp@latest
```

---

## 🛠️ Tool Registry

AI agents can interact with the following tools once connected via MCP:

### `workspace_context`
Get a high-fidelity snapshot of the current project state.
- **Includes**: Personality (Soul), Mission, Warm Memory, and Active Goals.

### `workspace_search`
Execute a deep structural search across the intelligence mesh.
- **Function**: Grep-based search restricted to allowed workspace buckets.

### `workspace_daily_update`
Log agentic activity into the Hot memory (daily logs).
- **Function**: Appends atomic progress notes to the current project's daily log.

### `workspace_memory_update`
Perform a manual or autonomous memory sync.
- **Function**: Merges context from daily logs into the long-term `memory.md` knowledge base.

---

## 🔒 Security Hardening

The MCP server is the primary enforcement layer for workspace safety:
- **Bucket-based path validation**: Prevents directory traversal attacks (`sys/`, `usr/`, etc.).
- **Strict Read-Only Enforcement**: Agents are physically blocked from writing to `root/`, `knowledge/`, or `schemas/`.
- **Atomic Commits**: Every write operation is automatically committed to Git for a permanent audit trail.

---

*Identity: Antigravity v1.6.1 (Aether)*
