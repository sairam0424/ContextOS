import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function statusCommand(program: Command) {
  program
    .command("status")
    .description("Show workspace health and project status")
    .action(async () => {
      const opts = getOutputOpts(program);
      verbose('Checking workspace status', opts);
      const spinner = ora("Checking workspace status...").start();
      try {
        const workspaceRoot = process.cwd();
        const projectsDir = path.join(workspaceRoot, "projects");

        if (!(await fs.pathExists(projectsDir))) {
          spinner.fail(chalk.red("No projects directory found."));
          return;
        }

        const projects = await fs.readdir(projectsDir);
        const projectList: Array<{ name: string; hasMemory: boolean; lastModified?: string }> = [];

        for (const project of projects) {
          const projectPath = path.join(projectsDir, project);
          const stat = await fs.stat(projectPath);
          if (stat.isDirectory()) {
            const memoryPath = path.join(projectPath, "memory.md");
            const hasMemory = await fs.pathExists(memoryPath);
            let lastModified: string | undefined;
            if (hasMemory) {
              const memoryStat = await fs.stat(memoryPath);
              lastModified = memoryStat.mtime.toISOString();
            }
            projectList.push({ name: project, hasMemory, lastModified });
          }
        }

        const date = new Date().toISOString().split("T")[0];
        const dailyFile = path.join(workspaceRoot, "daily", `${date}.md`);
        const hasDailyLog = await fs.pathExists(dailyFile);

        if (opts.json) {
          output({ workspace: path.basename(workspaceRoot), projects: projectList, dailyLog: { date, active: hasDailyLog } }, opts);
          spinner.stop();
          return;
        }

        spinner.succeed(chalk.green(`Workspace: ${chalk.bold(path.basename(workspaceRoot))}`));

        console.log(chalk.cyan(`\n📁 Projects [${projectList.length}]:`));
        for (const p of projectList) {
          let memoryStatus = chalk.gray("(no memory)");
          if (p.hasMemory && p.lastModified) {
            memoryStatus = chalk.dim(`(last modified: ${new Date(p.lastModified).toDateString()})`);
          }
          console.log(`  - ${chalk.bold(p.name)} ${memoryStatus}`);
        }

        console.log(chalk.cyan(`\n📝 Daily Log:`));
        if (hasDailyLog) {
          console.log(`  - ${chalk.green("ACTIVE")} ${chalk.dim(`(today: ${date}.md)`)}`);
        } else {
          console.log(`  - ${chalk.yellow("MISSING")} ${chalk.dim("(run 'workspace today' to initialize)")}`);
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Status failed: ${error.message}`));
      }
    });
}
