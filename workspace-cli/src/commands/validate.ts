import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import fm from "front-matter";

const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

interface FileConfig {
  name: string;
  schema: string;
  required?: boolean;
}

export function validateCommand(program: Command) {
  program
    .command("validate")
    .description("Validate workspace files against JSON schemas")
    .action(async () => {
      const spinner = ora("Validating workspace integrity...").start();
      try {
        const findWorkspaceRoot = () => {
          let current = process.cwd();
          const root = "/";
          while (current !== root) {
            if (fs.existsSync(path.join(current, "root", "soul.md"))) {
              return current;
            }
            current = path.dirname(current);
          }
          return process.cwd();
        };

        const workspaceRoot = findWorkspaceRoot();
        const schemasDir = path.join(workspaceRoot, "schemas");
        const projectsDir = path.join(workspaceRoot, "projects");
        const starterDir = path.join(workspaceRoot, "workspace-starter");

        if (!(await fs.pathExists(schemasDir))) {
          spinner.fail(chalk.red(`Schemas directory not found at ${schemasDir}`));
          process.exit(1);
        }

        const validFiles: FileConfig[] = [
          { name: "SOUL.md", schema: "soul.schema.json", required: true },
          { name: "CONTEXT.md", schema: "context.schema.json", required: true },
          { name: "memory.md", schema: "memory.schema.json" },
          { name: "decisions.md", schema: "decision.schema.json" }
        ];

        let totalIssues = 0;
        
        // Find all project-like directories (projects/* and workspace-starter)
        const projectPaths = [];
        if (await fs.pathExists(projectsDir)) {
          const projects = await fs.readdir(projectsDir);
          for (const p of projects) {
            const fullPath = path.join(projectsDir, p);
            if ((await fs.stat(fullPath)).isDirectory()) {
              projectPaths.push(fullPath);
            }
          }
        }
        if (await fs.pathExists(starterDir)) {
          projectPaths.push(starterDir);
        }

        for (const projectPath of projectPaths) {
          const projectName = path.basename(projectPath);
          const filesInDir = await fs.readdir(projectPath);

          for (const config of validFiles) {
            // Case-insensitive search
            const fileName = filesInDir.find(f => f.toLowerCase() === config.name.toLowerCase());
            
            if (!fileName) {
              if (config.required) {
                totalIssues++;
                console.log(chalk.red(`\n❌ Missing required file in ${projectName}: ${config.name}`));
              }
              continue;
            }

            const filePath = path.join(projectPath, fileName);
            const schemaPath = path.join(schemasDir, config.schema);
            const schema = await fs.readJson(schemaPath);
            const validate = ajv.compile(schema);

            const content = await fs.readFile(filePath, "utf-8");
            const data = extractMetadata(content);
            
            const valid = validate(data);
            if (!valid) {
              totalIssues++;
              console.log(chalk.red(`\n❌ Schema error in ${projectName}/${fileName}:`));
              validate.errors?.forEach((err: any) => {
                console.log(chalk.yellow(`   - ${err.instancePath || 'root'} ${err.message}`));
              });
            }
          }
        }

        if (totalIssues === 0) {
          spinner.succeed(chalk.green("Workspace validation successful! All files conform to schema."));
        } else {
          spinner.fail(chalk.red(`Workspace validation failed with ${totalIssues} issues.`));
          process.exit(1);
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Validation error: ${error.message}`));
        process.exit(1);
      }
    });
}

/**
 * Robustly extract metadata from a markdown file.
 * Prioritizes Frontmatter, falls back to Section mapping.
 */
function extractMetadata(content: string): any {
  let data: any = {};
  try {
    const parse = (fm as any).default || fm;
    if (content.trim().startsWith("---")) {
      const parsed = parse(content);
      data = parsed.attributes || {};
    }
  } catch (e) {
    console.error(chalk.yellow(`   ! Frontmatter parse failed, falling back to sections.`));
  }

  // SUPPLEMENT with section parsing if frontmatter is missing fields
  const sections = content.split(/^## /m).slice(1);
  sections.forEach(s => {
    const lines = s.split("\n");
    const title = lines[0].trim();
    const body = lines.slice(1).join("\n").trim();
    
    if (!data[title] || (Array.isArray(data[title]) && data[title].length === 0)) {
      if (["Core Principles", "Behavioral Rules", "Goals", "Capabilities", "Constraints", "Tags", "Active Tasks", "Backlog"].includes(title)) {
          data[title] = body.split("\n")
            .map(l => l.replace(/^[-*]\s*/, "").trim())
            .filter(l => l.length > 0);
      } else {
          data[title] = body;
      }
    }
  });

  return data;
}
