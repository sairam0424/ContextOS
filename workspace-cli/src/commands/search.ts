import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { intelligenceService } from "@context-os/core";

export function searchCommand(program: Command) {
  program
    .command("search")
    .description("Search across the workspace (using metadata index)")
    .argument("<query>", "Search query string")
    .option("--deep", "Force deep scan using grep")
    .action(async (query, options) => {
      const spinner = ora(`Searching for ${chalk.cyan(query)}...`).start();
      try {
        const results = await intelligenceService.search(query, { deep: options.deep });

        if (results.length === 0) {
          spinner.info(chalk.yellow("No results found."));
          return;
        }

        spinner.succeed(chalk.green(`Found ${results.length} matches:`));
        console.log("");

        results.forEach(res => {
          const typeTag = res.type === 'index' ? chalk.cyan('[Index]') : chalk.magenta('[Deep]');
          console.log(`${typeTag} ${chalk.blue(res.path)}`);
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
