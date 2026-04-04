#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
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

const program = new Command();

program
  .name("workspace")
  .description("ContextOS Developer Interface Layer")
  .version("0.1.0");

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

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
