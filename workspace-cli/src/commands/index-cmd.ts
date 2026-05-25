import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { globalIndexer } from "@context-os/core";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function indexCommand(program: Command) {
  program
    .command("index")
    .description("Rebuild the workspace intelligence index")
    .action(async () => {
      const opts = getOutputOpts(program);
      verbose('Rebuilding workspace intelligence index', opts);
      const spinner = ora("Indexing workspace context...").start();
      try {
        const index = await globalIndexer.reindex();

        if (opts.json) {
          output({ recordCount: index.records.length, records: index.records }, opts);
          spinner.stop();
          return;
        }

        spinner.succeed(chalk.green(`Index rebuilt: ${index.records.length} files processed.`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Indexing failed: ${error.message}`));
      }
    });
}
