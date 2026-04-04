import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { gitCommit } from "../utils.js";

export function initCommand(program: Command) {
  program
    .command("init")
    .description("Initialize a new ContextOS project structure")
    .argument("<name>", "Project name")
    .option("-o, --org <org>", "Organization name", "personal")
    .action(async (name, options) => {
      const spinner = ora(`Initializing project ${chalk.cyan(name)}...`).start();
      try {
        const workspaceRoot = process.cwd();
        const projectDir = path.join(workspaceRoot, "projects", name);
        
        if (await fs.pathExists(projectDir)) {
          spinner.fail(chalk.red(`Project directory already exists at ${projectDir}`));
          return;
        }

        // Create structure
        await fs.ensureDir(projectDir);
        await fs.ensureDir(path.join(projectDir, "tasks"));
        await fs.ensureDir(path.join(projectDir, "decisions"));

        // Copy templates if they exist, otherwise create blanks
        const templateMap = {
          "CONTEXT.md": "# Project Context",
          "memory.md": "# Project Memory",
          "phases.md": "# Project Phases",
          "SOUL.md": "# Project Soul",
          "HEARTBEAT.md": "# Project Heartbeat"
        };

        for (const [file, content] of Object.entries(templateMap)) {
          await fs.writeFile(path.join(projectDir, file), content);
        }

        await gitCommit(projectDir, `feat(cli): initialize project ${name}`);

        spinner.succeed(chalk.green(`Project ${name} initialized successfully in ${projectDir}`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Init failed: ${error.message}`));
      }
    });
}
