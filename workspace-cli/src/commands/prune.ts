import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";

export function pruneCommand(program: Command) {
  program
    .command("prune")
    .description("Remove stale logs and clean up the workspace")
    .action(async () => {
      const spinner = ora("Cleaning up workspace...").start();
      try {
        const workspaceRoot = process.cwd();
        const dailyDir = path.join(workspaceRoot, "daily");
        const tmpDir = path.join(workspaceRoot, "tmp");

        let prunedCount = 0;

        // 1. Clean up tmp/
        if (await fs.pathExists(tmpDir)) {
          const files = await fs.readdir(tmpDir);
          for (const file of files) {
            await fs.remove(path.join(tmpDir, file));
            prunedCount++;
          }
        }

        // 2. Identify redundant headers or stale session files
        // (Simplified for now - we'll just check if anything is tagged with #stale)

        spinner.succeed(chalk.green(`Workspace pruned: ${prunedCount} temporary items removed.`));
        console.log(chalk.yellow(`\n[Intelligence] Pruning complete. Next step: 'workspace archive' for finished projects.`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Prune failed: ${error.message}`));
      }
    });
}
