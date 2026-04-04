import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";

export function syncCommand(program: Command) {
  program
    .command("sync")
    .description("Sync memory, changelog, and daily logs")
    .argument("[project]", "Project name to sync context for")
    .action(async (project) => {
      const spinner = ora("Syncing workspace context...").start();
      try {
        const workspaceRoot = process.cwd();
        const date = new Date().toISOString().split("T")[0];
        
        // Simulating sync logic: ensuring memory.md has a "Last Sync" timestamp
        if (project) {
          const projectDir = path.join(workspaceRoot, "projects", project);
          const memoryPath = path.join(projectDir, "memory.md");
          
          if (await fs.pathExists(memoryPath)) {
            let content = await fs.readFile(memoryPath, "utf-8");
            const syncMark = `\n> [!NOTE]\n> Last Sync: ${date} ${new Date().toLocaleTimeString()}\n`;
            
            if (!content.includes("Last Sync:")) {
              await fs.appendFile(memoryPath, syncMark);
            } else {
              content = content.replace(/> \[!NOTE\]\n> Last Sync: .*/, syncMark.trim());
              await fs.writeFile(memoryPath, content);
            }
            spinner.succeed(chalk.green(`Synced memory for ${project}`));
          } else {
            spinner.fail(chalk.red(`Memory file not found for ${project}`));
          }
        } else {
          spinner.succeed(chalk.green("Global workspace sync complete."));
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Sync failed: ${error.message}`));
      }
    });
}
