import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function summaryCommand(program: Command) {
  program
    .command("summary")
    .description("Generate weekly summary")
    .argument("<type>", "Summary type (e.g., week)")
    .action(async (type) => {
      const opts = getOutputOpts(program);
      verbose(`Generating ${type} summary`, opts);
      const spinner = ora(`Generating ${type} summary...`).start();
      try {
        const workspaceRoot = process.cwd();
        const summaryDir = path.join(workspaceRoot, "docs", "summaries");
        const date = new Date().toISOString().split("T")[0];
        const summaryFile = path.join(summaryDir, `${date}-${type}.md`);

        await fs.ensureDir(summaryDir);

        const summaryContent = `# ${type.charAt(0).toUpperCase() + type.slice(1)} Summary — ${date}\n\n## Highlights\n- \n\n## Shipped\n- \n\n## Strategic Context\n- \n`;
        await fs.writeFile(summaryFile, summaryContent);

        spinner.succeed(chalk.green(`${type.charAt(0).toUpperCase() + type.slice(1)} summary generated at ${summaryFile}`));

        if (opts.json) {
          output({ type, date, path: summaryFile }, opts);
          return;
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Summary failed: ${error.message}`));
      }
    });
}
