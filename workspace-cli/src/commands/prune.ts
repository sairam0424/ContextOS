import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { createInterface } from "node:readline";
import { EXIT_CODES } from '../exit-codes.js';

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

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
        const tmpDir = path.join(workspaceRoot, "tmp");

        const itemsToPrune: string[] = [];

        // 1. Identify items to prune in tmp/
        if (await fs.pathExists(tmpDir)) {
          const files = await fs.readdir(tmpDir);
          for (const file of files) {
            itemsToPrune.push(path.join(tmpDir, file));
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
          console.log(chalk.yellow(`\nTotal: ${itemsToPrune.length} item(s) would be pruned.`));
          return;
        }

        spinner.stop();
        const confirmed = await confirm(`Are you sure you want to prune ${itemsToPrune.length} item(s) from the workspace?`);
        if (!confirmed) {
          console.log(chalk.yellow('Prune cancelled.'));
          process.exit(EXIT_CODES.SUCCESS);
        }
        spinner.start();

        for (const item of itemsToPrune) {
          await fs.remove(item);
        }

        spinner.succeed(chalk.green(`Workspace pruned: ${itemsToPrune.length} temporary items removed.`));
        console.log(chalk.yellow(`\n[Intelligence] Pruning complete. Next step: 'workspace archive' for finished projects.`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Prune failed: ${error.message}`));
      }
    });
}
