#!/bin/bash
# DEPRECATED: Use `npx semantic-release` or push to main branch for automated releases.
# This script is kept for reference only. See .releaserc.json for the automated pipeline.
#
# ContextOS: Professional Release Pipeline (Turbo-Optimized)

set -e

echo "🚀 Starting ContextOS Professional Release Cycle..."

# 1. Clean and Install
echo "🧹 Cleaning and installing dependencies..."
rm -rf ./npm_cache
npm install --cache ./npm_cache

# 2. Unified Compilation (Turborepo)
echo "🏗 Compiling entire monorepo stack with Turborepo..."
npm run build

# 3. Unified Validation
echo "🧪 Running full suite of tests and validations..."
npm run test
npm run validate

# 4. NPM Distribution
echo "📦 Publishing packages to public NPM registry..."
# Using --cache ./npm_cache to bypass local permission issues
(cd packages/core && npm publish --access public --cache ../../npm_cache)
(cd workspace-cli && npm publish --access public --cache ../npm_cache)
(cd workspace-mcp && npm publish --access public --cache ../npm_cache)

echo "✅ Release build and verification complete!"
