import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";

export function pruneCommand(program: Command) {
  program
    .command("prune")
    .description("Remove stale logs and clean up the workspace")
    .option('--dry-run', 'Show what would be pruned without making changes')
    .action(async (opts) => {
      const isDryRun = opts.dryRun ?? false;
      const spinner = ora("Cleaning up workspace...").start();
      try {
        const workspaceRoot = process.cwd();
        const dailyDir = path.join(workspaceRoot, "daily");
        const tmpDir = path.join(workspaceRoot, "tmp");

        let prunedCount = 0;
        const itemsToPrune: string[] = [];

        // 1. Clean up tmp/
        if (await fs.pathExists(tmpDir)) {
          const files = await fs.readdir(tmpDir);
          for (const file of files) {
            if (isDryRun) {
              itemsToPrune.push(path.join(tmpDir, file));
            } else {
              await fs.remove(path.join(tmpDir, file));
            }
            prunedCount++;
          }
        }

        // 2. Identify redundant headers or stale session files
        // (Simplified for now - we'll just check if anything is tagged with #stale)

        if (isDryRun) {
          spinner.stop();
          console.log(chalk.yellow('DRY RUN — no changes will be made:'));
          if (itemsToPrune.length === 0) {
            console.log(chalk.dim('  Nothing to prune.'));
          } else {
            for (const item of itemsToPrune) {
              console.log(chalk.dim(`  Would remove: ${item}`));
            }
          }
          console.log(chalk.yellow(`\nTotal: ${prunedCount} item(s) would be pruned.`));
          return;
        }

        spinner.succeed(chalk.green(`Workspace pruned: ${prunedCount} temporary items removed.`));
        console.log(chalk.yellow(`\n[Intelligence] Pruning complete. Next step: 'workspace archive' for finished projects.`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Prune failed: ${error.message}`));
      }
    });
}
