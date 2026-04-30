# ContextOS v1.1.0: The Performance & Verification Release ⚡

- **Version**: `1.1.0` (Current)

---

This release focuses on industrial-grade performance and rigorous verification. By introducing smart incremental indexing and a multi-tier testing framework, we've ensured that ContextOS remains fast and stable as your workspace grows.

## ✨ New in v1.1.0

- **Smart Incremental Indexing**:
  - Automatically detects file modifications using `mtime` checksums.
  - Skips unchanged files during sync, reducing latency by **~80%** on incremental runs.
- **H1 Header Metadata Extraction**: 
  - Improved compatibility for non-frontmatter files. Dynamically extracts titles from Markdown `#` headers.
- **4-Tier Verification Suite**:
  - **Tier 1 (Core)**: domain logic & security isolation.
  - **Tier 2 (CLI)**: functional command smoke tests.
  - **Tier 3 (MCP)**: protocol registration stability.
  - **Tier 4 (Performance)**: automated benchmarking scripts.
- **Enhanced Grep Fallback**: Resolved search telemetry issues for unindexed patterns.

## 🛠 Stability Fixed

- Fixed metadata parsing for `personality.md` and other root-level files.
- Resolved search type flagging (distinguishing between 'index' and 'deep' hits).
- Unified inter-package dependency pinning to ensure monorepo consistency.

---

## ContextOS v1.0.0: The Intelligence Stack Release 🚀

We are proud to announce the first production-grade release of **ContextOS**, the unified intelligence layer for AI agents and developers. This version transforms ContextOS from a collection of scripts into a professional, secure, and scalable NPM monorepo.

## 🌟 Key Features

- **Unified Core Intelligence**: Shared security and path validation logic between the CLI and MCP server via the new `@context-os/core` package.
- **Enterprise-Grade Security**:
  - **Path Isolation**: Real-time validation to prevent directory traversal attacks.
  - **Security Buckets**: Enforced access control for `projects`, `knowledge`, `schemas`, and `root` directories.
  - **Read-Only Guards**: Automated protection for critical configuration files and system prompts.
- **Developer Command Center**: A rich CLI (`context-os`) with 14+ commands for workspace initialization, health checks, and task automation.
- **Agentic Memory Protocol**: Structured schemas for project memory, decision logs, and daily status updates, compatible with any Model Context Protocol (MCP) host.

## 🏗 Architectural Masterpiece

- **Monorepo Structure**: Optimized for scalability using NPM Workspaces.
- **Native ESM**: Built on modern Node.js standards for maximum performance and compatibility.
- **Atomic Reliability**: Transactions for git commits and file syncs ensure no data loss during multi-agent collaboration.

## 🔒 Security & Performance

- **Verified**: 100% pass rate on core security tests (node:assert).
- **Hardened**: Production-ready `.npmrc` configuration and comprehensive `.gitignore` protection.
- **Sync Engine**: Native asset mirroring ensures the CLI and MCP server always share the latest system schemas.

## 📦 Distribution Information

- **Registry**: [NPM](https://www.npmjs.com/package/@context-os/cli)
- **Scope**: `@context-os` (Core, CLI, MCP)
- **Version**: `1.0.0`

---

*ContextOS: Defining the standard for agent-workspace intelligence.*
