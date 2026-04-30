import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { gitCommit } from "../utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function initCommand(program: Command) {
  program
    .command("init")
    .description("Initialize a new ContextOS project or full workspace")
    .argument("[name]", "Project name (optional for initial workspace setup)")
    .option("-o, --org <org>", "Organization name", "personal")
    .action(async (name, options) => {
      const spinner = ora("Checking workspace status...").start();
      try {
        const workspaceRoot = process.cwd();
        const soulPath = path.join(workspaceRoot, "root", "soul.md");
        const templatesDir = path.resolve(__dirname, "..", "templates");

        // 1. Workspace Bootstrapping (Zero-Clone Support)
        if (!(await fs.pathExists(soulPath))) {
          spinner.text = chalk.yellow("No ContextOS workspace detected. Bootstrapping new workspace...");
          
          const folders = ["root", "schemas", "projects", "knowledge"];
          for (const folder of folders) {
            const src = path.join(templatesDir, folder);
            if (await fs.pathExists(src)) {
              await fs.copy(src, path.join(workspaceRoot, folder));
            } else {
              await fs.ensureDir(path.join(workspaceRoot, folder));
            }
          }

          // Copy .gitignore
          const gitignoreSrc = path.join(templatesDir, "dot-gitignore");
          if (await fs.pathExists(gitignoreSrc)) {
            await fs.copy(gitignoreSrc, path.join(workspaceRoot, ".gitignore"));
          }

          spinner.info(chalk.green("Workspace structure created."));
          spinner.start("Initializing project...");
        }

        // If no name provided, we just did the workspace setup
        if (!name) {
          spinner.succeed(chalk.green("ContextOS workspace initialized successfully."));
          return;
        }

        // 2. Project Initialization
        const projectDir = path.join(workspaceRoot, "projects", name);
        
        if (await fs.pathExists(projectDir)) {
          spinner.fail(chalk.red(`Project directory already exists at ${projectDir}`));
          return;
        }

        // Create structure
        await fs.ensureDir(projectDir);
        await fs.ensureDir(path.join(projectDir, "tasks"));
        await fs.ensureDir(path.join(projectDir, "decisions"));

        // Create blanks
        const templateMap = {
          "CONTEXT.md": "# Project Context\n\n#hot",
          "memory.md": "# Project Memory\n\n#hot",
          "phases.md": "# Project Phases\n\n#hot",
          "SOUL.md": "# Project Soul\n\n#hot",
          "HEARTBEAT.md": "# Project Heartbeat\n\n#hot"
        };

        for (const [file, content] of Object.entries(templateMap)) {
          await fs.writeFile(path.join(projectDir, file), content);
        }

        await gitCommit(workspaceRoot, `feat(cli): initialize project ${name}`);

        spinner.succeed(chalk.green(`Project '${name}' initialized successfullly.`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Init failed: ${error.message}`));
      }
    });
}
