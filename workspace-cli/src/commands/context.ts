import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";

export function contextCommand(program: Command) {
  program
    .command("context")
    .description("Print agent boot context for a project")
    .argument("<project>", "Project name")
    .action(async (project) => {
      const spinner = ora(`Loading context for ${chalk.cyan(project)}...`).start();
      try {
        const workspaceRoot = process.cwd();
        const projectDir = path.join(workspaceRoot, "projects", project);
        
        if (!(await fs.pathExists(projectDir))) {
          spinner.fail(chalk.red(`Project ${project} not found.`));
          return;
        }

        const files = ["CONTEXT.md", "memory.md", "tasks/active.md"];
        let aggregatedContext = `\n${chalk.bold("--- 🚀 BOOT CONTEXT: " + project + " ---")}\n`;

        for (const file of files) {
          const filePath = path.join(projectDir, file);
          if (await fs.pathExists(filePath)) {
            const content = await fs.readFile(filePath, "utf-8");
            aggregatedContext += `\n${chalk.yellow("📁 " + file)}\n${content}\n`;
          }
        }

        spinner.succeed(chalk.green(`Loaded context for ${project}`));
        console.log(aggregatedContext);
      } catch (error: any) {
        spinner.fail(chalk.red(`Context failed: ${error.message}`));
      }
    });
}
