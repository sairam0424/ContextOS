import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function contextCommand(program: Command) {
  program
    .command("context")
    .description("Print agent boot context for a project")
    .argument("<project>", "Project name")
    .action(async (project) => {
      const opts = getOutputOpts(program);
      verbose(`Loading context for project "${project}"`, opts);
      const spinner = ora(`Loading context for ${chalk.cyan(project)}...`).start();
      try {
        const workspaceRoot = process.cwd();
        const projectDir = path.join(workspaceRoot, "projects", project);

        if (!(await fs.pathExists(projectDir))) {
          spinner.fail(chalk.red(`Project ${project} not found.`));
          return;
        }

        const files = ["CONTEXT.md", "memory.md", "tasks/active.md"];
        const contextData: Record<string, string> = {};

        for (const file of files) {
          const filePath = path.join(projectDir, file);
          if (await fs.pathExists(filePath)) {
            const content = await fs.readFile(filePath, "utf-8");
            contextData[file] = content;
          }
        }

        spinner.succeed(chalk.green(`Loaded context for ${project}`));

        if (opts.json) {
          output({ project, files: contextData }, opts);
          return;
        }

        let aggregatedContext = `\n${chalk.bold("--- BOOT CONTEXT: " + project + " ---")}\n`;
        for (const [file, content] of Object.entries(contextData)) {
          aggregatedContext += `\n${chalk.yellow(file)}\n${content}\n`;
        }
        console.log(aggregatedContext);
      } catch (error: any) {
        spinner.fail(chalk.red(`Context failed: ${error.message}`));
      }
    });
}
