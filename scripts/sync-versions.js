import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!version) { console.error('Usage: node sync-versions.js <version>'); process.exit(1); }

const root = new URL('..', import.meta.url).pathname;
const files = [
  'package.json',
  'packages/core/package.json',
  'workspace-cli/package.json',
  'workspace-mcp/package.json',
  'workspace-dashboard/package.json',
];

for (const file of files) {
  const fullPath = resolve(root, file);
  const pkg = JSON.parse(readFileSync(fullPath, 'utf8'));
  pkg.version = version;
  // Also update @context-os/core dependency if present
  if (pkg.dependencies?.['@context-os/core']) {
    pkg.dependencies['@context-os/core'] = version;
  }
  writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
}
console.log(`Synced all packages to version ${version}`);
