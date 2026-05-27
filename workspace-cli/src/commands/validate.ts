import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { validationService } from "@context-os/core";
import { getOutputOpts, output, verbose } from '../utils/output.js';
import { EXIT_CODES, exitWithCode } from '../exit-codes.js';

export function validateCommand(program: Command) {
  program
    .command("validate")
    .description("Validate workspace files against JSON schemas")
    .action(async () => {
      const opts = getOutputOpts(program);
      verbose('Validating workspace integrity against schemas', opts);
      const spinner = ora("Validating workspace integrity...").start();
      try {
        const result = await validationService.validateWorkspace();

        if (opts.json) {
          output(result, opts);
          spinner.stop();
          if (!result.valid) exitWithCode(EXIT_CODES.VALIDATION_FAILED);
          return;
        }

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
          exitWithCode(EXIT_CODES.VALIDATION_FAILED);
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Validation error: ${error.message}`));
        exitWithCode(EXIT_CODES.GENERAL_ERROR, error.message);
      }
    });
}
