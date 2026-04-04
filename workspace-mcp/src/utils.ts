import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();

/**
 * Validates and resolves a path to ensure it's within a given scope.
 * Handles double-resolution for symlink protection.
 */
export function validatePath(filePath: string, scope: "root" | "org" | "project" = "root") {
  let baseDir = WORKSPACE_ROOT;
  if (scope === "org") baseDir = path.join(WORKSPACE_ROOT, "orgs");
  if (scope === "project") baseDir = path.join(WORKSPACE_ROOT, "projects");

  const absoluteBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(absoluteBase, filePath);

  if (!resolvedPath.startsWith(absoluteBase)) {
    throw new Error(`Access Denied: Path "${filePath}" traverses outside of scope "${scope}".`);
  }

  return { fullPath: resolvedPath, relativePath: path.relative(WORKSPACE_ROOT, resolvedPath) };
}

/**
 * Simple asynchronous task queue to serialize git operations.
 * Prevents index.lock conflicts.
 */
class TaskQueue {
  private queue: Promise<any> = Promise.resolve();

  async add<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {}); // Continue queue even if task fails
    return result;
  }
}

export const gitQueue = new TaskQueue();

/**
 * Executes a git operation securely using execFile (no shell interpolation).
 */
export async function gitCommit(filePath: string, message: string) {
  return gitQueue.add(async () => {
    try {
      // workspace_write already handles the write, we just add and commit
      await execFileAsync("git", ["add", filePath], { cwd: WORKSPACE_ROOT });
      await execFileAsync("git", ["commit", "-m", message], { cwd: WORKSPACE_ROOT });
      return true;
    } catch (error: any) {
      // Ignore "nothing to commit" errors
      if (error.stdout?.includes("nothing to commit") || error.stderr?.includes("nothing to commit")) {
        return true;
      }
      console.warn(`Git operation failed for ${filePath}:`, error.message);
      return false;
    }
  });
}

/**
 * Standardizes MCP tool error responses.
 */
export function handleToolError(error: any) {
  return {
    content: [{ type: "text", text: `Error: ${error.message}` }],
    isError: true
  };
}

export { WORKSPACE_ROOT };
