import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { workspaceRoot, ALLOWED_BUCKETS } from './context.js';

export * from './context.js';
export * from './indexer.js';
export * from './services/intelligence.js';
export * from './services/validation.js';
export * from './services/workspace.js';
export * from './services/knowledge-graph.js';
export * from './services/sampling.js';
export * from './services/watch.js';
export * from './services/intelligence-queue.js';
export * from './services/database.js';
export * from './services/locking.js';
export * from './services/workspace-config.js';
export * from './services/mission.js';
export * from './services/federation.js';

/**
 * Validates that a path is within the workspace root and inside an allowed bucket.
 */
export function validatePath(requestedPath: string) {
  const resolvedPath = path.resolve(workspaceRoot, requestedPath);
  
  let fullPath: string;
  try {
    fullPath = fs.realpathSync(resolvedPath);
  } catch (e) {
    fullPath = resolvedPath;
  }

  const relativePath = path.relative(workspaceRoot, fullPath);

  // Security check: must be within the workspace root
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Security violation: Path ${requestedPath} is outside the allowed ContextOS workspace root.`);
  }

  // Enterprise check: must be within an allowed bucket
  const isAllowed = ALLOWED_BUCKETS.some(bucket => {
    const bucketRoot = path.join(workspaceRoot, bucket);
    const bucketRelative = path.relative(bucketRoot, fullPath);
    return !bucketRelative.startsWith("..") && !path.isAbsolute(bucketRelative);
  });
  
  if (!isAllowed) {
    throw new Error(`Security violation: Path ${requestedPath} is outside the allowed bucket (projects, orgs, knowledge, schemas, etc).`);
  }

  return { fullPath, relativePath };
}

/**
 * Checks if a path is in a read-only bucket for agents.
 */
export function isReadOnly(filePath: string): boolean {
  const { fullPath } = validatePath(filePath);
  
  const readOnlyBuckets = ["knowledge", "schemas", "root", "packages", "workspace-cli", "workspace-mcp", "workspace-dashboard"];
  return readOnlyBuckets.some(bucket => {
    const bucketRoot = path.join(workspaceRoot, bucket);
    const bucketRelative = path.relative(bucketRoot, fullPath);
    return !bucketRelative.startsWith("..") && !path.isAbsolute(bucketRelative);
  });
}

/**
 * Executes an atomic git transaction (Add + Commit).
 */
export async function gitCommit(filePath: string, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const add = spawn("git", ["add", filePath], { cwd: workspaceRoot });
        add.on("close", (code: number | null) => {
            if (code !== 0 && code !== null) {
                return reject(new Error(`Git add failed with code ${code}`));
            }
            const commit = spawn("git", ["commit", "-m", message], { cwd: workspaceRoot });
            commit.on("close", (code: number | null) => {
                // If code is not 0, it might be "nothing to commit" which is fine for our tools
                resolve();
            });
        });
    });
}
