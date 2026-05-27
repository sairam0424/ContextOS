#!/usr/bin/env node
import { createRequire } from 'module';
import { Command } from "commander";
import chalk from "chalk";
import { EXIT_CODES, exitWithCode } from './exit-codes.js';

const require = createRequire(import.meta.url);
import { initCommand } from "./commands/init.js";
import { todayCommand } from "./commands/today.js";
import { statusCommand } from "./commands/status.js";
import { decideCommand } from "./commands/decide.js";
import { syncCommand } from "./commands/sync.js";
import { summaryCommand } from "./commands/summary.js";
import { contextCommand } from "./commands/context.js";
import { searchCommand } from "./commands/search.js";
import { archiveCommand } from "./commands/archive.js";
import { pruneCommand } from "./commands/prune.js";
import { healthCommand } from "./commands/health.js";
import { extractCommand } from "./commands/extract.js";
import { tagCommand } from "./commands/tag.js";
import { validateCommand } from "./commands/validate.js";
import { indexCommand } from "./commands/index-cmd.js";
import { graphCommand } from "./commands/graph.js";
import { watchCommand } from "./commands/watch.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { missionCommand } from "./commands/mission.js";
import { completionCommand } from "./commands/completion.js";

const program = new Command();

const { version } = require('../package.json') as { version: string };

program
  .name("workspace")
  .description("ContextOS Developer Interface Layer")
  .version(version)
  .option('--json', 'Output results as JSON')
  .option('--verbose', 'Enable verbose output');

program.showSuggestionAfterError(true);

// Register Commands
initCommand(program);
todayCommand(program);
statusCommand(program);
decideCommand(program);
syncCommand(program);
summaryCommand(program);
contextCommand(program);
searchCommand(program);
archiveCommand(program);
pruneCommand(program);
healthCommand(program);
extractCommand(program);
tagCommand(program);
validateCommand(program);
indexCommand(program);
graphCommand(program);
watchCommand(program);
dashboardCommand(program);
missionCommand(program);
completionCommand(program);

process.on('uncaughtException', (error) => {
  console.error(chalk.red(`Fatal error: ${error.message}`));
  exitWithCode(EXIT_CODES.GENERAL_ERROR);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(chalk.red(`Unhandled rejection: ${message}`));
  exitWithCode(EXIT_CODES.GENERAL_ERROR);
});

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
