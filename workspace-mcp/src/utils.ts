import path from "path";
import fs from "fs";
import { spawn } from "child_process";

// Discover workspace root by looking for soul.md in parent directories
export function findWorkspaceRoot() {
  let current = process.cwd();
  const root = "/";
  while (current !== root) {
    if (fs.existsSync(path.join(current, "root", "soul.md"))) {
      return fs.realpathSync(current);
    }
    current = path.dirname(current);
  }
  return fs.realpathSync(process.cwd()); // Fallback to CWD
}

export const workspaceRoot = findWorkspaceRoot();

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
  // Resolve the path relative to workspace root first
  const resolvedPath = path.resolve(workspaceRoot, requestedPath);
  
  // Try to get the real path to handle symlinks, but fall back to the resolved path if it doesn't exist
  let fullPath: string;
  try {
    fullPath = fs.realpathSync(resolvedPath);
  } catch (e) {
    fullPath = resolvedPath;
  }

  const relativePath = path.relative(workspaceRoot, fullPath);

  // Security check: must be within the workspace root
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Security violation: Path ${requestedPath} is outside the allowed ContextOS workspace root.`);
  }

  // Enterprise check: must be within an allowed bucket
  const isAllowed = ALLOWED_ROOTS.some(root => {
    const bucketRelative = path.relative(root, fullPath);
    return !bucketRelative.startsWith("..") && !path.isAbsolute(bucketRelative);
  });
  
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
