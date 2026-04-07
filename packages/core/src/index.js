import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
/**
 * Discovers the workspace root by looking for root/soul.md in parent directories.
 */
export function findWorkspaceRoot() {
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
/**
 * Validates that a path is within the workspace root and inside an allowed bucket.
 */
export function validatePath(requestedPath) {
    const resolvedPath = path.resolve(workspaceRoot, requestedPath);
    let fullPath;
    try {
        fullPath = fs.realpathSync(resolvedPath);
    }
    catch (e) {
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
export function isReadOnly(filePath) {
    const { fullPath } = validatePath(filePath);
    const readOnlyBuckets = ["knowledge", "schemas", "root"];
    return readOnlyBuckets.some(bucket => {
        const bucketRoot = path.join(workspaceRoot, bucket);
        const bucketRelative = path.relative(bucketRoot, fullPath);
        return !bucketRelative.startsWith("..") && !path.isAbsolute(bucketRelative);
    });
}
/**
 * Executes an atomic git transaction (Add + Commit).
 */
export async function gitCommit(filePath, message) {
    return new Promise((resolve, reject) => {
        const add = spawn("git", ["add", filePath], { cwd: workspaceRoot });
        add.on("close", (code) => {
            if (code !== 0 && code !== null) {
                return reject(new Error(`Git add failed with code ${code}`));
            }
            const commit = spawn("git", ["commit", "-m", message], { cwd: workspaceRoot });
            commit.on("close", (code) => {
                // If code is not 0, it might be "nothing to commit" which is fine for our tools
                resolve();
            });
        });
    });
}
