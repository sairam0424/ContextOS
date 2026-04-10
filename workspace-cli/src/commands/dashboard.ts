import { Command } from "commander";
import chalk from "chalk";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { samplingService, knowledgeGraphService } from "@context-os/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function dashboardCommand(program: Command) {
  program
    .command("dashboard")
    .description("Launch the Visual Control Center (Web UI)")
    .option("-p, --port <number>", "Port to run the dashboard on", "3010")
    .action(async (options) => {
      const port = parseInt(options.port);
      
      // Determine the template path
      // In dev: src/commands/../../templates/dashboard/index.html
      // In dist: dist/commands/../../templates/dashboard/index.html
      const templatePath = path.resolve(__dirname, "../../templates/dashboard/index.html");

      if (!fs.existsSync(templatePath)) {
          // Fallback if structure varies
          const fallbackPath = path.resolve(process.cwd(), "templates/dashboard/index.html");
          if (!fs.existsSync(fallbackPath)) {
            console.error(chalk.red(`\n❌ Error: Dashboard template not found at ${templatePath}`));
            process.exit(1);
          }
      }

      const dashboardDist = path.resolve(process.cwd(), "workspace-dashboard/dist");
      
      const server = http.createServer(async (req, res) => {
        const url = req.url || "/";

        // CORS for development
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          return res.end();
        }

        // API endpoints
        if (url === "/api/pulse") {
          const pulse = await samplingService.getPulse();
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(pulse));
        }

        if (url === "/api/graph") {
          const graph = await knowledgeGraphService.getGraph();
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(graph));
        }

        // Static Assets Serving
        let filePath = path.join(dashboardDist, url === "/" ? "index.html" : url);
        
        // SPA Fallback: if file doesn't exist, serve index.html
        if (!fs.existsSync(filePath)) {
          filePath = path.join(dashboardDist, "index.html");
        }

        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const contentTypes: Record<string, string> = {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".svg": "image/svg+xml"
          };
          res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
          return res.end(fs.readFileSync(filePath));
        }

        res.writeHead(404);
        res.end("Not Found");
      });

      server.listen(port, () => {
        const dashboardUrl = `http://localhost:${port}`;
        console.log(chalk.bold.cyan("\n🚀 ContextOS Visual Control Center"));
        console.log(chalk.dim("------------------------------------------"));
        console.log(chalk.green(`  URL:    ${dashboardUrl}`));
        console.log(chalk.dim("  Status: Monitoring Workspace..."));
        console.log(chalk.dim("  Cmd:    Press Ctrl+C to stop server\n"));

        // Launch Browser
        const start = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
        exec(`${start} ${dashboardUrl}`);
      });
    });
}
