# 📦 ContextOS: NPM Distribution & Release Guide

This document provides the definitive procedure for publishing new versions of ContextOS to the NPM registry, including troubleshooting common permission issues and managing monorepo version synchronization.

---

## 🏗️ Release Lifecycle Overview

ContextOS is a monorepo managed via **NPM Workspaces**. All internal packages must be published in a specific order to ensure dependency integrity.

### Current Package Hierarchy:
1.  `@context-os/core`: The shared intelligence layer (Base dependency).
2.  `@context-os/cli`: The primary developer tool (Depends on `core`).
3.  `@context-os/mcp`: The protocol server (Depends on `core`).

---

## 🚀 Step-by-Step: Publishing a New Version

### 1. Synchronize Versioning
Before publishing, you must bump the version in **all 4 manifests**. 
> [!IMPORTANT]
> ContextOS maintains strict version parity. If the project moves to `1.6.2`, all packages must be `1.6.2`.

**Files to update:**
- `package.json` (Root)
- `packages/core/package.json`
- `workspace-cli/package.json` (Also update `@context-os/core` dependency version)
- `workspace-mcp/package.json` (Also update `@context-os/core` dependency version)

### 2. Prepare the Build
Run the root build command to ensure all TypeScript is compiled and templates are mirrored correctly.
```bash
npm run build
```

### 3. Verification Scan
Run the validation suite to ensure the new version doesn't introduce architectural drift.
```bash
npm run validate
```

### 4. Sequential Publication
You must publish the **Core** package first so that the CLI and MCP can resolve their new dependency version on the registry.

```bash
# 1. CORE (The Soul)
npm publish -w packages/core --access public

# 2. CLI (The HUD)
npm publish -w workspace-cli --access public

# 3. MCP (The Bridge)
npm publish -w workspace-mcp --access public
```

---

## 🛠️ Troubleshooting: The `EPERM` Blockade

If you encounter `npm error code EPERM` or `Operation not permitted` during publication, it is likely due to root-owned files in your NPM cache on macOS.

### The Symptom:
```text
npm error syscall mkdir
npm error path /Users/sairamugge/.npm/_cacache/tmp
npm error errno EPERM
```

### The Fix:
Restore ownership of your local npm directory to your current user:
```bash
sudo chown -R $(whoami) ~/.npm
```

---

## ⚠️ Gotchas & Best Practices

### 1. Forbidden Errors (E403)
**Error**: `You cannot publish over the previously published versions: X.X.X`
**Reason**: NPM versions are immutable. Once a version is live, you cannot change it.
**Fix**: Increment the patch version (e.g., `1.6.1` -> `1.6.2`) in all manifests and try again.

### 2. Missing Templates
The CLI (`@context-os/cli`) bundles a `templates/` folder. If you modify root-level schemas or the `root/` markdown files, you **must** run `npm run build` at the root. This triggers `scripts/sync-templates.js` which mirrors these files into the CLI package before it's tarballed for NPM.

### 3. Binary Permissions
The CLI entry point (`dist/index.js`) must be executable. Our build process handles this, but verify the `bin` field in `workspace-cli/package.json` points correctly to the compiled JS.

---

**Status**: **Release Protocol v1.6.1-AETHER is verified and documented.**
