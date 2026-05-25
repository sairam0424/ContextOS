import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { intelligenceService } from "@context-os/core";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function searchCommand(program: Command) {
  program
    .command("search")
    .description("Search across the workspace (using metadata index)")
    .argument("<query>", "Search query string")
    .option("--deep", "Force deep scan using grep")
    .action(async (query, options) => {
      const opts = getOutputOpts(program);
      verbose(`Searching for "${query}" (deep=${!!options.deep})`, opts);
      const spinner = ora(`Searching for ${chalk.cyan(query)}...`).start();
      try {
        const results = await intelligenceService.search(query, { deep: options.deep });

        if (results.length === 0) {
          spinner.info(chalk.yellow("No results found."));
          if (opts.json) { output([], opts); }
          return;
        }

        spinner.succeed(chalk.green(`Found ${results.length} matches:`));

        if (opts.json) {
          output(results, opts);
          return;
        }

        console.log("");

        results.forEach(res => {
          let typeTag = chalk.bold.yellow('[Hybrid]');
          if (res.type === 'deep') typeTag = chalk.magenta('[Deep]');

          const scoreDisplay = res.score ? chalk.green(` (${res.score.toFixed(2)})`) : '';
          console.log(`${typeTag}${scoreDisplay} ${chalk.blue(res.path)}`);
          if (res.title && res.title !== 'Deep Scan Result') {
            console.log(`${chalk.gray(res.title)} ${res.tags.length ? chalk.yellow(`[${res.tags.join(', ')}]`) : ''}`);
          }
          console.log(`${chalk.white(res.excerpt)}...`);
          console.log(chalk.gray('---'));
        });
      } catch (error: any) {
        spinner.fail(chalk.red(`Search failed: ${error.message}`));
      }
    });
}
