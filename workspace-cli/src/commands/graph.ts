import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { knowledgeGraphService } from "@context-os/core";
import { getOutputOpts, output, verbose } from '../utils/output.js';

export function graphCommand(program: Command) {
  program
    .command("graph")
    .description("Visualize the workspace knowledge graph (explicit + semantic links)")
    .action(async () => {
      const opts = getOutputOpts(program);
      verbose('Building workspace knowledge graph', opts);
      const spinner = ora(`Building workspace graph...`).start();
      try {
        const graph = await knowledgeGraphService.getGraph();

        if (graph.nodes.length === 0) {
          spinner.info(chalk.yellow("Graph is empty. Index some files first."));
          if (opts.json) { output({ nodes: [], edges: [] }, opts); }
          return;
        }

        spinner.succeed(chalk.green(`Federated Knowledge Graph (${graph.nodes.length} nodes, ${graph.edges.length} edges):`));

        if (opts.json) {
          output(graph, opts);
          return;
        }

        console.log("");

        // 1. Group by entity type
        const docs = graph.nodes.filter(n => n.type === 'document');
        const tags = graph.nodes.filter(n => n.type === 'tag');

        console.log(chalk.bold.blue("--- Documents ---"));
        docs.forEach(doc => {
            const connections = graph.edges.filter(e => e.source === doc.id || e.target === doc.id);
            const semanticCount = connections.filter(e => e.type === 'semantic').length;
            const linkCount = connections.length - semanticCount;

            console.log(`${chalk.cyan(doc.id)} ${chalk.gray(`(${linkCount} links, ${semanticCount} semantic bridges)`)}`);
        });

        console.log("");
        console.log(chalk.bold.yellow("--- Top Themes (#tags) ---"));
        tags.forEach(tag => {
            const usage = graph.edges.filter(e => e.target === tag.id).length;
            console.log(`${chalk.yellow(tag.label)} ${chalk.gray(`(used in ${usage} files)`)}`);
        });

        console.log("");
        console.log(chalk.dim("Run `context search <query>` to explore semantic neighborhoods."));
      } catch (error: any) {
        spinner.fail(chalk.red(`Graph generation failed: ${error.message}`));
      }
    });
}
