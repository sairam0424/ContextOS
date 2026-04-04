# 📦 Publishing Guide

This guide explains how to release new versions of ContextOS to the NPM registry.

## 🚀 One-Command Release

We have optimized the mono-repo to support a unified build and publish flow.

### 1. Build everything
Ensure all packages are compiled and templates are staged:
```bash
npm run build:all
```

### 2. Update Versions
Navigate to each package and bump the version (following Semantic Versioning):
- `workspace-cli/package.json`
- `workspace-mcp/package.json`

### 3. Publish to NPM
You must be logged into your NPM account (`npm login`).

**Publish the CLI:**
```bash
cd workspace-cli
npm publish --access public
```

**Publish the MCP Server:**
```bash
cd workspace-mcp
npm publish --access public
```

---

## 🛠️ Internal Templates
The CLI uses an internal `templates/` directory to bootstrap new workspaces. If you modify the global `schemas/` or `root/` folders, you must re-run the build script to sync them to the CLI distribution.

```bash
# Sync global schemas/root to CLI templates
cp -r schemas workspace-cli/templates/
cp -r root workspace-cli/templates/
```

> [!TIP]
> Always verify the `files` array in `package.json` before publishing to ensure no sensitive files (like `.env` or local logs) are included in the bundle.
