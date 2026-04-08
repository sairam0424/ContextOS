import fs from "fs-extra";
import path from "path";
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import fm from "front-matter";
import { getWorkspaceRoot } from "../context.js";

const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

export interface ValidationIssue {
  project: string;
  file: string;
  message: string;
  details?: any;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  totalProjects: number;
}

export class ValidationService {
  private validFiles = [
    { name: "SOUL.md", schema: "soul.schema.json", required: true },
    { name: "CONTEXT.md", schema: "context.schema.json", required: true },
    { name: "memory.md", schema: "memory.schema.json" },
    { name: "decisions.md", schema: "decision.schema.json" }
  ];

  /**
   * Recursively validates the entire workspace against JSON schemas.
   */
  async validateWorkspace(): Promise<ValidationResult> {
    const workspaceRoot = getWorkspaceRoot();
    const schemasDir = path.join(workspaceRoot, "packages", "core", "schemas");
    const projectsDir = path.join(workspaceRoot, "projects");
    const starterDir = path.join(workspaceRoot, "workspace-starter");

    const issues: ValidationIssue[] = [];
    const projectPaths: string[] = [];

    // 1. Collect all project paths
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

    // 2. Validate each project
    for (const projectPath of projectPaths) {
      const projectName = path.basename(projectPath);
      const filesInDir = await fs.readdir(projectPath);

      for (const config of this.validFiles) {
        const fileName = filesInDir.find(f => f.toLowerCase() === config.name.toLowerCase());
        
        if (!fileName) {
          if (config.required) {
            issues.push({ project: projectName, file: config.name, message: "Missing required file" });
          }
          continue;
        }

        const filePath = path.join(projectPath, fileName);
        const schemaPath = path.join(schemasDir, config.schema);
        
        try {
          const schema = await fs.readJson(schemaPath);
          const validate = ajv.compile(schema);
          
          const content = await fs.readFile(filePath, "utf-8");
          const data = this.extractMetadata(content);
          
          if (!validate(data)) {
            validate.errors?.forEach((err: any) => {
              issues.push({
                project: projectName,
                file: fileName,
                message: `${err.instancePath || 'root'} ${err.message}`,
                details: err
              });
            });
          }
        } catch (error: any) {
          issues.push({ project: projectName, file: fileName, message: `Validation failed: ${error.message}` });
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      totalProjects: projectPaths.length
    };
  }

  /**
   * Robustly extract metadata from a markdown file.
   * Prioritizes Frontmatter, falls back to Section mapping.
   */
  extractMetadata(content: string): any {
    let data: any = {};
    try {
      const parse = (fm as any).default || fm;
      if (content.trim().startsWith("---")) {
        const parsed = parse(content);
        data = parsed.attributes || {};
      }
    } catch (e) {
      // Silently continue to section parsing
    }

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
}

export const validationService = new ValidationService();
