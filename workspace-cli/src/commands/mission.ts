import { Command } from "commander";
import chalk from "chalk";
import { missionService } from "@context-os/core";

export function missionCommand(program: Command) {
  const mission = program.command("mission").description("Manage workspace missions");

  mission
    .command("create <title>")
    .description("Create a new mission")
    .option("-p, --priority <n>", "Priority (1-5)", "1")
    .action((title: string, opts) => {
      try {
        const m = missionService.create(title, { priority: parseInt(opts.priority, 10) });
        console.log(chalk.green(`✅ Mission created: ${m.title}`));
        console.log(chalk.dim(`   Path: ${m.path}`));
        console.log(chalk.dim(`   Priority: ${m.priority}`));
      } catch (error: any) {
        console.error(chalk.red(`❌ Failed: ${error.message}`));
        process.exit(1);
      }
    });

  mission
    .command("list")
    .description("List missions")
    .option("-s, --status <status>", "Filter by status (active|completed|paused|archived)")
    .action((opts) => {
      const missions = missionService.list(opts.status);
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
    .action((path: string) => {
      missionService.complete(path);
      console.log(chalk.green(`✅ Mission completed: ${path}`));
    });

  mission
    .command("archive <path>")
    .description("Archive a mission")
    .action((path: string) => {
      missionService.archive(path);
      console.log(chalk.dim(`📦 Mission archived: ${path}`));
    });
}
