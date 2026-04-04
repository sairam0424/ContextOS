# 🚀 ContextOS

> **The Enterprise-Grade Intelligence Layer for Autonomous AI Agents.**

ContextOS is a multi-layered infrastructure designed to bridge the gap between raw development activity and structured, actionable AI context. It provides a specialized set of tools (CLI & MCP) to help developers and AI agents maintain a project's "soul," long-term memory, and architectural integrity.

---

## 🏗️ Core Pillars

*   **Intelligence Layer**: Automated memory lifecycle (Hot → Warm → Cold) and context compression.
*   **Validation Layer**: Structural enforcement through JSON schemas for mission-critical context files.
*   **Safety Layer**: "Allowed-Bucket" isolation strategy to prevent security violations and directory traversal.
*   **Interface Layer**: Universal Model Context Protocol (MCP) server for seamless IDE integration (Cursor, Claude Code, Antigravity).

---

## ⚡ Quick Start

### 1. Installation
```bash
git clone https://github.com/sair0424/ContextOS.git
npm run install:all
npm run build:all
```

### 2. Initialize a Project
```bash
cd workspace-cli
npm start -- init my-cool-project
```

### 3. Connect your AI Agent
Configure your MCP client (Cursor, Claude Desktop) to point to the server:
- **Command**: `node /absolute/path/to/ContextOS/workspace-mcp/dist/index.js`

---

## 🛠️ Capability Matrix

| Feature | CLI (`workspace`) | MCP (AI Agents) |
| :--- | :---: | :---: |
| Project Scaffolding | ✅ | ❌ |
| Daily Logging | ✅ | ✅ |
| ADR Tracking (Decisions) | ✅ | ✅ |
| Workspace Validation | ✅ | ❌ |
| Global Search | ✅ | ✅ |
| Memory Pruning | ✅ | ❌ |
| Structural Context Reads | ❌ | ✅ |
| Autonomous Writing | ❌ | ✅ |

---

## 📖 Documentation
- [**User Guide**](./USER_GUIDE.md): Getting started, daily workflows, and IDE setup.
- [**Architecture Deep Dive**](./docs/architecture.md): System layers, security, and data flow.
- [**CLI Reference**](./docs/cli.md): Full command breakdown.
- [**MCP Reference**](./docs/mcp.md): Available tools and schemas.

---

## 📄 License
MIT © [Sairam Ugge](https://github.com/sairam0424)
