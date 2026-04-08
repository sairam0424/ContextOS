import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { globalIndexer } from "@context-os/core";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export function searchCommand(program: Command) {
  program
    .command("search")
    .description("Search across the workspace (using metadata index)")
    .argument("<query>", "Search query string")
    .option("--deep", "Force deep scan using grep")
    .action(async (query, options) => {
      const spinner = ora(`Searching for ${chalk.cyan(query)}...`).start();
      try {
        // 1. Try Metadata Index First
        if (!options.deep) {
          const results = await globalIndexer.search(query);
          if (results.length > 0) {
            spinner.succeed(chalk.green(`Found ${results.length} matching files in index:`));
            console.log("");
            results.forEach(res => {
              console.log(`${chalk.blue(res.path)}`);
              console.log(`${chalk.gray(res.title)} ${res.tags.length ? chalk.yellow(`[${res.tags.join(', ')}]`) : ''}`);
              console.log(`${chalk.white(res.excerpt)}...`);
              console.log(chalk.gray('---'));
            });
            return;
          }
        }

        // 2. Fallback to Deep Scan (Grep)
        spinner.text = `Performing deep scan for ${chalk.cyan(query)}...`;
        const workspaceRoot = process.cwd();
        const command = `grep -rnIE "${query}" . | head -n 20`;
        const { stdout } = await execAsync(command, { cwd: workspaceRoot });

        if (!stdout) {
          spinner.info(chalk.yellow("No results found."));
          return;
        }

        spinner.succeed(chalk.green("Deep scan results:"));
        console.log(`\n${stdout}`);
      } catch (error: any) {
        if (error.code === 1) {
            spinner.info(chalk.yellow("No results found."));
            return;
        }
        spinner.fail(chalk.red(`Search failed: ${error.message}`));
      }
    });
}
