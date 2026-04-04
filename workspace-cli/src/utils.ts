import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Commits a file change to git from the CLI.
 * Simple wrapper around git add and commit.
 */
export async function gitCommit(filePath: string, message: string) {
  try {
    const root = process.cwd();
    await execAsync(`git add "${filePath}"`, { cwd: root });
    await execAsync(`git commit -m "${message}"`, { cwd: root });
    return true;
  } catch (error: any) {
    if (error.stdout?.includes("nothing to commit")) return true;
    console.warn(`[Git] Warning: Could not auto-commit ${filePath}: ${error.message}`);
    return false;
  }
}
