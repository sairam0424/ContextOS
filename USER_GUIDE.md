# 📕 ContextOS: User Guide (Aether)

This guide describes how to integrate ContextOS into your daily development workflow, visualize your workspace health via the Aether Dashboard, and connect it with your favorite AI agents.

---

## ⚡ Zero-Clone Quickstart

The fastest way to get started and create your own AI-powered ContextOS workspace is using **NPX**.

```bash
# 1. Create a workspace folder
mkdir my-ai-context && cd my-ai-context

# 2. Initialize the entire ContextOS structure
npx @context-os/cli init

# 3. Create your first project
npx @context-os/cli init my-first-project
```

---

## 🌎 Global Installation

### 1. Installation
The easiest way to get started is by installing the CLI globally:
```bash
npm install -g @context-os/cli
```

Once installed, you can use the `context-os` command anywhere in your terminal.

### 2. Standard Initialization

Navigate to your project root and run:
```bash
context-os init .
```

---

## 🕹️ Mission Control: The Aether Dashboard

#### `context-os dashboard`

Launch the **Aether HUD**.
The **Aether Dashboard** is a high-fidelity visual control center that provides a 3D view of your workspace's structural health.

### Launching the HUD
```bash
context-os dashboard --port 3000
```

### Key Features

- **3D Knowledge Graph**: A force-directed visualization of your files and their relationships.
- **Node Inspector**: Click on any file in the 3D graph to see its mission status, tags, and recent excerpts.
- **Health Ticker**: Real-time stream of workspace events and validation warnings.

---

## 📡 The Sentinel: Real-time Watch Service

The **Sentinel** (`context-os watch`) is a background service that monitors your filesystem and automatically re-indexes your workspace when files change.

### Starting the Sentinel
```bash
context-os watch
```

### Why use it?
- **Zero-Latency Intelligence**: AI agents will always read the most up-to-date ADRs and context.
- **Automatic Validation**: Sentinel will alert you (and your dashboard) if a file edit violates a schema in real-time.

---

## 🧠 Daily Development Lifecycle

### 🌅 Phase 1: Morning Onboarding
When starting work, tell the system your goals.
```bash
context-os today my-project "Implementing the Aether HUD"
```

### 🛠️ Phase 2: Active Development
As you work, record major architectural decisions immediately:
```bash
context-os decide my-project "Use 3d-force-graph" "Best spatial rendering" "Accepted"
```

### 🌇 Phase 3: Evening Sync
Before finishing, run the sync command to compress "Hot" logs into long-term memory.
```bash
context-os sync my-project
```

---

## 🔌 IDE Integrations

ContextOS works with any agent that supports the **Model Context Protocol (MCP)**.

### 1. Cursor Setup
1. Open **Cursor Settings** > **General** > **MCP**.
2. Click **+ Add New MCP Server**.
3. **Name**: `ContextOS`
4. **Type**: `command`
5. **Command**: `npx -y @context-os/mcp@latest`

### 2. Claude Desktop Setup

Add the following to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "context-os": {
      "command": "npx",
      "args": ["-y", "@context-os/mcp@latest"]
    }
  }
}
```

---

## 🔒 Security & Protection

> [!IMPORTANT]
> **Read-Only Buckets**: AI agents can READ from `knowledge/` and `schemas/`, but they are strictly forbidden from WRITING to them.

> [!WARNING]
> **Path Isolation**: The MCP server automatically blocks any attempt to traverse outside the workspace root.

---

## 📄 Documentation Reference
- [**CLI Reference**](./docs/cli.md)
- [**Architecture**](./docs/architecture.md)
- [**Publishing**](./docs/publishing.md)

**Q: How do I backup my context?**
A: ContextOS uses standard Git. Simply push your root repository to a private remote.
