#!/bin/bash
# ContextOS v1.0.1: Unified One-Click Production Release Pipeline (@context-os)

set -e

echo "🚀 Starting ContextOS v1.0.1 Professional Release Cycle (@context-os)..."

# Ensure clean environment
rm -rf ./npm_cache

# 1. Unified Sync
echo "🔄 Synchronizing schemas and root assets..."
PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin node scripts/sync-templates.js

# 2. Unified Compilation
echo "🏗 Compiling entire monorepo stack..."
./workspace-mcp/node_modules/.bin/tsc -p packages/core/tsconfig.json --typeRoots ./workspace-mcp/node_modules/@types
./workspace-cli/node_modules/.bin/tsc -p workspace-cli/tsconfig.json --typeRoots ./workspace-mcp/node_modules/@types
./workspace-mcp/node_modules/.bin/tsc -p workspace-mcp/tsconfig.json --typeRoots ./workspace-mcp/node_modules/@types

# 3. Handle Workspace Symlinks (Manual Fix for Cache Issues)
echo "🔗 Refreshing internal package symlinks..."
mkdir -p node_modules/@context-os
rm -f node_modules/@context-os/core
ln -s ../../packages/core node_modules/@context-os/core

# 4. Unified Validation
echo "🧪 Running security and smoke tests..."
# Use relative paths from dist to ensure ESM resolution
./workspace-mcp/node_modules/.bin/mocha packages/core/dist/tests/*.test.js workspace-cli/dist/tests/*.test.js workspace-mcp/dist/tests/*.test.js

# 5. NPM Distribution (Final Publish)
echo "📦 Publishing packages to public NPM registry..."
# Using --cache ./npm_cache to bypass local permission issues
(cd packages/core && npm publish --access public --cache ../../npm_cache)
(cd workspace-cli && npm publish --access public --cache ../npm_cache)
(cd workspace-mcp && npm publish --access public --cache ../npm_cache)

# 6. Git Life-Cycle
echo "🏷 Tagging repository as v1.0.1..."
git tag -a v1.0.1 -m "ContextOS v1.0.1: The Intelligence Stack Release"
git push origin v1.0.1 || echo "⚠️ Could not push tag origin. Please push manually: git push origin v1.0.1"

echo "✅ Release Complete: ContextOS v1.0.1 is live at @context-os!"
