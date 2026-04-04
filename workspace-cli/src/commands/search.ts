import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export function searchCommand(program: Command) {
  program
    .command("search")
    .description("Search across the workspace")
    .argument("<query>", "Search query string")
    .action(async (query) => {
      const spinner = ora(`Searching for ${chalk.cyan(query)}...`).start();
      try {
        const workspaceRoot = process.cwd();
        
        // Use grep -rnI as a robust default
        const command = `grep -rnIE "${query}" . | head -n 20`;
        const { stdout } = await execAsync(command, { cwd: workspaceRoot });

        if (!stdout) {
          spinner.info(chalk.yellow("No results found."));
          return;
        }

        spinner.succeed(chalk.green("Search results:"));
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
