import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";

export function statusCommand(program: Command) {
  program
    .command("status")
    .description("Show workspace health and project status")
    .action(async () => {
      const spinner = ora("Checking workspace status...").start();
      try {
        const workspaceRoot = process.cwd();
        const projectsDir = path.join(workspaceRoot, "projects");
        
        if (!(await fs.pathExists(projectsDir))) {
          spinner.fail(chalk.red("No projects directory found."));
          return;
        }

        const projects = await fs.readdir(projectsDir);
        spinner.succeed(chalk.green(`Workspace: ${chalk.bold(path.basename(workspaceRoot))}`));

        console.log(chalk.cyan(`\n📁 Projects [${projects.length}]:`));
        for (const project of projects) {
          const projectPath = path.join(projectsDir, project);
          const stat = await fs.stat(projectPath);
          if (stat.isDirectory()) {
            const memoryPath = path.join(projectPath, "memory.md");
            let memoryStatus = chalk.gray("(no memory)");
            if (await fs.pathExists(memoryPath)) {
              const memoryStat = await fs.stat(memoryPath);
              memoryStatus = chalk.dim(`(last modified: ${memoryStat.mtime.toDateString()})`);
            }
            console.log(`  - ${chalk.bold(project)} ${memoryStatus}`);
          }
        }

        const date = new Date().toISOString().split("T")[0];
        const dailyFile = path.join(workspaceRoot, "daily", `${date}.md`);
        console.log(chalk.cyan(`\n📝 Daily Log:`));
        if (await fs.pathExists(dailyFile)) {
          console.log(`  - ${chalk.green("ACTIVE")} ${chalk.dim(`(today: ${date}.md)`)}`);
        } else {
          console.log(`  - ${chalk.yellow("MISSING")} ${chalk.dim("(run 'workspace today' to initialize)")}`);
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Status failed: ${error.message}`));
      }
    });
}
