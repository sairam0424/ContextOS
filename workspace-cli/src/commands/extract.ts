import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";

export function extractCommand(program: Command) {
  program
    .command("extract")
    .description("Analyze project context and help distill learnings into the Knowledge Base")
    .argument("<project>", "Project name to analyze")
    .action(async (project) => {
      const spinner = ora(`Analyzing project ${chalk.cyan(project)} for intelligence distillation...`).start();
      try {
        const workspaceRoot = process.cwd();
        const projectDir = path.join(workspaceRoot, "projects", project);
        const archiveDir = path.join(workspaceRoot, "archive", "projects", project);
        
        // Check in projects/ or archive/projects/
        const targetPath = (await fs.pathExists(projectDir)) ? projectDir : 
                           (await fs.pathExists(archiveDir)) ? archiveDir : null;

        if (!targetPath) {
          spinner.fail(chalk.red(`Project ${project} not found in projects/ or archive/projects/`));
          return;
        }

        const decisionsFile = path.join(targetPath, "decisions.md");
        const memoryFile = path.join(targetPath, "memory.md");

        const insights = [];
        
        if (await fs.pathExists(decisionsFile)) {
          const content = await fs.readFile(decisionsFile, "utf-8");
          const decisionCount = (content.match(/\[ADR-\d+\]/g) || []).length;
          insights.push(`${chalk.cyan(decisionCount)} architectural decisions found in decisions.md`);
        } else {
          insights.push(chalk.yellow(`Warning: No decisions.md found for ADR extraction.`));
        }

        if (await fs.pathExists(memoryFile)) {
          insights.push(`Project memory file found for context distillation.`);
        }

        spinner.succeed(chalk.green(`Analysis of ${project} complete.`));
        
        console.log(chalk.bold("\n--- Extraction Guide ---"));
        insights.forEach(insight => console.log(`- ${insight}`));
        
        console.log(chalk.cyan("\n[Intelligence Layer] Next steps:"));
        console.log(`1. Review the ADRs in ${targetPath}/decisions.md`);
        console.log(`2. Distill reusable patterns into knowledge/domains/`);
        console.log(`3. Use 'workspace tag <file' to mark files as #warm or #permanent.`);
        console.log(`4. Archive project if not already done using 'workspace archive ${project}'.`);

      } catch (error: any) {
        spinner.fail(chalk.red(`Extraction guide failed: ${error.message}`));
      }
    });
}
