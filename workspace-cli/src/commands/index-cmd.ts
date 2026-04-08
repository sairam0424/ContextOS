import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { globalIndexer } from "@context-os/core";

export function indexCommand(program: Command) {
  program
    .command("index")
    .description("Rebuild the workspace intelligence index")
    .action(async () => {
      const spinner = ora("Indexing workspace context...").start();
      try {
        const index = await globalIndexer.reindex();
        spinner.succeed(chalk.green(`Index rebuilt: ${index.records.length} files processed.`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Indexing failed: ${error.message}`));
      }
    });
}
