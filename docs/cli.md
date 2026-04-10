# ⌨️ Context-OS CLI Reference

The `context-os` CLI is the primary developer interface for the ContextOS ecosystem. It provides the command-and-control tools for workspace health, spatial intelligence, and automated lifecycle management.

---

## 🛠️ General Usage

```bash
context-os [command] [options]
```

### 📡 Spatial & Monitor Commands

#### `context-os dashboard`
Launch the **Aether HUD**.
- **Options**:
  - `--port <number>`: Port to serve the dash (default: 3000).
- **Function**: Starts a local visual control center with 3D Graph and Health Ticker.

#### `context-os watch`
Activate the **Sentinel Watch Service**.
- **Function**: Background indexing of all file changes within the workspace root. Ensures local memory is always "Hot".

#### `context-os status`
View active workspace mission status.
- **Function**: Parses `context.md` and reports current goals and health metrics.

### 🧩 Lifecycle & Project Commands

#### `context-os init [name]`
Initialize the workspace or a specific project.
- **Function**: Scaffolds the ContextOS directory structure (`root/`, `projects/`, `schemas/`).

#### `context-os today <project> "<message>"`
Set the daily mission goal.
- **Function**: Updates `daily/*.md` with the morning intention.

#### `context-os decide <project> --title "<title>"`
Record an Architectural Decision (ADR).
- **Options**:
  - `--context <text>`: The problem being solved.
  - `--status <text>`: `Proposed`, `Accepted`, `Rejected`.

#### `context-os sync <project>`
Manually trigger a Hot-to-Warm memory transition.
- **Function**: Compresses raw activity logs into the `memory.md` knowledge base.

#### `context-os prune`
Lifecycle maintenance.
- **Function**: Deletes empty log files and moves cold knowledge to `archive/`.

### 🔍 Intelligence & Validation

#### `context-os search "<query>"`
Execute a **Hybrid Intelligence** search.
- **Options**:
  - `--semantic`: Enable high-fidelity extraction.
- **Function**: Searches across the entire workspace mesh.

#### `context-os validate`
Audit the workspace for structural drift.
- **Function**: Checks all critical context files against JSON schemas in `schemas/`.

#### `context-os context <project>`
Get a point-in-time snapshot of project health.
- **Function**: Formats all high-level context (Soul, Memory, Goals) for AI consumption.

---

## 🏗️ Development

To contribute or test locally:
```bash
# From package root
npm run build
context-os dashboard
```

*Identity: Antigravity v1.6.1 (Aether)*
