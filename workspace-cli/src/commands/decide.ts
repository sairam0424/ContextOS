import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { gitCommit } from "../utils.js";

export function decideCommand(program: Command) {
  program
    .command("decide")
    .description("Log an architectural decision (ADR)")
    .argument("<project>", "Project name")
    .argument("<title>", "Decision title")
    .argument("<context>", "Context of the decision")
    .argument("<decision>", "The decision made")
    .argument("<rationale>", "Rationale for the decision")
    .action(async (project, title, context, decision, rationale) => {
      const spinner = ora(`Logging decision for ${chalk.cyan(project)}...`).start();
      try {
        const workspaceRoot = process.cwd();
        const projectDir = path.join(workspaceRoot, "projects", project);
        const decisionsFile = path.join(projectDir, "decisions.md");

        if (!(await fs.pathExists(projectDir))) {
          spinner.fail(chalk.red(`Project ${project} does not exist.`));
          return;
        }

        const date = new Date().toISOString().split("T")[0];
        const adrId = `ADR-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;

        const adrContent = `
## [${adrId}] ${title}

#hot

- **Date**: ${date}
- **Status**: Accepted
- **Context**: ${context}
- **Decision**: ${decision}
- **Rationale**: ${rationale}
\n---\n`;

        await fs.ensureDir(path.dirname(decisionsFile));
        await fs.appendFile(decisionsFile, adrContent, "utf-8");

        await gitCommit(decisionsFile, `feat(cli): log decision ${adrId} for ${project}`);

        spinner.succeed(chalk.green(`Logged decision ${adrId} in ${project}/decisions.md`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Decide failed: ${error.message}`));
      }
    });
}
