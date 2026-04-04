import path from "path";
import fs from "fs";
import { spawn } from "child_process";

// Discover workspace root by looking for soul.md in parent directories
function findWorkspaceRoot() {
  let current = process.cwd();
  const root = "/";
  while (current !== root) {
    if (fs.existsSync(path.join(current, "root", "soul.md"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd(); // Fallback to CWD
}

const workspaceRoot = findWorkspaceRoot();

const ALLOWED_ROOTS = [
  path.join(workspaceRoot, "projects"),
  path.join(workspaceRoot, "knowledge"),
  path.join(workspaceRoot, "schemas"),
  path.join(workspaceRoot, "archive"),
  path.join(workspaceRoot, "log"),
  path.join(workspaceRoot, "orgs"),
  path.join(workspaceRoot, "root")
];

export function validatePath(requestedPath: string) {
  const fullPath = path.resolve(workspaceRoot, requestedPath);
  const relativePath = path.relative(workspaceRoot, fullPath);

  // Security check: must be within the workspace root
  if (relativePath.startsWith("..") || path.isAbsolute(requestedPath)) {
      if (!fullPath.startsWith(workspaceRoot)) {
        throw new Error(`Security violation: Path ${requestedPath} is outside the allowed ContextOS workspace roots.`);
      }
  }

  // Enterprise check: must be within an allowed bucket
  const isAllowed = ALLOWED_ROOTS.some(root => fullPath.startsWith(root));
  
  if (!isAllowed) {
    throw new Error(`Security violation: Path ${requestedPath} is outside the allowed bucket (projects, orgs, knowledge, schemas, etc).`);
  }

  return { fullPath, relativePath };
}

export function isReadOnly(filePath: string): boolean {
  const absolutePath = path.resolve(workspaceRoot, filePath);
  
  // Knowledge, Schemas, and Root are read-only for agents via MCP
  const readOnlyRoots = [
    path.join(workspaceRoot, "knowledge"),
    path.join(workspaceRoot, "schemas"),
    path.join(workspaceRoot, "root")
  ];
  
  return readOnlyRoots.some(root => absolutePath.startsWith(root));
}

export async function gitCommit(filePath: string, message: string) {
  return new Promise<void>((resolve) => {
    const add = spawn("git", ["add", filePath], { cwd: workspaceRoot });
    add.on("close", () => {
      const commit = spawn("git", ["commit", "-m", message], { cwd: workspaceRoot });
      commit.on("close", () => resolve());
    });
  });
}

export function handleToolError(error: any) {
  return {
    content: [{ type: "text" as const, text: `Error: ${error.message}` }],
    isError: true
  };
}
