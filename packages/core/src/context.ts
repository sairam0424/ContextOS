import path from 'node:path';
import fs from 'node:fs';

/**
 * Discovers the workspace root by looking for root/soul.md in parent directories.
 */
export function findWorkspaceRoot(): string {
  let current = process.cwd();
  const root = path.parse(current).root;
  while (current !== root) {
    if (fs.existsSync(path.join(current, "root", "soul.md"))) {
      return fs.realpathSync(current);
    }
    current = path.dirname(current);
  }
  return fs.realpathSync(process.cwd()); // Fallback to CWD
}

export const workspaceRoot = findWorkspaceRoot();

/**
 * Standard ContextOS "Buckets" for security isolation.
 */
export const ALLOWED_BUCKETS = [
  "projects",
  "knowledge",
  "schemas",
  "archive",
  "log",
  "orgs",
  "root"
];
