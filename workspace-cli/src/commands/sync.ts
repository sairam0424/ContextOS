import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { workspaceService } from "@context-os/core";
import { EXIT_CODES, exitWithCode } from '../exit-codes.js';

export function syncCommand(program: Command) {
  program
    .command("sync")
    .description("Sync memory, changelog, and daily logs")
    .argument("[project]", "Project name to sync context for")
    .option("--force", "Force full re-index of the workspace")
    .action(async (project, options) => {
      const spinner = ora("Syncing workspace context...").start();
      try {
        const result = await workspaceService.sync(project, { force: options.force });
        
        if (result.success) {
          spinner.succeed(chalk.green(result.message));
        } else {
          spinner.fail(chalk.red(result.message));
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Sync failed: ${error.message}`));
        const isNotInitialized = error.message?.toLowerCase().includes('not initialized') ||
          error.code === 'WORKSPACE_NOT_INITIALIZED';
        if (isNotInitialized) {
          exitWithCode(EXIT_CODES.WORKSPACE_NOT_INITIALIZED, 'Workspace is not initialized. Run "workspace init" first.');
        }
        exitWithCode(EXIT_CODES.GENERAL_ERROR, error.message);
      }
    });
}
