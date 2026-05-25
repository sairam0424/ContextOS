import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { gitCommit } from "../utils.js";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function tagCommand(program: Command) {
  program
    .command("tag")
    .description("Update the lifecycle tag of a context file")
    .argument("<file>", "Path to the file to tag")
    .argument("<tag>", "The new tag (e.g., #hot, #warm, #cold, #permanent)")
    .action(async (file, tag) => {
      const opts = getOutputOpts(program);
      verbose(`Tagging "${file}" with ${tag}`, opts);
      const spinner = ora(`Updating tag for ${chalk.cyan(file)} to ${chalk.yellow(tag)}...`).start();
      try {
        const workspaceRoot = process.cwd();
        const filePath = path.join(workspaceRoot, file);

        if (!(await fs.pathExists(filePath))) {
          spinner.fail(chalk.red(`File ${file} not found.`));
          return;
        }

        let content = await fs.readFile(filePath, "utf-8");
        const lifecycleTags = ["#hot", "#warm", "#cold", "#permanent"];

        // Remove existing lifecycle tags
        lifecycleTags.forEach(t => {
          content = content.replace(new RegExp(`${t}(\\s*|\\n*)`, 'g'), '');
        });

        // Add new tag at the top (after h1 if exists, else very top)
        if (content.startsWith("# ")) {
          const lines = content.split("\n");
          lines.splice(1, 0, `\n${tag}\n`);
          content = lines.join("\n");
        } else {
          content = `${tag}\n\n${content}`;
        }

        await fs.writeFile(filePath, content, "utf-8");
        await gitCommit(file, `refactor(cli): update lifecycle tag of ${file} to ${tag}`);

        spinner.succeed(chalk.green(`File ${file} tagged with ${tag} successfully.`));

        if (opts.json) {
          output({ file, tag, success: true }, opts);
          return;
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Tagging failed: ${error.message}`));
      }
    });
}
