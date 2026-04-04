import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { gitCommit } from "../utils.js";

export function archiveCommand(program: Command) {
  program
    .command("archive")
    .description("Move a completed project to the archive and extract learnings")
    .argument("<project>", "Project name to archive")
    .action(async (project) => {
      const spinner = ora(`Archiving project ${chalk.cyan(project)}...`).start();
      try {
        const workspaceRoot = process.cwd();
        const projectDir = path.join(workspaceRoot, "projects", project);
        const archiveDir = path.join(workspaceRoot, "archive", "projects", project);

        if (!(await fs.pathExists(projectDir))) {
          spinner.fail(chalk.red(`Project ${project} not found in projects/`));
          return;
        }

        spinner.text = `Applying #cold tags recursively to ${project}...`;
        const projectFiles = await fs.readdir(projectDir, { recursive: true });
        
        for (const file of projectFiles) {
          const filePath = path.join(projectDir, file as string);
          if ((await fs.stat(filePath)).isFile() && filePath.endsWith(".md")) {
            let content = await fs.readFile(filePath, "utf-8");
            const activeTags = ["#hot", "#warm"];
            let modified = false;

            activeTags.forEach(t => {
              if (content.includes(t)) {
                content = content.replace(new RegExp(`${t}`, 'g'), '#cold');
                modified = true;
              }
            });

            if (modified) {
              await fs.writeFile(filePath, content, "utf-8");
            }
          }
        }

        spinner.text = `Moving ${project} to archive...`;
        await fs.ensureDir(path.dirname(archiveDir));
        await fs.move(projectDir, archiveDir, { overwrite: true });

        await gitCommit(archiveDir, `feat(cli): archive project ${project}`);

        spinner.succeed(chalk.green(`Project ${project} archived successfully to archive/projects/${project}`));
        console.log(chalk.yellow(`\n[Intelligence] Archive complete. Next step: 'workspace extract ${project}' to distill learnings.`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Archive failed: ${error.message}`));
      }
    });
}
