# 🌌 ContextOS: Nexus Edition (v1.11.0)

> **The Autonomous Spatial Intelligence Layer for AI Agents.**

ContextOS is a high-fidelity intelligence infrastructure designed to bridge the gap between development activity and structured AI context. The **Nexus Edition** introduces autonomous self-healing, graph-aware search weighting, and real-time resilience telemetry.

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

## 🕹️ The Aether Command Deck (Nexus)
The v1.11.0 upgrade transforms the **Aether HUD** into an active mission-control dashboard.

*   **Autonomous Resilience (Janitor Agent)**: Gemini-powered self-healing that automatically reconstructs broken context or damaged project schemas with 3rd-attempt safety loops.
*   **Spatial RAG**: Topological search weighting that prioritizes results based on graph proximity, significantly reducing context noise for agents.
*   **Resilience Telemetry**: Nodes undergoing repair pulse with high-intensity yellow light, while persistent failures glow red for human intervention.
*   **The Sentinel (Watch Service)**: Proactive background health monitoring that ensures architectural intelligence is always synchronized.
*   **3D Knowledge Graph**: Immersive visualization of the project "Soul," memory patterns, and architectural decisions.

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
