import { Command } from "commander";
import chalk from "chalk";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { WebSocketServer } from "ws";
import { samplingService, knowledgeGraphService, watchService } from "@context-os/core";

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

        if (url === "/api/telemetry/focus" && req.method === "POST") {
          let body = "";
          req.on("data", chunk => body += chunk);
          req.on("end", () => {
             const { id } = JSON.parse(body);
             console.log(chalk.yellow(`  - Spatial Focus: ${id}`));
             wss.clients.forEach(client => {
               if (client.readyState === 1) {
                 client.send(JSON.stringify({ type: "agent_focus", id }));
               }
             });
             res.writeHead(200);
             res.end("OK");
          });
          return;
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

      // 🛰️ WebSocket Layer for Real-time Sync
      const wss = new WebSocketServer({ server });

      wss.on("connection", (ws) => {
        console.log(chalk.dim("  - HUD: Client connected via WebSocket"));
        
        // Send initial state immediately
        (async () => {
          const pulse = await samplingService.getPulse();
          const graph = await knowledgeGraphService.getGraph();
          ws.send(JSON.stringify({ type: "init", data: { pulse, graph } }));
        })();

        ws.on("message", async (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === "action") {
              const { action, payload } = message;
              console.log(chalk.bold.magenta(`  - HUD Action: ${action}`), payload);

              const db = knowledgeGraphService['dbService'];

              switch (action) {
                case "link_nodes":
                  db.upsertEdge(payload.source, payload.target, "manual", 1.0);
                  break;
                case "unlink_nodes":
                  db.removeEdge(payload.source, payload.target, payload.type);
                  break;
                case "pulse_node":
                  const doc = db.getDocumentByPath(payload.id);
                  if (doc && doc.id) {
                    db.addToQueue(doc.id, 10); // High priority
                  }
                  break;
              }

              // Broadcast refresh
              const pulse = await samplingService.getPulse();
              const graph = await knowledgeGraphService.getGraph();
              wss.clients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({ type: "sync", data: { pulse, graph } }));
                }
              });
            }
          } catch (e) {
            console.error(chalk.red("  - HUD Error: Failed to process action"), e);
          }
        });

        ws.on("close", () => {
          console.log(chalk.dim("  - HUD: Client disconnected"));
        });
      });

      // Start Sentinel
      watchService.start();
      console.log(chalk.dim("  - Sentinel: Watch Service active"));

      // Broadcast changes
      watchService.on("sync", async (event) => {
        console.log(chalk.cyan(`  - Sync Event: ${event.type} [${event.path}]`));
        const pulse = await samplingService.getPulse();
        const graph = await knowledgeGraphService.getGraph();

        const message = JSON.stringify({ 
          type: "sync", 
          event, 
          data: { pulse, graph } 
        });

        wss.clients.forEach((client) => {
          if (client.readyState === 1) { // 1 = OPEN
            client.send(message);
          }
        });
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
