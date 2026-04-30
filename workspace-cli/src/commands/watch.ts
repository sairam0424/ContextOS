import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { watchService, globalIndexer, samplingService, intelligenceQueue } from "@context-os/core";

export function watchCommand(program: Command) {
  program
    .command("watch")
    .description("Start real-time workspace monitoring and intelligence sync")
    .action(async () => {
      console.log(chalk.bold.cyan("\n📡 ContextOS Intelligence Monitor v1.12.0"));
      console.log(chalk.dim("Press Ctrl+C to stop monitoring\n"));

      const spinner = ora("Initializing workspace sweep...").start();

      try {
        // 1. Initial Incremental Sweep (as approved in plan)
        await globalIndexer.reindex();
        spinner.succeed("Initial sweep complete. Workspace is synchronized.");

        // 2. Start Watch Service & Intelligence Queue
        watchService.start();
        intelligenceQueue.start();

        const pulse = await samplingService.getPulse();
        console.log(chalk.green(`\n✅ Intelligence Layer Active`));
        console.log(chalk.dim(`   - Health Score: ${pulse.healthScore}%`));
        console.log(chalk.dim(`   - Nodes Mapped: ${pulse.recentChanges.length}+`));
        console.log("");

        const statusSpinner = ora("Monitoring for changes...").start();

        // 3. Handle graceful shutdown
        process.on("SIGINT", () => {
          statusSpinner.stop();
          watchService.stop();
          intelligenceQueue.stop();
          console.log(chalk.yellow("\n👋 Watch service stopped. Workspace remains indexed."));
          process.exit(0);
        });

      } catch (error) {
        spinner.fail("Failed to start watch service.");
        console.error(chalk.red(error));
        process.exit(1);
      }
    });
}
