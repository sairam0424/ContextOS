import { Command } from "commander";
import chalk from "chalk";
import { missionService } from "@context-os/core";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function missionCommand(program: Command) {
  const mission = program.command("mission").description("Manage workspace missions");

  mission
    .command("create <title>")
    .description("Create a new mission")
    .option("-p, --priority <n>", "Priority (1-5)", "1")
    .action((title: string, cmdOpts) => {
      const opts = getOutputOpts(program);
      verbose(`Creating mission "${title}"`, opts);
      try {
        const m = missionService.create(title, { priority: parseInt(cmdOpts.priority, 10) });

        if (opts.json) {
          output(m, opts);
          return;
        }

        console.log(chalk.green(`Mission created: ${m.title}`));
        console.log(chalk.dim(`   Path: ${m.path}`));
        console.log(chalk.dim(`   Priority: ${m.priority}`));
      } catch (error: any) {
        console.error(chalk.red(`Failed: ${error.message}`));
        process.exit(1);
      }
    });

  mission
    .command("list")
    .description("List missions")
    .option("-s, --status <status>", "Filter by status (active|completed|paused|archived)")
    .action((cmdOpts) => {
      const opts = getOutputOpts(program);
      verbose('Listing missions', opts);
      const missions = missionService.list(cmdOpts.status);

      if (opts.json) {
        output(missions, opts);
        return;
      }

      if (missions.length === 0) {
        console.log(chalk.dim("No missions found."));
        return;
      }
      missions.forEach(m => {
        const statusColor = m.status === 'active' ? chalk.green : m.status === 'completed' ? chalk.dim : chalk.yellow;
        console.log(`${statusColor(`[${m.status}]`)} ${chalk.bold(m.title)} ${chalk.dim(`(priority: ${m.priority})`)}`);
        console.log(chalk.dim(`  ${m.path}`));
      });
    });

  mission
    .command("complete <path>")
    .description("Mark a mission as completed")
    .action((missionPath: string) => {
      const opts = getOutputOpts(program);
      missionService.complete(missionPath);

      if (opts.json) {
        output({ completed: missionPath }, opts);
        return;
      }

      console.log(chalk.green(`Mission completed: ${missionPath}`));
    });

  mission
    .command("archive <path>")
    .description("Archive a mission")
    .action((missionPath: string) => {
      const opts = getOutputOpts(program);
      missionService.archive(missionPath);

      if (opts.json) {
        output({ archived: missionPath }, opts);
        return;
      }

      console.log(chalk.dim(`Mission archived: ${missionPath}`));
    });
}
