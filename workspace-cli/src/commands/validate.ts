import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { validationService } from "@context-os/core";

export function validateCommand(program: Command) {
  program
    .command("validate")
    .description("Validate workspace files against JSON schemas")
    .action(async () => {
      const spinner = ora("Validating workspace integrity...").start();
      try {
        const result = await validationService.validateWorkspace();

        if (result.valid) {
          spinner.succeed(chalk.green("Workspace validation successful! All files conform to schema."));
        } else {
          spinner.fail(chalk.red(`Workspace validation failed with ${result.issues.length} issues.`));
          console.log("");
          result.issues.forEach(issue => {
            console.log(chalk.red(`\n❌ ${issue.message} in ${issue.project}/${issue.file}`));
            if (issue.details) {
               // Optional: console.log(chalk.yellow(`   - detail: ${JSON.stringify(issue.details)}`));
            }
          });
          process.exit(1);
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Validation error: ${error.message}`));
        process.exit(1);
      }
    });
}
