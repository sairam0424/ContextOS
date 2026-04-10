# 🌌 ContextOS: Aether Edition (v1.6.1)

> **The Spatial Intelligence Command Deck for Autonomous AI Agents.**

ContextOS is a high-fidelity intelligence infrastructure designed to bridge the gap between raw development activity and structured, actionable AI context. It provides a specialized set of tools (CLI & MCP) to help developers and AI agents maintain a project's "soul," long-term memory, and architectural integrity.

---

## 🛠️ Troubleshooting: The `EPERM` Blockade

If you encounter `npm error code EPERM` or `Operation not permitted` during publication, it is likely due to root-owned files in your NPM cache on macOS.

### The Symptom

```text
npm error syscall mkdir
npm error path /Users/sairamugge/.npm/_cacache/tmp
npm error errno EPERM
```

### 1. Synchronize Versioning

Before publishing, you must bump the version in **all 4 manifests**.

> [!IMPORTANT]
> ContextOS maintains strict version parity. If the project moves to `1.6.2`, all packages must be `1.6.2`.

**Files to update:**

- `package.json` (Root)
- `packages/core/package.json`
- `workspace-cli/package.json` (Also update `@context-os/core` dependency version)
- `workspace-mcp/package.json` (Also update `@context-os/core` dependency version)

---

## 🕹️ The Aether Command Deck
The v1.6.1 release introduces the **Aether HUD**, a real-time visual control center for your workspace.

*   **3D Knowledge Graph**: Visualize the relationships between your project's "Soul," memory, and active decisions in a spatial force-directed graph.
*   **The Sentinel (Watch Service)**: Full-auto background indexing that ensures your AI agents always have the freshest architectural intelligence.
*   **Hybrid Semantic Mesh**: Combines high-speed relational grep with deep semantic extraction for unified context resolution.

---

## ⚡ Quick Start

### 1. Install the CLI
To use ContextOS in your terminal anywhere:
```bash
npm install -g @context-os/cli
```

### 2. Enter the Dash (HUD)
Launch the spatial dashboard to visualize your workspace health:
```bash
context-os dashboard
```

### 3. Initialize a Project
```bash
context-os init my-cool-project
```

### 4. Connect your AI Agent (MCP)
In Cursor, Claude Desktop, or VS Code settings, add the following command:
```bash
npx -y @context-os/mcp@latest
```
*Note: Using `npx` ensures you always have the latest intelligence features without manual updates.*

---

## 🛠️ Capability Matrix

| Feature | CLI (`context-os`) | MCP (AI Agents) |
| :--- | :---: | :---: |
| **Aether Dashboard (HUD)** | ✅ | ❌ |
| **Real-time Sentinel (Watch)** | ✅ | ❌ |
| Project Scaffolding | ✅ | ❌ |
| Daily Logging | ✅ | ✅ |
| ADR Tracking (Decisions) | ✅ | ✅ |
| Workspace Validation | ✅ | ❌ |
| Global Search | ✅ | ✅ |
| Memory Pruning | ✅ | ❌ |

---

## 📖 Documentation
- [**User Guide**](./USER_GUIDE.md): Getting started, daily workflows, and Aether setup.
- [**Leveling Up**](./docs/cli.md): Full command breakdown.
- [**Architecture Deep Dive**](./docs/architecture.md): System layers, security, and data flow.
- [**Publishing Guide**](./docs/publishing.md): Build and distribution protocol.

---

## 📄 License
MIT © [Sairam Ugge](https://github.com/sairam0424)
