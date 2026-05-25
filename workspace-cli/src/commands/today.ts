import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { gitCommit } from "../utils.js";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function todayCommand(program: Command) {
  program
    .command("today")
    .alias("daily")
    .description("Open or create today's daily log")
    .action(async () => {
      const opts = getOutputOpts(program);
      verbose('Setting up daily log', opts);
      const spinner = ora("Setting up today's log...").start();
      try {
        const workspaceRoot = process.cwd();
        const date = new Date().toISOString().split("T")[0];
        const dailyDir = path.join(workspaceRoot, "daily");
        const dailyFile = path.join(dailyDir, `${date}.md`);

        await fs.ensureDir(dailyDir);

        let created = false;
        if (!(await fs.pathExists(dailyFile))) {
          const templatesDir = path.join(workspaceRoot, "config", "templates");
          const logTemplatePath = path.join(templatesDir, "daily-log.md");

          let templateContent = `# Daily Log — ${date}\n\n#hot\n\n## Focus\n- \n\n## Completed\n- \n\n## Notes\n- \n`;

          if (await fs.pathExists(logTemplatePath)) {
            templateContent = await fs.readFile(logTemplatePath, "utf-8");
            templateContent = templateContent.replace("{{date}}", date);
          }

          await fs.writeFile(dailyFile, templateContent);
          await gitCommit(dailyFile, `feat(cli): create daily log for ${date}`);
          created = true;
          spinner.succeed(chalk.green(`Created today's log at ${dailyFile}`));
        } else {
          spinner.info(chalk.blue(`Today's log already exists at ${dailyFile}`));
        }

        if (opts.json) {
          output({ date, path: dailyFile, created }, opts);
          return;
        }

        console.log(chalk.cyan(`\nRun 'workspace sync' after your session to finalize context.`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Today failed: ${error.message}`));
      }
    });
}
