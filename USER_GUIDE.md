# 📕 ContextOS User Guide

This guide describes how to integrate ContextOS into your daily development workflow and connect it with your favorite AI agents.

---

## ⚡ Zero-Clone Quickstart (New Users)

The fastest way to get started and create your own AI-powered ContextOS workspace is using **NPX**. No cloning required!

```bash
# 1. Create a workspace folder
mkdir my-ai-context && cd my-ai-context

# 2. Initialize the entire ContextOS structure
npx @context-os/cli init

# 3. Create your first project
npx @context-os/cli init my-first-project
```

This will automatically scaffold:
- `root/soul.md`: Your AI personality/domain knowledge.
- `schemas/`: Validation rules for your context.
- `knowledge/`: General facts and shared context.
- `projects/`: Individual execution buckets.

---

## 🌎 Global Installation (Native local)

### 1. Global Installation
The easiest way to get started is by installing the CLI globally:
```bash
npm install -g @context-os/cli
```

Once installed, you can use the `workspace` command anywhere in your terminal.

### 2. Standard Initialization
Navigate to your project root and run:
```bash
workspace init .
```
This will create the necessary `.claude/`, `root/`, and `WORKSPACE.md` files required for ContextOS to function.

---

## 🏗️ Building From Source

If you are a contributor and want to build the tools locally:

### 1. Install dependencies
```bash
npm install
```

### 2. Build artifacts
```bash
npm run build:all
```

---

## ⚡ NPX Usage (Ephemeral)

You can also run ContextOS tools without permanent installation using `npx`. This is useful for CI/CD environments or quick one-off tasks.

### Running the CLI
```bash
npx @context-os/cli init my-project
```

### Running the MCP Server
```bash
npx @context-os/mcp
```

---

## 🛠️ Daily Development Lifecycle

ContextOS is designed to capture the "Delta" of your thinking. Follow these three steps every day to maintain a perfect project memory.

### 🌅 Phase 1: Morning Onboarding

When starting work, tell the system your goals. This updates the "Hot" memory for the day.

```bash
# Using the CLI
workspace today my-project "Implementing the new payment gateway"
```

*Agents will now see this goal at the top of every context read.*

### 🛠️ Phase 2: Active Development

As you work with AI agents (Cursor, Claude, etc.), they will use the MCP server to autonomously read from `projects/` and `knowledge/`.

If you make a major architectural decision, record it immediately:

```bash
workspace decide my-project "Use Redis for session caching" "Need sub-millisecond latency" "Accepted" "High scale requirements"
```

### 🌇 Phase 3: Evening Sync (Saving Your Soul)

Before finishing, run the sync command. This takes your raw daily logs and "compresses" them into long-term project memory.

```bash
workspace sync my-project
```

#### 🔄 How the Sync Engine Works

When you run `sync`, ContextOS performs a **Context Extraction**:

1. **Scanning**: It reads every `.md` file in `daily/` that hasn't been archived yet.
2. **Structuring**: It identifies **Decisions** (ADRs), **Key Changes**, and **Knowledge Nuggets**.
3. **Merging**: It intelligently appends or updates `memory.md` and `context.md`.
4. **Cleaning**: Once the data is moved to "Warm" memory, the raw files are moved to `archive/` to keep your workspace clutter-free.

---

## 🔗 Attaching Agents to ContextOS

To truly unlock the power of ContextOS, you need to "Attach" your AI agents so they can autonomously update your workspace.

### How an Agent "Writes" to your Workspace

When an agent is attached via MCP, it doesn't just read files; it acts as a **Context Steward**.

1. **Step 1: Agent Awareness**: Tell the agent "I'm using ContextOS. Please use the `workspace_daily_update` tool to log your progress."
2. **Step 2: Real-time Logging**: As the agent works, it will automatically call `workspace_daily_update` instead of just telling you in the chat. This stores its "thought process" directly in your `daily/` folder.
3. **Step 3: Structural Requests**: If you tell an agent to "Update my project architecture," it will use `workspace_memory_update` to refine your `memory.md`.

### Attaching manually (The "Agent Prompt" Method)

If you aren't using a direct MCP-aware IDE like Cursor, you can still attach an agent by pasting this into its system prompt:

> "You have access to a ContextOS workspace. Before making major changes, check `context.md` for dependencies. After completing a task, use `workspace_daily_update` to record your actions."

---

---

## 🔌 IDE Integrations

ContextOS works with any agent that supports the **Model Context Protocol (MCP)**.

### 👽 Antigravity

I (Antigravity) am natively aware of ContextOS. To use it with me:

1. Ensure the workspace is initialized.
2. Ask me: "What is the context for my-project?" or "Update the project memory with my latest work."

### 1. Cursor Setup
1.  Open **Cursor Settings** > **General** > **MCP**.
2.  Click **+ Add New MCP Server**.
3.  **Name**: `ContextOS`
4.  **Type**: `command`
5.  **Command**: `npx -y @context-os/mcp@latest`

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

ContextOS enforces several protection layers that you should be aware of:

> [!IMPORTANT]
> **Read-Only Buckets**: AI agents can READ from `knowledge/` and `schemas/`, but they are strictly forbidden from WRITING to them. This prevents "Agentic Drifting" where an AI might accidentally rewrite your core principles or domain knowledge.

> [!WARNING]
> **Path Isolation**: The MCP server automatically blocks any attempt to traverse outside the workspace. If an agent tries to read your `~/.ssh` or `~/Documents`, the request will be instantly rejected.

---

## ❓ FAQ

**Q: My agent says it can't find 'soul.md'.**
A: Ensure you have initialized the project with `workspace init <name>`.

**Q: Can I use this with multiple projects?**
A: Yes! ContextOS is designed to handle multiple project directories within the `projects/` bucket. Each represents a separate "Context Partition."

**Q: How do I backup my context?**
A: ContextOS uses standard Git. Simply push your root repository to a private remote.
