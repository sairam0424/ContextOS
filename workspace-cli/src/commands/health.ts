import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function healthCommand(program: Command) {
  program
    .command("health")
    .description("Perform a workspace integrity audit")
    .action(async () => {
      const opts = getOutputOpts(program);
      verbose('Running workspace health audit', opts);
      const spinner = ora("Auditing workspace health...").start();
      try {
        const workspaceRoot = process.cwd();
        const projectsDir = path.join(workspaceRoot, "projects");
        const issuesFound: string[] = [];
        const staleFiles: string[] = [];

        if (!(await fs.pathExists(projectsDir))) {
          spinner.fail(chalk.red("Projects directory not found."));
          return;
        }

        const projects = await fs.readdir(projectsDir);
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        for (const project of projects) {
          const projectPath = path.join(projectsDir, project);
          const stats = await fs.stat(projectPath);

          if (stats.isDirectory()) {
            const memoryFile = path.join(projectPath, "memory.md");
            const changelogFile = path.join(projectPath, "changelog.md");
            const decisionsFile = path.join(projectPath, "decisions.md");

            if (!(await fs.pathExists(memoryFile))) {
              issuesFound.push(`[${project}] Missing memory.md`);
            }
            if (!(await fs.pathExists(changelogFile))) {
              issuesFound.push(`[${project}] Missing changelog.md`);
            }
            if (!(await fs.pathExists(decisionsFile))) {
              issuesFound.push(`[${project}] Missing decisions.md`);
            }

            // Check for stale #hot files
            const files = await fs.readdir(projectPath, { recursive: true });
            for (const file of files) {
              const filePath = path.join(projectPath, file as string);
              const fileStats = await fs.stat(filePath);
              if (fileStats.isFile() && filePath.endsWith(".md")) {
                const content = await fs.readFile(filePath, "utf-8");
                if (content.includes("#hot")) {
                  const mtime = fileStats.mtimeMs;
                  if (now - mtime > SEVEN_DAYS_MS) {
                    staleFiles.push(`[${project}] ${file} has stale #hot tag (> 7 days since update)`);
                  }
                }
              }
            }
          }
        }

        if (opts.json) {
          output({ issues: issuesFound, staleFiles, issueCount: issuesFound.length, staleCount: staleFiles.length }, opts);
          spinner.stop();
          return;
        }

        if (issuesFound.length > 0 || staleFiles.length > 0) {
          spinner.warn(chalk.yellow(`Workspace audit complete: Found ${issuesFound.length} issues and ${staleFiles.length} stale tags.`));

          if (issuesFound.length > 0) {
            console.log(chalk.red("\nCritical Issues:"));
            issuesFound.forEach((issue) => console.log(`- ${issue}`));
          }

          if (staleFiles.length > 0) {
            console.log(chalk.yellow("\nStale Context Warnings:"));
            staleFiles.forEach((stale) => console.log(`- ${stale}`));
            console.log(chalk.cyan("\nTip: Run 'workspace archive <project>' or 'workspace tag <file> #warm' to update lifecycle state."));
          }
        } else {
          spinner.succeed(chalk.green("Workspace integrity audit complete: 0 issues found."));
        }

        console.log(chalk.cyan("\n[Intelligence] Audit complete. Use 'workspace extract' to distill learnings from completed projects."));
      } catch (error: any) {
        spinner.fail(chalk.red(`Health audit failed: ${error.message}`));
      }
    });
}
